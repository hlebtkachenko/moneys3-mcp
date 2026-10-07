import { OperationTypeNode, parse } from "graphql";
import { ResponseCache } from "./cache.js";

const TIMEOUT_MS = 30_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;

const RECOVERY_HINTS: Record<number, string> = {
  400: "The GraphQL query or mutation is malformed. Check field names and argument types.",
  401: "Token expired or credentials invalid. Verify MONEYS3_CLIENT_ID and MONEYS3_CLIENT_SECRET.",
  403: "The API key user lacks permissions for this area. Check user rights on the API Key in Money S3.",
  404: "The Money S3 API service is not reachable. Verify MONEYS3_DOMAIN and that the API service is running.",
  429: "Rate limit exceeded and retries are used up. Wait and try again.",
  500: "Money S3 API internal error. Try restarting the S3Api service via Task Manager.",
  502: "Gateway error — the Money S3 API service may be down. Verify the S3Api Windows service is running.",
  503: "Service unavailable. The Money S3 API service may be restarting or overloaded.",
};

export interface MoneyS3Config {
  domain: string;
  appId: string;
  clientId: string;
  clientSecret: string;
  agendaGuid?: string;
  cacheTtl?: number;
  maxRetries?: number;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
  }>;
}

// Reads of these collections skip the cache: changes made outside this server
// (e.g. deletes in the Money S3 GUI) would not invalidate it.
const MUTABLE_COLLECTIONS = [
  "bankStatements",
  "cashVouchers",
  "receivedInvoices",
  "issuedInvoices",
  "internalDocuments",
  "liabilities",
  "receivables",
  "journalAccs",
  "journalTrs",
  "receivedOrders",
  "issuedOrders",
  "receivedOffers",
  "issuedOffers",
  "receivedInquiries",
  "issuedInquiries",
  "receivedSlips",
  "issuedSlips",
  "saleSlips",
  "transferNotes",
  "productionNotes",
  "receivedDeliveryNotes",
  "issuedDeliveryNotes",
  "stockTakingDocuments",
  "warehouseStocks",
  "importStatus",
];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Classifies a GraphQL document by parsing it; any mutation operation makes it a mutation. */
export function operationKind(gql: string): "query" | "mutation" {
  let doc;
  try {
    doc = parse(gql);
  } catch (err) {
    throw new Error(`GraphQL syntax error: ${(err as Error).message}`);
  }
  let kind: "query" | "mutation" = "query";
  for (const def of doc.definitions) {
    if (def.kind !== "OperationDefinition") continue;
    if (def.operation === OperationTypeNode.SUBSCRIPTION) throw new Error("Subscriptions are not supported.");
    if (def.operation === OperationTypeNode.MUTATION) kind = "mutation";
  }
  return kind;
}

export class MoneyS3Client {
  private appId: string;
  private clientId: string;
  private clientSecret: string;
  private agendaGuid: string | undefined;
  private maxRetries: number;
  private base: string;

  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  readonly cache: ResponseCache;

  constructor(config: MoneyS3Config) {
    this.base = `https://${config.domain}.api.moneys3.eu`;
    this.appId = config.appId;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.agendaGuid = config.agendaGuid;
    this.maxRetries = config.maxRetries ?? 3;
    this.cache = new ResponseCache(config.cacheTtl ?? 120);
  }

  getAgendaGuid(): string | undefined {
    return this.agendaGuid;
  }

  get baseUrl(): string {
    return this.base;
  }

  get graphqlUrl(): string {
    return `${this.baseUrl}/graphql/`;
  }

  get tokenUrl(): string {
    return `${this.baseUrl}/connect/token?AppId=${this.appId}`;
  }

  setAgendaGuid(guid: string): void {
    this.agendaGuid = guid;
    this.cache.invalidate();
  }

