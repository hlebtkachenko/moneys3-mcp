# moneys3-mcp

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node.js Version](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-7-blue)

MCP server for [Money S3](https://money.cz/) — the Czech/Slovak accounting system by Seyfor. Connects any MCP-compatible AI client to your Money S3 data via the official GraphQL API.

**83 tools** covering invoices, contacts, stock, banking, documents, accounting, payroll, controlling and code lists (read, create, update, delete), plus a raw GraphQL tool.

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

Annotations: reads are `readOnlyHint`, creates `destructiveHint: false`, updates and deletes `destructiveHint: true`, `m3_graphql` `destructiveHint` + `openWorldHint`.

### Setup and utility (6 tools)

| Tool | Description |
|---|---|
| `m3_agendas` | List agendas with GUIDs |
| `m3_set_agenda` | Set the active agenda for subsequent calls |
| `m3_connection_test` | Test OAuth2, endpoint and agenda access; auto-selects a single agenda |
| `m3_import_status` | Show how Money S3 processed a queued write (`importStatus` by import GUID) |
| `m3_graphql` | Raw GraphQL query or mutation (mutations detected by parsing, never cached or retried); output over 50,000 characters is trimmed to whole records, never cut mid-JSON |
| `m3_orders` | Received or issued orders (`type: received \| issued`) |

### Invoices (7 tools)

| Tool | Description |
|---|---|
| `m3_issued_invoices` | Issued invoices with VAT summary, payment status, controlling variables |
| `m3_received_invoices` | Received invoices with VAT summary, payment status, controlling variables |
| `m3_create_issued_invoice` | Create an issued invoice with partner and line items |
| `m3_create_received_invoice` | Create a received invoice with partner and line items |
| `m3_update_issued_invoice` | Update an issued invoice's header by document number |
| `m3_update_received_invoice` | Update a received invoice's header by document number |
| `m3_delete_invoice` | Delete an invoice by ID and year |

### Address book (4 tools)

| Tool | Description |
|---|---|
| `m3_address_book` | Contacts with addresses, bank accounts, credit limit, discount, maturity terms |
| `m3_create_address` | Create a contact (address, postal code, country code, banking, credit limit, maturity) |
| `m3_update_address` | Update a contact found by GUID, partner code or IČO |
| `m3_delete_address` | Delete an address book entry |

### Stock (11 tools)

| Tool | Description |
|---|---|
| `m3_stock_cards` | Articles: catalogue, description, barcode, PLU, weight |
| `m3_stock_lists` | Warehouses and price levels |
| `m3_stock_documents` | Received stock slips with partner and controlling variables |
| `m3_inventory_documents` | Stocktaking documents with counted amounts |
| `m3_stock_takings` | Stocktakings (inventury) with state and dates; their IDs feed inventory documents |
| `m3_create_stock_card` | Create an article (catalogue, description, barcode, PLU, weight) |
| `m3_create_stock_document` | Create a received stock slip with stock items |
| `m3_create_inventory_document` | Create a stocktaking document with counted items |
| `m3_update_stock_card` | Update an article by catalogue |
| `m3_update_stock_document` | Update a received stock slip's description, title, note and texts |
| `m3_update_inventory_document` | Update a stocktaking document (counted items) by stocktaking and document ID |

### Banking (7 tools)

| Tool | Description |
|---|---|
| `m3_bank_documents` | Bank documents with statement number, VAT summary, controlling variables |
| `m3_cash_desk_documents` | Cash desk documents with cash box, VAT summary, controlling variables |
| `m3_bank_accounts` | Bank accounts and cash boxes |
| `m3_create_bank_document` | Create a bank document (symbols, partner, bank account, controlling) |
| `m3_create_cash_desk_document` | Create a cash desk document (partner, cash box, controlling) |
| `m3_update_bank_document` | Update a bank document's header by document number |
| `m3_update_cash_desk_document` | Update a cash desk document's header by document number |

### Documents (9 tools)

| Tool | Description |
|---|---|
| `m3_internal_documents` | Internal documents with VAT summary and controlling variables |
| `m3_liabilities` | Liabilities with maturity, remaining amount, VAT summary |
| `m3_receivables` | Receivables with maturity, remaining amount, VAT summary |
| `m3_create_internal_document` | Create an internal document |
| `m3_create_liability` | Create a liability with partner and maturity |
| `m3_create_receivable` | Create a receivable with partner and maturity |
| `m3_update_internal_document` | Update an internal document's header by document number |
| `m3_update_liability` | Update a liability's header by document number |
| `m3_update_receivable` | Update a receivable's header by document number |

### Accounting (8 tools)

| Tool | Description |
|---|---|
| `m3_accounting_journal` | Accounting journal with controlling variables |
| `m3_chart_of_accounts` | Chart of accounts |
| `m3_predefined_entries` | Predefined entries (předkontace) for accounting or tax records (`ledger: accounting \| tax`) |
| `m3_vat_accounting` | VAT accounting rules (rozúčtování DPH) for accounting or tax records |
| `m3_create_account` | Create an account (enum arguments take the schema's values) |
| `m3_create_predefined_entry` | Create a predefined entry |
| `m3_update_account` | Update an account by account number |
| `m3_update_predefined_entry` | Update a predefined entry by shortcut |

### Payroll and service (4 tools)

| Tool | Description |
|---|---|
| `m3_employees` | Employees with employment relationships, current address and contact |
| `m3_service_repairs` | Service or repair documents (`type: services \| repairs`) |
| `m3_create_wage` | Create a monthly wage with worked time per employment relationship |
| `m3_update_wage` | Update a monthly wage by employee, year and month |

### Controlling (9 tools)

| Tool | Description |
|---|---|
| `m3_cost_centers` | Cost centers (střediska) |
| `m3_projects` | Projects (zakázky) |
| `m3_activities` | Activities (činnosti) |
| `m3_create_cost_center` | Create a cost center |
| `m3_create_project` | Create a project |
| `m3_create_activity` | Create an activity |
| `m3_update_cost_center` | Update a cost center's name or note by code |
| `m3_update_project` | Update a project's name or note by code |
| `m3_update_activity` | Update an activity's name or note by code |

### Lookups and code lists (10 tools)

| Tool | Description |
|---|---|
| `m3_numerical_series` | Numerical series |
| `m3_currencies` | Currencies with country and rate unit |
| `m3_exchange_rates` | Exchange rate lists by date and bank |
| `m3_vat_classifications` | VAT classifications (členění DPH) with type and VAT return row |
| `m3_vat_purposes` | VAT purposes (Slovak agendas only) |
| `m3_constant_symbols` | Constant symbols |
| `m3_countries` | Countries |
| `m3_years` | Accounting years of the agenda |
| `m3_code_lists` | Smaller code lists (`list`): job order types, address keys, shipping methods, combined nomenclature, postal codes, non-monetary payments, XML transfer definitions, employment codes and types, stocktaking types, banks, stock card parameters, tax record movements |
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

Not covered: wages cannot be read (the API has `createWage`/`updateWage`/`deleteWage` but no wage query). `eshops` is not exposed because its records hold FTP passwords. Other query roots without a tool (`journalTrs`, `warehouseStocks`, offers, inquiries, issued slips, sale slips, transfer and production notes, delivery notes) are reachable through `m3_graphql`.

## Data Model

- **Reading:** GraphQL queries with `take`/`skip` paging and HotChocolate-style `where`/`order` objects. `where` and `order` must each be one GraphQL object (checked before sending).
- **Deleted records:** Money S3 returns soft-deleted records and does not accept `isDeleted` as a filter. List tools hide them on the current page and say how many were hidden; `totalCount` still counts them.
- **Writing:** mutations go into Money S3's import queue. A tool reports "queued for import" with an import GUID when `isSuccess` is true and an error when it is false. Check the processing result with `m3_import_status`.
- **Updating:** update inputs carry no record ID. Money S3 finds the record by the XML transfer definition's key (spojovací klíč): document number for documents, partner code, IČO, bank account or GUID for addresses, catalogue, barcode, GUID or PLU for stock cards, the shortcut for code lists. Two guards keep an update from creating a record:
  1. **Read before write.** The tool reads the record by its key first and sends nothing if no live record matches, or, for documents, addresses, stock cards and stocktaking documents, if more than one does (add the year or a sharper key). Code lists and accounts exist once per accounting year, so one or more matches pass. Wages cannot be read through the API: only the employee is checked.
  2. **Dedicated update definitions.** Update tools default to `UPD` plus the standard definition's shortcut (see [Update definitions](#update-definitions)), configured so that a miss is an error instead of a new record.

  Update tools send only the key and the fields you give, and refuse a call that would send nothing but the key or that contains an empty string or list. Document updates send header fields only (no items, no partner); whether Money S3 keeps the existing items is unverified. Documents with stock items or links to other documents take only selected header fields such as the description and texts (Seyfor's XML transfer manual), and documents Money S3 would not let you edit are refused. Read the record back after the import.
- **Dates:** create tools accept `YYYY-MM-DD` or `DD.MM.YYYY` and send ISO `YYYY-MM-DD`, as in money.cz's official mutation examples.
- **Partner:** document creates take a `partner` object (name, street, city, postalCode, countryCode, countryName, identificationNumber, vatIdentificationNumber, email, phone), sent as `partnerAddress`.

### Update definitions

Create these XML transfer definitions in Money S3 (Nástroje / Výměna dat XML / Definice přenosů) once, each a copy of the standard import definition with the processing mode for existing records set to **aktualizovat** and for new records and records without a key set to **chyba**. Until they exist, update tools fail at import; pass `definitionShortcut` to use another definition.

| Definition | Copy of | Used by |
|---|---|---|
| `UPD_FP+FV` | `_FP+FV` | `m3_update_issued_invoice`, `m3_update_received_invoice` |
| `UPD_ADR` | `_ADR` | `m3_update_address` |
| `UPD_KK` | `_KK` | `m3_update_stock_card` |
| `UPD_S` | `_S` | `m3_update_stock_document` |
| `UPD_INVD` | `_INVD` | `m3_update_inventory_document` |
| `UPD_BD` | `_BD` | `m3_update_bank_document` |
| `UPD_PD` | `_PD` | `m3_update_cash_desk_document` |
| `UPD_ID` | `_ID` | `m3_update_internal_document` |
| `UPD_PH+ZV` | `_PH+ZV` | `m3_update_liability`, `m3_update_receivable` |
| `UPD_ZAK` | `_ZAK` | `m3_update_project` |
| `UPD_ST`, `UPD_CN`, `UPD_UC`, `UPD_PK`, `UPD_MZDY` | the definitions for cost centers, activities, accounts, predefined entries and wages | `m3_update_cost_center`, `m3_update_activity`, `m3_update_account`, `m3_update_predefined_entry`, `m3_update_wage` |

The last row's base definitions are not among the standard import definitions of a stock Money S3 26.900 agenda (`m3_code_lists list=xml_transfer_definitions` lists yours); which definition S3Api uses for those entities is unverified.

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

[docs/schema.graphql](docs/schema.graphql) is the full schema of a live S3Api (Money S3 26.900), fetched from `GET /graphql/?sdl`, which S3Api serves without a token; `MONEYS3_DOMAIN=yourcompany npm run introspect` regenerates it. `npm run check:contract` calls every tool (all fields, required fields only, every value of each enum argument) against a fake transport and validates the GraphQL it sends against that schema with graphql-js: field names, argument and input types, required input fields, enum values and scalar literal kinds. It also flags fields marked `@legislationDirective(legislationType: SK)`, which Czech agendas reject at runtime.

## Development

```bash
npm ci
npm run build
npm test                # node:test suite, real tool handlers against a fake Money S3 transport
npm run check:contract  # validate every tool's GraphQL against docs/schema.graphql
npm run introspect      # refresh docs/schema.graphql from a live S3Api (needs MONEYS3_DOMAIN)
```

Layout and design: [ARCHITECTURE.md](ARCHITECTURE.md). Contributor rules: [AGENTS.md](AGENTS.md).

## Security

- OAuth2 client credentials; token kept in memory and refreshed 60 s before expiry
- 30 s timeout on every request
- Reads retry on timeout; any request retries on 401 (token refresh) and 429 (rate limit)
- Mutations are never resent after a timeout or transport error: the tool reports "outcome unknown" and names the tool to verify with
- Response cache (configurable TTL) for reads only; mutations bypass and clear it; document collections are never cached
- Mutation inputs are encoded as GraphQL literals (strings JSON-escaped, numbers finite, enum arguments limited to the schema's values)
- `where`/`order` on read tools are user-supplied GraphQL: they are inserted only after parsing as a single object or list value, and read tools reject any document that contains a mutation
- `m3_graphql` sends any document (max 10,000 characters) and is annotated destructive
- No credentials logged or exposed in error messages

## Important Notes

- Write operations are **asynchronous**: data goes to the import queue and is processed by S3 Automatic. Check the outcome with `m3_import_status`.
- `definitionShortcut` names an XML transfer definition configured in your Money S3; defaults follow money.cz's examples.
- Some deletes fail if the record has dependent records (e.g. a received invoice whose goods were already dispatched).
- The API service must be running on the Money S3 PC. If requests fail with 502/503, check the S3Api Windows service.
- Questions about the API can be directed to [api@money.cz](mailto:api@money.cz).

## License

MIT — see [LICENSE](LICENSE) for details.
