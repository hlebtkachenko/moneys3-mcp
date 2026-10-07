import { Kind, parseValue } from "graphql";
import { z } from "zod";
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

/** The schema summary lists no enum values, so only the enum-name shape is checked. */
export const enumParam = () =>
  z.string().regex(ENUM_RE, "Expected an enum name (A-Z, 0-9, _), e.g. ACTIVE");

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
 * Sends a create/delete mutation. Writes go into Money S3's import queue:
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
