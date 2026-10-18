# AGENTS.md

MCP server for Money S3 (Seyfor) accounting via the Money S3 GraphQL API. TypeScript, Node 22+, stdio transport. Layout and design: [ARCHITECTURE.md](ARCHITECTURE.md).

## Commands

```bash
npm ci
npm run build           # tsc -> dist/
npm test                # build + node:test suite (fake Money S3 transport, no server needed)
npm run check:contract  # validate every tool's GraphQL against docs/schema.graphql
MONEYS3_DOMAIN=yourcompany npm run introspect  # refresh docs/schema.graphql from a live S3Api
```

## Rules

- Any change to the GraphQL a tool sends must pass `npm run check:contract`. Take field, input and enum names from `docs/schema.graphql`, not from memory. Avoid fields marked `@legislationDirective(legislationType: SK)` unless the tool is for Slovak agendas (`SK_TOOLS` in scripts/contract-lib.mjs).
- Schema-valid is not proof a query works: replay a changed read query through `m3_graphql` on a demo agenda. Never test writes against a real company agenda.
- Build mutation input with `gqlValue`/`runMutation` from `src/tools/helpers.ts`; never interpolate tool arguments into GraphQL text.
- Every tool has annotations (`READ`, `CREATE`, `UPDATE`, `DELETE`, `RAW`). Writes report `isSuccess=false` as an error. Register updates with `updateTool` (helpers.ts).
- New tools: register in the matching `src/tools/*.ts`, add the root field to `ROOTS` in `test/server.test.mjs`, list them in the README tool tables (a test checks the tables match).
- Synthetic data only in tests and docs: no real company names, IČO, agenda GUIDs or documents. Use `12345678` as a placeholder IČO.
- Never commit credentials; configuration is env-only (README lists the variables).