  private async fetchToken(): Promise<string> {
    if (
      this.accessToken &&
      Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_MARGIN_MS
    ) {
      return this.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const res = await fetch(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = (await res.text()).slice(0, 500);
      throw new Error(
        `OAuth2 token request failed (${res.status}): ${text}\n` +
          "Recovery: Verify MONEYS3_DOMAIN, MONEYS3_APP_ID, MONEYS3_CLIENT_ID, and MONEYS3_CLIENT_SECRET.",
      );
    }

    const data = (await res.json()) as TokenResponse;
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    return this.accessToken;
  }

  /** Read-only GraphQL: cached, retried on timeout. Rejects documents that contain a mutation. */
  async query<T = unknown>(gql: string): Promise<T> {
    if (operationKind(gql) !== "query") throw new Error("Read tools may not send mutations.");
    return this.send<T>(gql, false, "");
  }

  /** GraphQL mutation: never cached, never resent after it may have reached the server. */
  async mutate<T = unknown>(gql: string, verifyWith: string): Promise<T> {
    if (operationKind(gql) !== "mutation") throw new Error("Expected a GraphQL mutation.");
    return this.send<T>(gql, true, verifyWith);
  }

  /** Raw document from m3_graphql: the operation type is detected by parsing it. */
  async raw<T = unknown>(gql: string): Promise<T> {
    return this.send<T>(gql, operationKind(gql) === "mutation", "the matching read tool");
  }

  private async send<T>(gql: string, isMutation: boolean, verifyWith: string): Promise<T> {
    const cacheKey = `GQL:${this.agendaGuid ?? ""}:${gql}`;
    const skipCache = MUTABLE_COLLECTIONS.some((name) => new RegExp(`\\b${name}\\b`).test(gql));
    const useCache = !isMutation && !skipCache && this.cache.enabled;
    if (useCache) {
      const cached = this.cache.get<T>(cacheKey);
      if (cached !== undefined) return cached;
    }
    const res = await this.post(gql, isMutation, verifyWith);
    if (isMutation) this.cache.invalidate();
    const data = parseResponse<T>(res.status, await res.text(), isMutation, verifyWith);
    if (useCache) this.cache.set(cacheKey, data);
    return data;
  }

  private headers(token: string, gql: string): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    if (this.agendaGuid) headers["AgendaId"] = this.agendaGuid;
    else if (!gql.includes("agendas")) {
      throw new Error("No agenda selected. Call m3_connection_test (auto-selects if only one) or m3_set_agenda first.");
    }
    return headers;
  }

  /** Token requests send no GraphQL, so a timed-out one is safe to retry for mutations too. */
  private async tokenWithRetry(): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.fetchToken();
      } catch (err) {
        if ((err as Error).name !== "TimeoutError" || attempt >= this.maxRetries) throw err;
        await sleep(1000 * 2 ** attempt);
      }
    }
  }

  /** POSTs the document, retrying only where the request was certainly not processed (or is a read). */
  private async post(gql: string, isMutation: boolean, verifyWith: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const headers = this.headers(await this.tokenWithRetry(), gql);
      const canRetry = attempt < this.maxRetries;
      let res: Response;
      try {
        res = await fetch(this.graphqlUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({ query: gql }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        if (isMutation) {
          // The request may have reached Money S3 and been queued: never resend it.
          this.cache.invalidate();
          throw new Error(
            `Outcome unknown: the mutation request failed in transit (${(err as Error).message}). ` +
              `It may or may not have been queued. Verify with m3_import_status or ${verifyWith} before retrying.`,
          );
        }
        if ((err as Error).name !== "TimeoutError" || !canRetry) throw err;
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      // 401 and 429 mean the request was not processed, so a retry is safe for mutations too.
      if (res.status === 401 && canRetry) {
        this.accessToken = null;
        this.tokenExpiresAt = 0;
        await sleep(500);
      } else if (res.status === 429 && canRetry) {
        const retryAfter = parseInt(res.headers.get("retry-after") ?? "", 10);
        await sleep(Number.isNaN(retryAfter) ? Math.min(1000 * 2 ** attempt, 30_000) : retryAfter * 1000);
      } else {
        return res;
      }
    }
  }
}

function parseResponse<T>(status: number, text: string, isMutation: boolean, verifyWith: string): T {
  if (status < 200 || status >= 300) {
    let detail = text.slice(0, 500);
    try {
      const err = JSON.parse(text) as { error?: string; message?: string };
      detail = (err.error || err.message || text).slice(0, 500);
    } catch {
      /* raw text */
    }
    const hint = RECOVERY_HINTS[status];
    const unknown =
      isMutation && status >= 500 ? `\nOutcome unknown: verify with m3_import_status or ${verifyWith} before retrying.` : "";
    throw new Error(`Money S3 GraphQL ${status}: ${detail}${hint ? `\nRecovery: ${hint}` : ""}${unknown}`);
  }
  let parsed: GraphQLResponse<T>;
  try {
    parsed = JSON.parse(text) as GraphQLResponse<T>;
  } catch {
    throw new Error(`Money S3 returned invalid JSON: ${text.slice(0, 300)}`);
  }
  if (parsed.errors?.length) {
    throw new Error(`GraphQL error: ${parsed.errors.map((e) => e.message).join("; ").slice(0, 500)}`);
  }
  if (!parsed.data) throw new Error("GraphQL response contained no data.");
  return parsed.data;
}
