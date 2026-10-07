# moneys3-mcp

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node.js Version](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-7-blue)

MCP server for [Money S3](https://money.cz/) — the Czech/Slovak accounting system by Seyfor. Connects any MCP-compatible AI client to your Money S3 data via the official GraphQL API.

**62 tools** covering invoices, contacts, stock, banking, documents, accounting, payroll and lookups, plus a raw GraphQL tool.

## Prerequisites

Money S3 with the **API module** installed and configured:

1. API installed on the PC running Money S3 (selected during installation wizard)
2. API extension module purchased in Money S3
3. API Key generated: **Tools → XML Data Exchange → API Keys → Add & Generate**
4. App ID obtained from [money.cz/navod/api-v-money-s3-pro-vyvojare](https://money.cz/navod/api-v-money-s3-pro-vyvojare/)
5. (Recommended) S3 Automatic task `S3Api – XML import queue` added for auto-processing writes

## Installation

```bash
git clone https://github.com/hlebtkachenko/moneys3-mcp.git
cd moneys3-mcp
npm ci
npm run build
```

## Configuration

### Environment Variables

| Variable | Description | Required |
|---|---|---|
| `MONEYS3_DOMAIN` | Your domain prefix (the `{name}` part of `{name}.api.moneys3.eu`) | Yes |
| `MONEYS3_APP_ID` | Application ID from money.cz registration | Yes |
| `MONEYS3_CLIENT_ID` | Client ID from Money S3 API Key | Yes |
| `MONEYS3_CLIENT_SECRET` | Client Secret from Money S3 API Key | Yes |
| `MONEYS3_AGENDA_GUID` | Default agenda GUID (skip `m3_set_agenda` step) | No |
| `MONEYS3_CACHE_TTL` | Response cache lifetime in seconds (default: 120, 0 to disable) | No |
| `MONEYS3_MAX_RETRIES` | Max retries for reads that time out and for any request answered 401 or 429 (default: 3). Mutations are never resent after a timeout | No |

### MCP Client Setup

#### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "moneys3": {
      "command": "node",
      "args": ["/absolute/path/to/moneys3-mcp/dist/index.js"],
      "env": {
        "MONEYS3_DOMAIN": "yourcompany",
        "MONEYS3_APP_ID": "your-app-id",
        "MONEYS3_CLIENT_ID": "your-client-id",
        "MONEYS3_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

#### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "moneys3": {
      "command": "node",
      "args": ["/absolute/path/to/moneys3-mcp/dist/index.js"],
      "env": {
        "MONEYS3_DOMAIN": "yourcompany",
        "MONEYS3_APP_ID": "your-app-id",
        "MONEYS3_CLIENT_ID": "your-client-id",
        "MONEYS3_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

#### Claude Code

```bash
claude mcp add moneys3 -- node /absolute/path/to/moneys3-mcp/dist/index.js
```

Set environment variables in your shell or `.env` before running.

#### Docker

```bash
docker build -t moneys3-mcp .
docker run -i --rm \
  -e MONEYS3_DOMAIN=yourcompany \
  -e MONEYS3_APP_ID=your-app-id \
  -e MONEYS3_CLIENT_ID=your-client-id \
  -e MONEYS3_CLIENT_SECRET=your-client-secret \
  moneys3-mcp
```

#### Generic stdio

- **Command:** `node`
- **Args:** `["/path/to/moneys3-mcp/dist/index.js"]`
- **Required env:** `MONEYS3_DOMAIN`, `MONEYS3_APP_ID`, `MONEYS3_CLIENT_ID`, `MONEYS3_CLIENT_SECRET`

## Quick Start

After connecting, the typical workflow is:

1. **Test connection:** `m3_connection_test`
2. **List agendas:** `m3_agendas` → pick the one you need
3. **Set agenda:** `m3_set_agenda` with the GUID
4. **Query data:** e.g. `m3_issued_invoices`, `m3_stock_cards`, `m3_employees`

If `MONEYS3_AGENDA_GUID` is set in env, steps 2–3 are skipped.

## Available Tools

Annotations: reads are `readOnlyHint`, creates `destructiveHint: false`, deletes `destructiveHint: true`, `m3_graphql` `destructiveHint` + `openWorldHint`.

### Setup and utility (6 tools)

| Tool | Description |
|---|---|
| `m3_agendas` | List agendas with GUIDs |
| `m3_set_agenda` | Set the active agenda for subsequent calls |
| `m3_connection_test` | Test OAuth2, endpoint and agenda access; auto-selects a single agenda |
| `m3_import_status` | Show how Money S3 processed a queued write (`importStatus` by import GUID) |
| `m3_graphql` | Raw GraphQL query or mutation (mutations detected by parsing, never cached or retried) |
| `m3_orders` | Received or issued orders (`type: received \| issued`) |

### Invoices (5 tools)

| Tool | Description |
|---|---|
| `m3_issued_invoices` | Issued invoices with VAT summary, payment status, controlling variables |
| `m3_received_invoices` | Received invoices with VAT summary, payment status, controlling variables |
| `m3_create_issued_invoice` | Create an issued invoice with partner and line items |
| `m3_create_received_invoice` | Create a received invoice with partner and line items |
| `m3_delete_invoice` | Delete an invoice by ID and year |

### Address book (3 tools)

| Tool | Description |
|---|---|
| `m3_address_book` | Contacts with addresses, bank accounts, credit limit, discount, maturity terms |
| `m3_create_address` | Create a contact (address, postal code, country code, banking, credit limit, maturity) |
| `m3_delete_address` | Delete an address book entry |

### Stock (7 tools)

| Tool | Description |
|---|---|
| `m3_stock_cards` | Articles: catalogue, description, barcode, PLU, weight |
| `m3_stock_lists` | Warehouses and price levels |
| `m3_stock_documents` | Received stock slips with partner and controlling variables |
| `m3_inventory_documents` | Stocktaking documents with counted amounts |
| `m3_create_stock_card` | Create an article (catalogue, description, barcode, PLU, weight) |
| `m3_create_stock_document` | Create a received stock slip with stock items |
| `m3_create_inventory_document` | Create a stocktaking document with counted items |

### Banking (5 tools)

| Tool | Description |
|---|---|
| `m3_bank_documents` | Bank documents with statement number, VAT summary, controlling variables |
| `m3_cash_desk_documents` | Cash desk documents with cash box, VAT summary, controlling variables |
| `m3_bank_accounts` | Bank accounts and cash boxes |
| `m3_create_bank_document` | Create a bank document (symbols, partner, bank account, controlling) |
| `m3_create_cash_desk_document` | Create a cash desk document (partner, cash box, controlling) |

### Documents (6 tools)

| Tool | Description |
|---|---|
| `m3_internal_documents` | Internal documents with VAT summary and controlling variables |
| `m3_liabilities` | Liabilities with maturity, remaining amount, VAT summary |
| `m3_receivables` | Receivables with maturity, remaining amount, VAT summary |
| `m3_create_internal_document` | Create an internal document |
| `m3_create_liability` | Create a liability with partner and maturity |
| `m3_create_receivable` | Create a receivable with partner and maturity |

### Accounting (5 tools)

| Tool | Description |
|---|---|
| `m3_accounting_journal` | Accounting journal with controlling variables |
| `m3_chart_of_accounts` | Chart of accounts |
| `m3_predefined_entries` | Predefined entries (předkontace) |
| `m3_create_account` | Create an account (enum arguments validated as enum names) |
| `m3_create_predefined_entry` | Create a predefined entry |

### Payroll and service (3 tools)

| Tool | Description |
|---|---|
| `m3_employees` | Employees with address, contact, employment dates, cost center |
| `m3_service_repairs` | Service and repair records |
| `m3_create_wage` | Create a monthly wage with worked time per employment relationship |

### Controlling (6 tools)

| Tool | Description |
|---|---|
| `m3_cost_centers` | Cost centers (střediska) |
| `m3_projects` | Projects (zakázky) |
| `m3_activities` | Activities (činnosti) |
| `m3_create_cost_center` | Create a cost center |
| `m3_create_project` | Create a project |
| `m3_create_activity` | Create an activity |

### Lookups (8 tools)

| Tool | Description |
|---|---|
| `m3_numerical_series` | Numerical series |
| `m3_currencies` | Currencies with exchange rates |
| `m3_vat_classifications` | VAT classifications |
| `m3_vat_purposes` | VAT purposes |
| `m3_constant_symbols` | Constant symbols |
| `m3_countries` | Countries |
| `m3_flags` | Flags |
| `m3_crm_activities` | CRM activity records |

### Deletes (8 tools)

| Tool | Description |
|---|---|
| `m3_delete_internal_document` | Delete an internal document by ID and year |
| `m3_delete_liability` | Delete a liability by ID and year |
| `m3_delete_receivable` | Delete a receivable by ID and year |
| `m3_delete_bank_document` | Delete a bank document by ID and year |
| `m3_delete_cash_desk_document` | Delete a cash desk document by ID and year |
| `m3_delete_stock_card` | Delete an article by ID |
| `m3_delete_stock_document` | Delete a received stock slip by ID and year |
| `m3_delete_inventory_document` | Delete a stocktaking document by ID |

## Data Model

- **Reading:** GraphQL queries with `take`/`skip` paging and HotChocolate-style `where`/`order` objects. `where` and `order` must each be one GraphQL object (checked before sending).
- **Deleted records:** Money S3 returns soft-deleted records and does not accept `isDeleted` as a filter. List tools hide them on the current page and say how many were hidden; `totalCount` still counts them.
- **Writing:** mutations go into Money S3's import queue. A tool reports "queued for import" with an import GUID when `isSuccess` is true and an error when it is false. Check the processing result with `m3_import_status`.
- **Dates:** create tools accept `YYYY-MM-DD` or `DD.MM.YYYY` and send ISO `YYYY-MM-DD`, as in money.cz's official mutation examples.
- **Partner:** document creates take a `partner` object (name, street, city, postalCode, countryCode, countryName, identificationNumber, vatIdentificationNumber, email, phone), sent as `partnerAddress`.

### Filtering examples

Invoices from a date:
```
where: { dateOfIssue: { gte: "2026-01-01" } }
```

Sort by date descending:
```
order: { dateOfIssue: DESC }
```

Unpaid receivables:
```
where: { remainingAmountToPayHc: { gt: 0 } }
order: { dateOfMaturity: ASC }
```

## Schema coverage

Money S3 publishes no machine-readable schema. [docs/schema-summary.json](docs/schema-summary.json) is a hand-written summary of 16 query types and 11 mutation input types (top-level fields only); a real introspection needs a live Money S3 API server. `npm run check:contract` calls every tool and validates the GraphQL it sends against that summary and lists every path the summary does not cover. Field names outside the summary follow money.cz's official query and mutation examples and are marked as unverified in the code.

## Development

```bash
npm ci
npm run build
npm test                # node:test suite, real tool handlers against a fake Money S3 transport
npm run check:contract  # validate every tool's GraphQL against docs/schema-summary.json
```

Layout and design: [ARCHITECTURE.md](ARCHITECTURE.md). Contributor rules: [AGENTS.md](AGENTS.md).

## Security

- OAuth2 client credentials; token kept in memory and refreshed 60 s before expiry
- 30 s timeout on every request
- Reads retry on timeout; any request retries on 401 (token refresh) and 429 (rate limit)
- Mutations are never resent after a timeout or transport error: the tool reports "outcome unknown" and names the tool to verify with
- Response cache (configurable TTL) for reads only; mutations bypass and clear it; document collections are never cached
- Tool arguments are encoded as GraphQL literals (strings JSON-escaped, enum values checked against `^[A-Z][A-Z0-9_]*$`), never interpolated raw
- `m3_graphql` accepts any document (max 10,000 characters) and is annotated destructive
- No credentials logged or exposed in error messages

## Important Notes

- Write operations are **asynchronous**: data goes to the import queue and is processed by S3 Automatic. Check the outcome with `m3_import_status`.
- `definitionShortcut` names an XML transfer definition configured in your Money S3; defaults follow money.cz's examples.
- Some deletes fail if the record has dependent records (e.g. a received invoice whose goods were already dispatched).
- The API service must be running on the Money S3 PC. If requests fail with 502/503, check the S3Api Windows service.
- Questions about the API can be directed to [api@money.cz](mailto:api@money.cz).

## License

MIT — see [LICENSE](LICENSE) for details.
