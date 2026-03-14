import { ResponseCache } from "./cache.js";

const TIMEOUT_MS = 30_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;

const RECOVERY_HINTS: Record<number, string> = {
  400: "The GraphQL query or mutation is malformed. Check field names and argument types.",
  401: "Token expired or credentials invalid. Verify MONEYS3_CLIENT_ID and MONEYS3_CLIENT_SECRET.",
  403: "The API key user lacks permissions for this area. Check user rights on the API Key in Money S3.",
  404: "The Money S3 API service is not reachable. Verify MONEYS3_DOMAIN and that the API service is running.",
  429: "Rate limit exceeded. The request will be retried automatically.",
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
  errors?: Array<{ message: string; locations?: Array<{ line: number; column: number }> }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class MoneyS3Client {
  private domain: string;
  private appId: string;
  private clientId: string;
  private clientSecret: string;
  private agendaGuid: string | undefined;
  private maxRetries: number;

  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  readonly cache: ResponseCache;

  constructor(config: MoneyS3Config) {
    this.domain = config.domain;
    this.appId = config.appId;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.agendaGuid = config.agendaGuid;
    this.maxRetries = config.maxRetries ?? 3;
    this.cache = new ResponseCache(config.cacheTtl ?? 120);
  }

  get baseUrl(): string {
    return `https://${this.domain}.api.moneys3.eu`;
  }

  get graphqlUrl(): string {
    return `${this.baseUrl}/graphql/`;
  }

  get tokenUrl(): string {
    return `${this.baseUrl}/connect/token?AppId=${encodeURIComponent(this.appId)}`;
  }

  setAgendaGuid(guid: string): void {
    this.agendaGuid = guid;
    this.cache.invalidate();
  }

  private async fetchToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
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

  async query<T = unknown>(gql: string, isMutation = false): Promise<T> {
    const cacheKey = `GQL:${gql}`;
    if (!isMutation && this.cache.enabled) {
      const cached = this.cache.get<T>(cacheKey);
      if (cached !== undefined) return cached;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const token = await this.fetchToken();

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        };
        if (this.agendaGuid) {
          headers["AgendaGuid"] = this.agendaGuid;
        }

        const res = await fetch(this.graphqlUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({ query: gql }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (res.status === 401 && attempt < this.maxRetries) {
          this.accessToken = null;
          this.tokenExpiresAt = 0;
          await sleep(500);
          continue;
        }

        if (res.status === 429) {
          const retryAfter = res.headers.get("retry-after");
          const waitMs = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : Math.min(1000 * 2 ** attempt, 30_000);
          if (attempt < this.maxRetries) {
            await sleep(waitMs);
            continue;
          }
        }

        const text = await res.text();

        if (!res.ok) {
          let detail = text.slice(0, 500);
          try {
            const err = JSON.parse(text) as { error?: string; message?: string };
            detail = (err.error || err.message || text).slice(0, 500);
          } catch { /* raw text */ }

          const hint = RECOVERY_HINTS[res.status] || "";
          const hintSuffix = hint ? `\nRecovery: ${hint}` : "";
          throw new Error(`Money S3 GraphQL ${res.status}: ${detail}${hintSuffix}`);
        }

        let parsed: GraphQLResponse<T>;
        try {
          parsed = JSON.parse(text) as GraphQLResponse<T>;
        } catch {
          throw new Error(`Money S3 returned invalid JSON: ${text.slice(0, 300)}`);
        }

        if (parsed.errors && parsed.errors.length > 0) {
          const msgs = parsed.errors.map((e) => e.message).join("; ");
          throw new Error(`GraphQL error: ${msgs.slice(0, 500)}`);
        }

        if (!parsed.data) {
          throw new Error("GraphQL response contained no data.");
        }

        if (!isMutation && this.cache.enabled) {
          this.cache.set(cacheKey, parsed.data);
        } else if (isMutation) {
          this.cache.invalidate();
        }

        return parsed.data;
      } catch (err) {
        lastError = err as Error;
        if ((err as Error).name === "TimeoutError" && attempt < this.maxRetries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        if (attempt >= this.maxRetries) break;
        const msg = (err as Error).message || "";
        if (msg.includes("429") || msg.includes("401")) continue;
        break;
      }
    }

    throw lastError ?? new Error("Money S3 GraphQL request failed after retries");
  }
}
