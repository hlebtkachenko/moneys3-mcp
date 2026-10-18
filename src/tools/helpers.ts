import { Kind, parseValue } from "graphql";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoneyS3Client } from "../moneys3-client.js";

// GraphQL literal encoding.
// Mutations are sent as GraphQL literals, as in money.cz's official examples
// (mutation_priklady.pdf). Whether the API accepts GraphQL variables is not
// documented, so values are encoded instead of interpolated: strings through
// JSON.stringify (its escapes form a valid GraphQL string literal), numbers
// must be finite, enums must look like enum names.

const ENUM_RE = /^[A-Z][A-Z0-9_]*$/;
const NAME_RE = /^[_A-Za-z][_0-9A-Za-z]*$/;

class GqlEnum {
  constructor(readonly value: string) {
    if (!ENUM_RE.test(value)) throw new Error(`Invalid enum value: ${value}`);
  }
}

export const gqlEnum = (value: string) => new GqlEnum(value);

export type GqlInput =
  | string
  | number
  | boolean
  | GqlEnum
  | undefined
  | GqlInput[]
  | { [key: string]: GqlInput };

/** Encodes a value as a GraphQL input literal. Undefined fields and empty objects are dropped. */
function gqlValue(value: GqlInput): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Invalid number: ${value}`);
    return String(value);
  }
  if (typeof value === "boolean") return String(value);
  if (value instanceof GqlEnum) return value.value;
  if (Array.isArray(value)) {
    return `[${value.map(gqlValue).filter((v) => v !== undefined).join(", ")}]`;
  }
  const fields: string[] = [];
  for (const [key, v] of Object.entries(value)) {
    if (!NAME_RE.test(key)) throw new Error(`Invalid field name: ${key}`);
    const encoded = gqlValue(v);
    if (encoded !== undefined) fields.push(`${key}: ${encoded}`);
  }
  return fields.length ? `{ ${fields.join(", ")} }` : undefined;
}

// Dates: the official mutation examples (mutation_priklady.pdf) send every
// date as ISO "YYYY-MM-DD". Tools accept ISO or DD.MM.YYYY and send ISO.

const DATE_RE = /^(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})$/;

export const dateParam = (what: string) =>
  z.string().regex(DATE_RE, "Expected YYYY-MM-DD or DD.MM.YYYY").describe(`${what} (YYYY-MM-DD or DD.MM.YYYY)`);

export function isoDate(value: string): string;
export function isoDate(value: string | undefined): string | undefined;
export function isoDate(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : value;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) throw new Error(`Invalid date: ${value}`);
  return iso;
}

// Shared input shapes (field names from mutation_priklady.pdf).

export const partnerSchema = z
  .object({
    name: z.string().min(1).describe("Company or person name"),
    street: z.string().optional(),
    city: z.string().optional(),
    postalCode: z.string().optional(),
    countryCode: z.string().regex(/^[A-Z]{2}$/, "Two-letter ISO code").optional().describe("ISO country code, e.g. CZ"),
    countryName: z.string().optional(),
    identificationNumber: z.string().optional().describe("IČO"),
    vatIdentificationNumber: z.string().optional().describe("DIČ"),
    email: z.string().optional(),
    phone: z.string().optional(),
  })
  .describe("Partner (customer or supplier) as written on the document");

export type Partner = z.infer<typeof partnerSchema>;

export interface AddressParts {
  name?: string;
  street?: string;
  city?: string;
  postalCode?: string;
  countryCode?: string;
  countryName?: string;
}

export function addressInput(a: AddressParts): GqlInput {
  return {
    name: a.name,
    street: a.street,
    municipality: a.city,
    municipalityPostalCode: a.postalCode ? { postalCode: a.postalCode } : undefined,
    country: a.countryCode ? { code: a.countryCode } : undefined,
    countryName: a.countryName,
  };
}

/** partnerAddress (CompanyInput) in the shape of the official examples. */
export function partnerInput(p: Partner | undefined): GqlInput {
  if (!p) return undefined;
  return {
    businessAddress: addressInput(p),
    identificationNumber: p.identificationNumber,
    vatIdentificationNumber: p.vatIdentificationNumber,
    email: p.email,
    phoneNumber: p.phone,
  };
}

export const controllingParams = {
  costCenterCode: z.string().optional().describe("Cost center shortcut (středisko)"),
  projectCode: z.string().optional().describe("Project shortcut (zakázka)"),
  activityCode: z.string().optional().describe("Activity shortcut (činnost)"),
};

export function controllingInput(p: { costCenterCode?: string; projectCode?: string; activityCode?: string }) {
  return {
    centre: p.costCenterCode ? { shortCut: p.costCenterCode } : undefined,
    jobOrder: p.projectCode ? { shortCut: p.projectCode } : undefined,
    operation: p.activityCode ? { shortCut: p.activityCode } : undefined,
  };
}

// Series and předkontace come from the XML definition's presets when omitted.
export const seriesParams = {
  numericalSeriePrefix: z
    .string()
    .optional()
    .describe("Numerical series prefix (see m3_numerical_series). Omitted on create: the XML definition's preset; Money S3 rejects the import if there is none"),
};

export const postingParams = {
  accountAssignmentCode: z
    .string()
    .optional()
    .describe("Předkontace shortcut (see m3_predefined_entries). Omitted on create: the XML definition's preset; without one Money S3 saves the document unposted"),
  vatClassificationCode: z
    .string()
    .optional()
    .describe("VAT classification shortcut (členění DPH, see m3_vat_classifications). Omitted on create: the XML definition's preset; Money S3 requires one when the document is posted"),
};

export const paymentAccountParams = {
  paymentAccountCode: z
    .string()
    .optional()
    .describe("Bank account or cash box shortcut the document is paid through (see m3_bank_accounts). Omitted on create: the XML definition's preset; Money S3 rejects the import if there is none"),
};

export function postingInput(p: { numericalSeriePrefix?: string; accountAssignmentCode?: string; vatClassificationCode?: string }) {
  return {
    numericalSerie: p.numericalSeriePrefix ? { prefix: p.numericalSeriePrefix } : undefined,
    accountAssignment: p.accountAssignmentCode ? { shortCut: p.accountAssignmentCode } : undefined,
    vatClassification: p.vatClassificationCode ? { shortCut: p.vatClassificationCode } : undefined,
  };
}

export const definitionParam = (fallback: string) =>
  z.string().default(fallback).describe("XML transfer definition shortcut configured in Money S3");

// Lists

export const listParams = (max = 100, fallback = 20) => ({
  take: z.number().int().min(1).max(max).default(fallback).describe("Number of records"),
  skip: z.number().int().min(0).default(0).describe("Records to skip"),
  where: z.string().optional().describe('GraphQL filter object, e.g. { dateOfIssue: { gte: "2026-01-01" } }'),
  order: z.string().optional().describe("GraphQL order object, e.g. { dateOfIssue: DESC }"),
});

/** where/order must be a single GraphQL object or list value, so they cannot break out of the argument list. */
function checkValue(name: string, text: string): string {
  let kind;
  try {
    kind = parseValue(text).kind;
  } catch (err) {
    throw new Error(`Invalid ${name}: ${(err as Error).message}`);
  }
  if (kind !== Kind.OBJECT && kind !== Kind.LIST) throw new Error(`Invalid ${name}: expected a GraphQL object such as { field: { eq: 1 } }`);
  return text;
}

export function buildArgs(take: number, skip: number, where?: string, order?: string): string {
  const parts = [`take: ${take}`, `skip: ${skip}`];
  if (where) parts.push(`where: ${checkValue("where", where)}`);
  if (order) parts.push(`order: ${checkValue("order", order)}`);
  return parts.join(", ");
}

interface Connection {
  items?: Record<string, unknown>[];
  totalCount?: number;
}

/**
 * Formats one page of a list. Soft-deleted records are hidden client-side
 * because the API does not accept isDeleted as a filter (c8f7ab3), so the
 * header says how many were hidden and that totalCount still counts them.
 */
function listText(
  title: string,
  conn: Connection | undefined,
  skip: number,
  format: (item: Record<string, unknown>) => string,
  separator = "\n\n",
): string {
  const page = conn?.items ?? [];
  const items = page.filter((item) => !item.isDeleted);
  const hidden = page.length - items.length;
  const total = conn?.totalCount ?? page.length;
  const range = page.length ? `records ${skip + 1}-${skip + page.length} of ${total}` : `none at skip ${skip}, total ${total}`;
  const deleted = hidden ? `; ${hidden} deleted on this page hidden, total includes deleted` : "";
  const header = `# ${title} (${items.length} shown, ${range}${deleted})`;
  return items.length ? `${header}\n\n${items.map(format).join(separator)}` : `${header}\n\nNothing to show.`;
}

