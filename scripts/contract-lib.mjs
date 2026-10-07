// Shared by scripts/check-contract.mjs and the tests: sample tool arguments and
// validate GraphQL documents against docs/schema-summary.json.
// The summary covers 16 query types and 11 mutation input types (top-level
// fields only). Anything outside it is reported as "unverified", not as valid.
import fs from "node:fs";
import { Kind, parse } from "graphql";

const summary = JSON.parse(fs.readFileSync(new URL("../docs/schema-summary.json", import.meta.url), "utf8"));
const OUT = Object.fromEntries(Object.entries(summary.queryTypes).map(([t, v]) => [t, Object.fromEntries(v.fields.map((f) => [f.name, f.type]))]));
const IN = Object.fromEntries(Object.entries(summary.mutationInputTypes).map(([t, v]) => [t, Object.fromEntries(v.inputFields.map((f) => [f.name, f.type]))]));

const ROOT_QUERIES = {
  issuedInvoices: "IIssuedInvoice", receivedInvoices: "IReceivedInvoice", cashVouchers: "ICashVoucher",
  bankStatements: "IBankStatement", internalDocuments: "IInternalDocument", liabilities: "ILiability",
  receivables: "IReceivable", accountCharts: "IAccountChart", companies: "ICompany", centres: "ICentre",
  accountAssignmentAccs: "IAccountAssignmentAcc", journalAccs: "IJournalAcc", bankAccountCashBoxes: "IBankAccountCashBox",
  numericalSeries: "INumericalSerie", activities: "IActivity", jobOrders: "IJobOrder",
};
const ROOT_MUTATIONS = {
  createIssuedInvoice: "IssuedInvoiceInput", createReceivedInvoice: "ReceivedInvoiceInput", createCashVoucher: "CashVoucherInput",
  createBankStatement: "BankStatementInput", createInternalDocument: "InternalDocumentInput", createCompany: "CompanyInput",
  createAccountChart: "AccountChartInput", createCentre: "CentreInput", createAccountAssignmentAcc: "AccountAssignmentAccInput",
  createLiability: "LiabilityInput", createReceivable: "ReceivableInput",
};
const SCALARS = { Date: Kind.STRING, String: Kind.STRING, UUID: Kind.STRING, Boolean: Kind.BOOLEAN, Int: [Kind.INT], Decimal: [Kind.INT, Kind.FLOAT] };
const bare = (t) => t.replace(/[[\]!]/g, "");

function checkSelection(type, selection, path, acc) {
  for (const s of selection.selections) {
    const name = s.name.value;
    if (!(name in OUT[type])) {
      acc.errors.push(`${path}.${name} is not a field of ${type}`);
      continue;
    }
    acc.checked++;
    const next = bare(OUT[type][name]);
    if (s.selectionSet) {
      if (OUT[next]) checkSelection(next, s.selectionSet, `${path}.${name}`, acc);
      else acc.unverified.push(`${path}.${name} { } (${next})`);
    }
  }
}

function checkInput(type, obj, path, acc) {
  if (!IN[type]) {
    acc.unverified.push(`${path} (${type})`);
    return;
  }
  for (const f of obj.fields) {
    const name = f.name.value;
    if (!(name in IN[type])) {
      acc.errors.push(`${path}.${name} is not a field of ${type}`);
      continue;
    }
    acc.checked++;
    const next = bare(IN[type][name]);
    const values = f.value.kind === Kind.LIST ? f.value.values : [f.value];
    for (const v of values) {
      if (v.kind === Kind.OBJECT) checkInput(next, v, `${path}.${name}`, acc);
      else if (SCALARS[next] && ![SCALARS[next]].flat().includes(v.kind)) acc.errors.push(`${path}.${name}: ${v.kind} literal for ${next}`);
      else if (!SCALARS[next] && v.kind === Kind.STRING) acc.errors.push(`${path}.${name}: string literal for enum/object ${next}`);
    }
  }
}

/** Validates one document. Returns { errors, unverified, checked }. Syntax errors throw. */
export function validate(gql) {
  const acc = { errors: [], unverified: [], checked: 0 };
  const op = parse(gql).definitions[0];
  for (const root of op.selectionSet.selections) {
    const name = root.name.value;
    if (op.operation === "query") {
      const items = root.selectionSet?.selections.find((s) => s.name.value === "items");
      if (ROOT_QUERIES[name] && items) checkSelection(ROOT_QUERIES[name], items.selectionSet, `${name}.items`, acc);
      else acc.unverified.push(`query ${name}`);
    } else {
      const arg = root.arguments.find((a) => a.name.value !== "definitionXMLTransfer");
      if (ROOT_MUTATIONS[name]) checkInput(ROOT_MUTATIONS[name], arg.value, `${name}(${arg.name.value})`, acc);
      else acc.unverified.push(`mutation ${name}`);
    }
  }
  return acc;
}

const SKIP_KEYS = new Set(["where", "order"]);
const BY_KEY = { year: 2026, month: 3, countryCode: "CZ", guid: "00000000-0000-4000-8000-000000000001" };
const BY_PATTERN = [[/\\d\{4\}/, "2026-01-15"], [/A-Z/, "SAMPLE_VALUE"]];

/** Sample arguments from a tool's JSON input schema: all fields, or required fields only. */
export function sample(schema, key = "", requiredOnly = false) {
  if (key in BY_KEY) return BY_KEY[key];
  if (schema.enum) return schema.enum[0];
  if (schema.anyOf) return sample(schema.anyOf[0], key, requiredOnly);
  if (schema.pattern) return BY_PATTERN.find(([re]) => re.test(schema.pattern))?.[1] ?? "X";
  switch (schema.type) {
    case "number": case "integer": return Math.max(1, schema.minimum ?? 1);
    case "boolean": return true;
    case "array": return [sample(schema.items, key, requiredOnly)];
    case "object": {
      const keys = Object.keys(schema.properties ?? {}).filter((k) => !SKIP_KEYS.has(k) && (!requiredOnly || schema.required?.includes(k)));
      return Object.fromEntries(keys.map((k) => [k, sample(schema.properties[k], k, requiredOnly)]));
    }
    default: return `X-${key}`;
  }
}

/** Arguments for one tool call; m3_graphql gets a fixed read-only document. */
export function argsFor(tool, requiredOnly = false) {
  if (tool.name === "m3_graphql") return { query: "{ centres(take: 1) { items { shortCut } totalCount } }" };
  return sample(tool.inputSchema, "", requiredOnly);
}
