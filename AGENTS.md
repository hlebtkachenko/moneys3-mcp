# AGENTS.md

MCP server for Money S3 (Seyfor) accounting via the Money S3 GraphQL API. TypeScript, Node 22+, stdio transport. Layout and design: [ARCHITECTURE.md](ARCHITECTURE.md).

## Commands

```bash
npm ci
npm run build           # tsc -> dist/
npm test                # build + node:test suite (fake Money S3 transport, no server needed)
npm run check:contract  # validate every tool's GraphQL against docs/schema-summary.json
```

## Rules

- Any change to the GraphQL a tool sends must pass `npm run check:contract`. Take field names from `docs/schema-summary.json` or money.cz's official query/mutation examples, not from memory; mark names the summary does not cover as unverified in a comment.
- Build mutation input with `gqlValue`/`runMutation` from `src/tools/helpers.ts`; never interpolate tool arguments into GraphQL text.
- Every tool has annotations (`READ`, `CREATE`, `DELETE`, `RAW`). Writes report `isSuccess=false` as an error.
- New tools: register in the matching `src/tools/*.ts`, add the root field to `ROOTS` in `test/server.test.mjs`, list them in the README tool tables (a test checks the tables match).
- Synthetic data only in tests and docs: no real company names, IČO, agenda GUIDs or documents. Use `12345678` as a placeholder IČO.
- Never commit credentials; configuration is env-only (README lists the variables).
