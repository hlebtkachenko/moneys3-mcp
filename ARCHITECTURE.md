# Architecture

## Structure

```
src/
  index.ts             Entry point: env config, stdio transport
  server.ts            createServer(): registers every tool module
  moneys3-client.ts    GraphQL client: OAuth2 token, operation detection, cache, retries
  cache.ts             TTL response cache
  tools/
    helpers.ts         GraphQL literal encoding, dates, partner/controlling inputs, list paging, runMutation, annotations
    *.ts               One area per file; each registers its MCP tools
scripts/
  fake-money.mjs       Fake Money S3 transport (replaces fetch) + in-memory MCP client, shared by tests and the contract check
  contract-lib.mjs     Sample arguments from tool schemas; validate GraphQL against docs/schema-summary.json
  check-contract.mjs   npm run check:contract
test/server.test.mjs   node:test suite against the fake transport
docs/schema-summary.json  Hand-written summary of part of the GraphQL schema
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
- **Schema coverage.** No machine-readable schema is published. `docs/schema-summary.json` covers 16 query and 11 input types at the top level; the contract check validates against it and lists the rest as unverified. Names outside it follow the official example PDFs and are commented as unverified.
