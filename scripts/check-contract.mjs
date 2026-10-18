// Contract check: calls every tool (all fields, required fields only, every
// value of each top-level enum argument) against the fake transport, captures the GraphQL it sends, and validates it
// against docs/schema.graphql (live introspection, see npm run introspect).
// Usage: npm run check:contract
import { startFake } from "./fake-money.mjs";
import { SK_TOOLS, callsFor, validate } from "./contract-lib.mjs";

const fake = await startFake();
const { tools } = await fake.client.listTools();
let failed = 0;

for (const tool of tools) {
  for (const { label: variant, args, requiredOnly } of callsFor(tool)) {
    fake.requests.length = 0;
    fake.m3.cache.invalidate();
    const label = `${tool.name} (${variant})`;
    const r = await fake.call(tool.name, args);
    // An update with only its key has nothing to change and must be refused before sending.
    if (requiredOnly && tool.name.startsWith("m3_update_")) {
      const refused = r.isError && fake.requests.length === 0;
      if (!refused) failed++;
      console.log(`${refused ? "ok  " : "FAIL"} ${label}: ${refused ? "refused locally" : "key-only update was not refused"}`);
      continue;
    }
    if (r.isError) {
      failed++;
      console.log(`FAIL ${label}: ${r.content[0].text}`);
      continue;
    }
    for (const { query } of fake.requests) {
      const { errors: invalid, skOnly } = validate(query);
      const errors = SK_TOOLS.has(tool.name) ? invalid : [...invalid, ...skOnly];
      if (errors.length) {
        failed++;
        console.log(`FAIL ${label}\n     ${errors.join("\n     ")}`);
      } else {
        console.log(`ok   ${label}`);
      }
    }
  }
}

await fake.close();
console.log(failed ? `\n${failed} request(s) break the schema.` : `\nAll ${tools.length} tools match the schema.`);
process.exit(failed ? 1 : 0);
