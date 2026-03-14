# moneys3-mcp

MCP server for [Money S3](https://money.cz/) — the Czech/Slovak accounting system by Seyfor. Connects any MCP-compatible AI client to your Money S3 data via the official GraphQL API.

**43 tools** across 10 categories covering invoices, contacts, stock, banking, payroll, accounting, and more.

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
npm install
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
| `MONEYS3_MAX_RETRIES` | Max retry attempts for failed/rate-limited requests (default: 3) | No |

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

### Setup (2 tools)

| Tool | Description |
|---|---|
| `m3_agendas` | List all agendas with GUIDs |
| `m3_set_agenda` | Set active agenda for subsequent calls |

### Invoices (5 tools)

| Tool | Description |
|---|---|
| `m3_issued_invoices` | Query issued invoices with VAT breakdown, payment status, controlling variables |
| `m3_received_invoices` | Query received invoices with VAT breakdown, payment status, controlling variables |
| `m3_create_issued_invoice` | Create an issued invoice with line items, credit note flag, controlling vars |
| `m3_create_received_invoice` | Create a received invoice with line items, controlling vars |
| `m3_delete_invoice` | Delete an invoice by ID and year |

### Address Book (3 tools)

| Tool | Description |
|---|---|
| `m3_address_book` | Query contacts with bank accounts, credit limits, discount, maturity terms |
| `m3_create_address` | Create contact with banking, credit limit, VAT payer flag, maturity terms |
| `m3_delete_address` | Delete address book entry |

### Stock & Inventory (7 tools)

| Tool | Description |
|---|---|
| `m3_stock_cards` | Query stock cards with pricing, barcodes, weight, warranty, categories, stock levels |
| `m3_stock_lists` | List warehouses and price levels |
| `m3_stock_documents` | Query stock docs with controlling vars, serial numbers, warehouse, discount |
| `m3_create_stock_card` | Create stock card with barcode, weight, warranty, min/max stock, categories |
| `m3_create_stock_document` | Create stock doc with controlling vars, serial numbers, warehouse |
| `m3_inventory_documents` | Query inventory docs with expected vs real amounts and differences |
| `m3_create_inventory_document` | Create inventory document with warehouse selection |

### Banking (5 tools)

| Tool | Description |
|---|---|
| `m3_bank_documents` | Query bank docs with VAT breakdown, payment status, controlling variables |
| `m3_cash_desk_documents` | Query cash desk docs with VAT breakdown, payment status, controlling variables |
| `m3_create_bank_document` | Create bank doc with all symbols (VS/KS/SS), partner ICO, controlling vars |
| `m3_create_cash_desk_document` | Create cash desk doc with controlling vars |
| `m3_bank_accounts` | List bank accounts with IBAN/SWIFT and cash desks |

### Documents (8 tools)

| Tool | Description |
|---|---|
| `m3_internal_documents` | Query internal docs with VAT, payment status, controlling variables |
| `m3_liabilities` | Query liabilities with maturity dates, VAT, payment status, controlling vars |
| `m3_receivables` | Query receivables with maturity dates, VAT, payment status, controlling vars |
| `m3_inventory_documents` | Query inventory documents |
| `m3_create_internal_document` | Create internal doc with controlling vars |
| `m3_create_liability` | Create liability with maturity date, partner ICO, controlling vars |
| `m3_create_receivable` | Create receivable with maturity date, partner ICO, controlling vars |
| `m3_delete_invoice` | Delete invoice |

### Accounting (3 tools)

| Tool | Description |
|---|---|
| `m3_accounting_journal` | Query journal with controlling variables per entry |
| `m3_chart_of_accounts` | Query chart of accounts with analytical groups |
| `m3_predefined_entries` | Query predefined entries with descriptions |

### Payroll & HR (3 tools)

| Tool | Description |
|---|---|
| `m3_employees` | Query employees with employment dates, cost center, employment type |
| `m3_payroll` | Query payroll with employer contributions, cost center |
| `m3_service_repairs` | Query service/repair records with line items, cost center |

### Controlling (6 tools)

| Tool | Description |
|---|---|
| `m3_cost_centers` | Query cost centers |
| `m3_projects` | Query projects |
| `m3_activities` | Query activities |
| `m3_create_cost_center` | Create cost center (async queue) |
| `m3_create_project` | Create project (async queue) |
| `m3_create_activity` | Create activity (async queue) |

### Utility (3 tools)

| Tool | Description |
|---|---|
| `m3_connection_test` | Test OAuth2 auth, endpoint, and agenda access |
| `m3_graphql` | Execute raw GraphQL query/mutation |
| `m3_orders` | Query order documents |

## Data Model

Money S3 operations follow two patterns:

- **Reading** — real-time GraphQL queries with `take`/`skip` pagination and HotChocolate-style `where`/`order` filtering
- **Writing** — asynchronous mutations that go into an import queue; returns a GUID to track processing status

### What's Queried per Entity

Every read tool now requests the maximum useful field set inspired by the [Money S3 XSD schemas](https://github.com/parobok/moneys3/tree/master/xsd):

- **Invoices** — full partner address, VAT summary (base + tax per rate), payment status, credit note flag, line items with discount, controlling variables (cost center / project / activity), account assignment
- **Contacts** — business + invoice addresses, bank accounts with IBAN/SWIFT, discount, credit limit, default maturity days, VAT payer flag, partner groups
- **Banking/Cash desk** — VAT summary, remaining to pay, payment date, controlling variables, line items
- **Documents** — VAT summary, maturity date, payment tracking, controlling variables, line items
- **Stock cards** — EAN/barcode, weight/volume, min/max stock, warranty, supplier, category/group, warehouse, all pricing tiers
- **Stock documents** — warehouse, serial numbers, discount, controlling variables
- **Employees** — entry/departure dates, employment type, cost center, mobile contact
- **Payroll** — employer social/health insurance contributions, cost center
- **Accounting journal** — controlling variables per entry, predefined entry reference

### Filtering Examples

Invoices from a specific date:
```
where: { dateOfIssue: { gt: "2024-01-01" } }
```

Partner by company name:
```
where: { partnerAddress: { businessAddress: { name: { eq: "ACME s.r.o." } } } }
```

Sort by date descending:
```
order: { dateOfIssue: DESC }
```

Unpaid receivables:
```
where: { isSettled: { eq: false } }
order: { dateOfMaturity: ASC }
```

## Architecture

```
src/
├── index.ts              # Entry point, env config, tool registration
├── moneys3-client.ts     # GraphQL client with OAuth2, retry, cache
├── cache.ts              # TTL-based response cache
└── tools/
    ├── helpers.ts        # escGql utility for injection prevention
    ├── agendas.ts        # Agenda selection (2)
    ├── invoices.ts       # Issued/received invoices (5)
    ├── contacts.ts       # Address book (3)
    ├── stock.ts          # Stock cards, lists, documents, inventory (7)
    ├── banking.ts        # Bank & cash desk documents (5)
    ├── documents.ts      # Internal docs, liabilities, receivables (8)
    ├── accounting.ts     # Journal, chart of accounts, entries (3)
    ├── payroll.ts        # Employees, payroll, service (3)
    ├── controlling.ts    # Cost centers, projects, activities (6)
    └── graphql.ts        # Raw GraphQL, connection test, orders (3)
```

Total: ~2,200 lines of TypeScript.

## Security

- OAuth2 Client Credentials with automatic token refresh
- Tokens cached in memory with 60s safety margin before expiry
- All HTTP requests have 30s timeout via `AbortSignal.timeout`
- Rate limit handling with exponential backoff
- Automatic retry on 401 (token refresh) and 429 (rate limit)
- Actionable error messages with context-aware recovery hints
- Response caching with configurable TTL and mutation-based invalidation
- No credentials logged or exposed in error messages
- GraphQL string escaping (`escGql`) on all user-provided mutation parameters
- Date format validation (DD.MM.YYYY regex) on all create tools
- Raw GraphQL tool limited to 10KB query size

## Tech Stack

- TypeScript, Node.js 22+
- `@modelcontextprotocol/sdk` for MCP protocol
- `zod` for input validation
- Native `fetch` (no HTTP library dependencies)
- GraphQL over HTTP POST (no GraphQL client library needed)
- stdio transport

## Important Notes

- The GraphQL schema varies by Money S3 version. Some field names may differ in older installations. Use `m3_graphql` for direct schema exploration.
- Write operations are **asynchronous** — data goes to an import queue and is processed by S3 Automatic. The mutation returns a GUID, not immediate confirmation.
- Some delete operations fail if the document has dependent records (e.g. cannot delete a received invoice if goods were already dispatched from it).
- The API service must be running on the Money S3 PC. If requests fail with 502/503, check the S3Api Windows service.
- Questions about the API can be directed to [api@money.cz](mailto:api@money.cz).

## License

MIT — see [LICENSE](LICENSE) for details.
