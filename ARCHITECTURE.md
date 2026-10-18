# Architecture

## Structure

```
src/
  index.ts             Entry point: env config, stdio transport
  server.ts            createServer(): registers every tool module
  moneys3-client.ts    GraphQL client: OAuth2 token, operation detection, cache, retries
  cache.ts             TTL response cache
  tools/
    helpers.ts         GraphQL literal encoding, dates, partner/controlling inputs, list paging, runMutation, updateTool, annotations
    *.ts               One area per file; each registers its MCP tools
scripts/
  fake-money.mjs       Fake Money S3 transport (replaces fetch) + in-memory MCP client, shared by tests and the contract check
  contract-lib.mjs     Sample calls from tool schemas; validate GraphQL against docs/schema.graphql (graphql-js), flag SK-only fields
  check-contract.mjs   npm run check:contract
  introspect.mjs       npm run introspect: GET /graphql/?sdl from a live S3Api into docs/schema.graphql
test/server.test.mjs   node:test suite against the fake transport
docs/schema.graphql    Full live schema (Money S3 26.900 S3Api)
```

## Flow

```
MCP client --stdio--> tool handler --> helpers (encode) --> MoneyS3Client.query/mutate/raw --HTTPS POST /graphql/--> Money S3 API
                          ^                                                                                         |
                          +------------------------------- data or GraphQL errors -> text / isError ---------------+
```

## Design notes

- **Operation type is parsed, not declared.** `query()` rejects documents containing a mutation, `mutate()` requires one, `raw()` (m3_graphql) detects it. Mutations are never cached and never resent once they may have reached the server; a timeout or transport error returns "outcome unknown" naming the read tool to check.
- **Writes are queued.** Money S3 puts mutations into its XML import queue. `isSuccess=true` means queued; `isSuccess=false` is an error. `m3_import_status` reads `importStatus(importGuid)`.
- **No variables.** Mutations are GraphQL literals as in money.cz's examples; `gqlValue` encodes strings with JSON escaping and checks enum names and numbers.
- **Soft deletes.** The API returns deleted records and does not filter on `isDeleted`; `listText` hides them and says so in the header.
- **Updates have no ID.** `Update*` inputs mirror the create inputs; Money S3 matches the record by the XML transfer definition's key (document number, partner code/IČO/GUID, catalogue, shortcut). `updateTool` registers every update the same way: required key, all other fields optional and without defaults (zod 4 applies defaults inside `.partial()`; registration throws on one), the write through `runMutation`. Before sending it refuses empty strings and lists anywhere in the arguments and any call whose encoded input equals the key-only input, then reads the record by its key (cache cleared first) and refuses when no record (not deleted, where the type has `isDeleted`), or for unique entities more than one, matches; for addresses and stock cards the read ORs every key-capable field sent, so values pointing at two records are refused. Only `UPD…` definitions are accepted, which the user configures with new records set to error (README, Update definitions): the read catches typos and duplicates, the definition stops a create if the record vanishes in between or the key misses in the target year. Creating those definitions may need Money S3's XMLDE module (unverified on 26.900); until they exist, updates fail at import. Invoice and other document header updates send no items or partner; `m3_update_stock_document` sends the `items: []` its input type requires (Money S3 updates only selected header fields on stock documents); `m3_update_inventory_document` sends counted items.
- **Schema contract.** `docs/schema.graphql` is the live SDL. The contract check validates every tool call (all fields, required only, each enum value) with graphql-js, pins scalar literal kinds (Date/UUID strings, Decimal numbers), and flags `@legislationDirective(legislationType: SK)` fields, which Czech agendas reject at runtime ("available only for 'Sk' legislation").
- **m3_graphql output.** Over 50,000 characters it falls back to compact JSON, then drops whole records from `items` lists and says so in a second content block; it never cuts JSON.
