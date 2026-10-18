// Regenerates docs/schema.graphql from a live Money S3 API. S3Api (Hot
// Chocolate) serves its full SDL at GET /graphql/?sdl without a token, so only
// MONEYS3_DOMAIN is needed. The S3Api service must be running.
// Usage: MONEYS3_DOMAIN=yourcompany npm run introspect
import fs from "node:fs";
import { buildSchema } from "graphql";

const domain = process.env.MONEYS3_DOMAIN;
if (!domain) {
  console.error("Missing env var: MONEYS3_DOMAIN");
  process.exit(1);
}
const res = await fetch(`https://${domain}.api.moneys3.eu/graphql/?sdl`, { signal: AbortSignal.timeout(60_000) });
if (!res.ok) throw new Error(`GET /graphql/?sdl failed: ${res.status}`);
const sdl = await res.text();
const schema = buildSchema(sdl); // fail before writing anything that does not parse

const out = new URL("../docs/schema.graphql", import.meta.url);
fs.writeFileSync(out, `# Money S3 GraphQL schema from a live S3Api (GET /graphql/?sdl), ${new Date().toISOString().slice(0, 10)}.\n# Regenerate with: npm run introspect\n\n${sdl.trimEnd()}\n`);
console.log(`Wrote ${out.pathname}: ${Object.keys(schema.getTypeMap()).length} types, ${Object.keys(schema.getQueryType().getFields()).length} query roots, ${Object.keys(schema.getMutationType().getFields()).length} mutations.`);
