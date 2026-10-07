// Contract check: calls every tool twice (all fields, required fields only)
// against the fake transport, captures the GraphQL it sends, and validates it
// against docs/schema-summary.json. Money S3 publishes no machine-readable
// schema, so the summary is hand-written and covers only 16 query types and 11
// mutation input types at their top level. Everything else is listed as
// unverified. Usage: npm run check:contract
import { startFake } from "./fake-money.mjs";
import { argsFor, validate } from "./contract-lib.mjs";

const fake = await startFake();
const { tools } = await fake.client.listTools();
let failed = 0;
const unverified = new Set();

for (const tool of tools) {
  for (const requiredOnly of [false, true]) {
    fake.requests.length = 0;
    fake.m3.cache.invalidate();
    const label = `${tool.name} (${requiredOnly ? "required" : "full"})`;
    const r = await fake.call(tool.name, argsFor(tool, requiredOnly));
    if (r.isError) {
      failed++;
      console.log(`FAIL ${label}: ${r.content[0].text}`);
      continue;
    }
    for (const { query } of fake.requests) {
      const { errors, unverified: u } = validate(query);
      u.forEach((p) => unverified.add(p));
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
console.log(`\nNot covered by the schema summary (${unverified.size}):\n  ${[...unverified].sort().join("\n  ")}`);
console.log(failed ? `\n${failed} request(s) break the schema summary.` : "\nAll requests match the schema summary where it has coverage.");
process.exit(failed ? 1 : 0);
