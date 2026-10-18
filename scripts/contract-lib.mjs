// Shared by scripts/check-contract.mjs and the tests: sample tool arguments and
// validate GraphQL documents against docs/schema.graphql, the full schema from
// live introspection of Money S3 (npm run introspect).
import fs from "node:fs";
import {
  GraphQLScalarType,
  Kind,
  TypeInfo,
  buildSchema,
  getNamedType,
  parse,
  validate as validateDocument,
  visit,
  visitWithTypeInfo,
} from "graphql";

const schema = buildSchema(fs.readFileSync(new URL("../docs/schema.graphql", import.meta.url), "utf8"));

// SDL custom scalars accept any literal; pin the ones tools send to the literal
// kinds Money S3 accepts, so a quoted number or an unquoted date fails here.
const LITERALS = { Date: [Kind.STRING], DateTime: [Kind.STRING], UUID: [Kind.STRING], Decimal: [Kind.INT, Kind.FLOAT], Long: [Kind.INT] };
for (const [name, kinds] of Object.entries(LITERALS)) {
  const type = schema.getType(name);
  if (!(type instanceof GraphQLScalarType)) continue;
  type.parseLiteral = (ast) => {
    if (!kinds.includes(ast.kind)) throw new TypeError(`${ast.kind} literal for ${name}`);
    return ast.kind === Kind.STRING ? ast.value : Number(ast.value);
  };
}

// Fields marked @legislationDirective(legislationType: SK) fail at runtime on
// Czech agendas ("Member is available only for 'Sk' legislation").
const isSkOnly = (def) =>
  def?.astNode?.directives?.some((d) => d.name.value === "legislationDirective" && d.arguments.some((a) => a.value.value === "SK"));

/** Field and input-field paths of a valid document that only Slovak agendas accept. */
function skOnly(doc) {
  const typeInfo = new TypeInfo(schema);
  const found = [];
  visit(doc, visitWithTypeInfo(typeInfo, {
    Field(node) {
      const parent = typeInfo.getParentType();
      if (isSkOnly(typeInfo.getFieldDef())) found.push(`${parent}.${node.name.value} is SK-legislation only`);
    },
    ObjectField(node) {
      const parent = getNamedType(typeInfo.getParentInputType());
      if (isSkOnly(parent?.getFields?.()[node.name.value])) found.push(`${parent}.${node.name.value} is SK-legislation only`);
    },
  }));
  return found;
}

/**
 * Validates one document against the live schema. Returns { errors, skOnly }:
 * GraphQL validation errors, and fields that work only on Slovak agendas.
 * Syntax errors throw.
 */
export function validate(gql) {
  const doc = parse(gql);
  const errors = validateDocument(schema, doc).map((e) => e.message);
  return { errors, skOnly: errors.length ? [] : skOnly(doc) };
}

/** Tools that exist for Slovak agendas only; their SK-only fields are expected. */
export const SK_TOOLS = new Set(["m3_vat_purposes"]);

const SKIP_KEYS = new Set(["where", "order"]);
const BY_KEY = { year: 2026, month: 3, countryCode: "CZ", guid: "00000000-0000-4000-8000-000000000001" };
const BY_PATTERN = [[/\\d\{4\}/, "2026-01-15"], [/A-Z/, "SAMPLE_VALUE"]];

/** Sample arguments from a tool's JSON input schema: all fields, or required fields only. */
function sample(schema, key = "", requiredOnly = false) {
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

/**
 * Every call the contract check makes for a tool: all fields, required fields
 * only, and all fields once per further value of each top-level enum argument
 * (so m3_orders also sends issuedOrders, m3_code_lists every list).
 */
export function callsFor(tool) {
  const full = argsFor(tool);
  const calls = [{ label: "full", args: full, requiredOnly: false }, { label: "required", args: argsFor(tool, true), requiredOnly: true }];
  for (const [key, prop] of Object.entries(tool.inputSchema.properties ?? {})) {
    for (const value of (prop.enum ?? []).slice(1)) calls.push({ label: `${key}=${value}`, args: { ...full, [key]: value }, requiredOnly: false });
  }
  return calls;
}

/** Arguments for one tool call; m3_graphql gets a fixed read-only document. */
function argsFor(tool, requiredOnly = false) {
  if (tool.name === "m3_graphql") return { query: "{ centres(take: 1) { items { shortCut } totalCount } }" };
  return sample(tool.inputSchema, "", requiredOnly);
}