// Results and annotations

export function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const };
}

export const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
export const DELETE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
const UPDATE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
export const RAW = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

export interface MutationSpec {
  mutation: string;
  arg: string;
  input: GqlInput;
  definitionShortcut?: string;
  label: string;
  /** Read tool that shows whether the write happened, named in "outcome unknown" errors. */
  verifyWith: string;
}

function buildMutation(spec: MutationSpec): string {
  const def = spec.definitionShortcut ? `, definitionXMLTransfer: { shortCut: ${JSON.stringify(spec.definitionShortcut)} }` : "";
  return `mutation { ${spec.mutation}(${spec.arg}: ${gqlValue(spec.input) ?? "{ }"}${def}) { guid isSuccess } }`;
}

/**
 * Sends a create/update/delete mutation. Writes go into Money S3's import queue:
 * isSuccess=true means queued, not yet imported. isSuccess=false or a missing
 * result is an error.
 */
export async function runMutation(m3: MoneyS3Client, spec: MutationSpec) {
  try {
    const data = await m3.mutate<Record<string, { guid?: string; isSuccess?: boolean } | null>>(buildMutation(spec), spec.verifyWith);
    const result = data[spec.mutation];
    const guid = result?.guid ? `\nImport GUID: \`${result.guid}\`` : "";
    if (result?.isSuccess !== true) {
      return errorResult(
        `${spec.label}: Money S3 did not accept the request (isSuccess=${result?.isSuccess ?? "missing"}).${guid}\n` +
          `Check m3_import_status and ${spec.verifyWith} before retrying.`,
      );
    }
    return textResult(`${spec.label}: queued for import.${guid}\nMoney S3 imports asynchronously; check the outcome with m3_import_status.`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}

// Formatting

type Rec = Record<string, unknown>;

export const str = (v: unknown, fallback = "—") => (v === undefined || v === null || v === "" ? fallback : String(v));

export function controllingText(d: Rec): string | undefined {
  const sc = (k: string) => (d[k] as Rec | undefined)?.shortCut;
  const parts = [sc("centre") && `CC:${sc("centre")}`, sc("jobOrder") && `Proj:${sc("jobOrder")}`, sc("operation") && `Act:${sc("operation")}`].filter(Boolean);
  return parts.length ? `- Controlling: ${parts.join(" ")}` : undefined;
}

export function vatText(d: Rec): string | undefined {
  const rows = d.vatRateSummaryHc as Rec[] | undefined;
  if (!rows?.length) return undefined;
  return `- VAT: ${rows.map((v) => `${v.vatRate}%: base ${v.totalWithoutVat}, VAT ${v.totalVat}`).join(" | ")}`;
}

/** Runs a list query and formats it; errors become isError results. */
export async function listTool(
  m3: MoneyS3Client,
  root: string,
  fields: string,
  title: string,
  args: { take: number; skip: number; where?: string; order?: string },
  format: (item: Rec) => string,
  separator?: string,
) {
  try {
    const gql = `{ ${root}(${buildArgs(args.take, args.skip, args.where, args.order)}) { items { ${fields} } totalCount } }`;
    const data = await m3.query<Record<string, Connection>>(gql);
    return textResult(listText(title, data[root], args.skip, format, separator));
  } catch (err) {
    return errorResult((err as Error).message);
  }
}

// Updates

const UPDATE_NOTE =
  "Goes through the Money S3 import queue like a create. Before sending, the tool reads the record by its key and refuses " +
  "if none matches (deleted records do not count where the API shows them) or, for documents, addresses, stock cards and " +
  "stocktaking documents, if more than one does. Money S3 then finds the record by the XML transfer definition's key " +
  "(spojovací klíč) of the standard definition (or the one you name). The standard definitions add a record when the key " +
  "misses, so the read is the only guard against creating one. Only the fields you give are " +
  "sent (leave a field out to keep it; blank strings and empty lists are refused), but Money S3 may fill missing fields from " +
  "the definition's presets. Documents with stock items or links to other documents take only selected header fields, and " +
  "Money S3 rejects at import what it would not let you edit (locked document or accounting period). Read the record back " +
  "after m3_import_status reports it imported.";

/** Dotted path of the first empty string or empty list in the arguments, if any. */
function findBlank(value: unknown, path: string): string | undefined {
  if ((typeof value === "string" && !value.trim()) || (Array.isArray(value) && !value.length)) return path;
  if (!value || typeof value !== "object") return undefined;
  return Object.entries(value)
    .map(([k, v]) => findBlank(v, path ? `${path}.${k}` : k))
    .find(Boolean);
}

interface UpdateSpec {
  name: string;
  /** e.g. "an issued invoice" */
  what: string;
  /** Fields that identify the record; at least one changed field must come on top of them. */
  match: z.ZodRawShape;
  /** Changeable fields, without defaults (zod 4 applies defaults inside .partial()). */
  fields: z.ZodRawShape;
  /** Default XML transfer definition: the agenda's standard import definition for the entity. */
  definition: string;
  /** Read-before-write: the collection and filter that must find the record before anything is sent. */
  lookup: {
    root: string;
    where: (p: Record<string, unknown>) => GqlInput;
    /** Documents, addresses, stock cards: exactly one match. Year-scoped code lists: one or more. */
    unique: boolean;
    /** The item type has isDeleted; soft-deleted matches do not count. */
    deleted?: boolean;
  };
  mutation: string;
  arg: string;
  verifyWith: string;
  label: (p: Record<string, unknown>) => string;
  input: (p: Record<string, unknown>) => GqlInput;
  /** Extra argument check; returns an error message. */
  check?: (p: Record<string, unknown>) => string | undefined;
}

/** Filter matching any of the given fields that has a value (for entities Money S3 may match on several keys). */
export function anyOf(pairs: Array<[string, unknown]>): GqlInput {
  return { or: pairs.filter(([, v]) => v !== undefined).map(([k, v]) => ({ [k]: { eq: v as string } })) };
}

/** Refusal message when the update's record is not found as required, else undefined. */
async function lookupProblem(spec: UpdateSpec, m3: MoneyS3Client, p: Record<string, unknown>): Promise<string | undefined> {
  const { root, deleted, unique } = spec.lookup;
  const where = gqlValue(spec.lookup.where(p));
  const gql = `{ ${root}(take: 10, where: ${where}) { items { __typename${deleted ? " isDeleted" : ""} } totalCount } }`;
  m3.cache.invalidate(); // a cached page could hide a create or delete made since
  const page = (await m3.query<Record<string, Connection>>(gql))[root];
  const items = page?.items ?? [];
  const live = items.filter((item) => !item.isDeleted).length;
  if (items.length < (page?.totalCount ?? 0) && (unique || !live)) return `could not check every ${root} record matching ${where}; nothing was sent`;
  if (!live) return `no ${root} record matches ${where}; nothing was sent`;
  if (unique && live > 1) {
    const hint = "year" in spec.match ? "add the year" : "the key is ambiguous (duplicates, or one number in several years); correct it in Money S3 or give another key";
    return `${live} ${root} records match ${where}; ${hint}; nothing was sent`;
  }
  return undefined;
}

/**
 * Registers an update tool: required key, every other field optional, the
 * record read first, the write never retried (runMutation).
 */
export function updateTool(server: McpServer, m3: MoneyS3Client, spec: UpdateSpec) {
  const fields = z.object(spec.fields).partial().shape;
  if (Object.keys(z.object(fields).parse({})).length) throw new Error(`${spec.name}: update fields must not have defaults`);
  const matchNames = Object.keys(spec.match);
  server.tool(
    spec.name,
    `Update ${spec.what}. ${UPDATE_NOTE}`,
    {
      ...spec.match,
      ...fields,
      definitionShortcut: definitionParam(spec.definition),
    },
    UPDATE,
    async (p: Record<string, unknown>) => {
      const blank = findBlank(p, "");
      const input = spec.input(p);
      // Compare what would be sent, not the arguments: mappers drop some values.
      const matchOnly = spec.input(Object.fromEntries(matchNames.map((k) => [k, p[k]])));
      const problem =
        (blank && `${blank} is empty; leave a field out to keep it`) ||
        spec.check?.(p) ||
        (gqlValue(input) === gqlValue(matchOnly) && `give at least one field to change besides ${matchNames.join(", ")}`);
      if (problem) return errorResult(`${spec.name}: ${problem}.`);
      try {
        const missing = await lookupProblem(spec, m3, p);
        if (missing) return errorResult(`${spec.name}: ${missing}.`);
      } catch (err) {
        return errorResult(`${spec.name}: could not read the record before updating, nothing was sent: ${(err as Error).message}`);
      }
      return runMutation(m3, {
        mutation: spec.mutation,
        arg: spec.arg,
        label: spec.label(p),
        verifyWith: spec.verifyWith,
        definitionShortcut: p.definitionShortcut as string,
        input,
      });
    },
  );
}
