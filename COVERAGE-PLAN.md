# Money S3 MCP — Full API Coverage Plan

## Summary

The schema defines **16 query types** and **11 mutation input types**. The existing 10 tool files implement **33 tools** covering most major entities. This plan identifies gaps and proposes new tools to achieve full coverage.

---

## 1. Query Coverage

| GraphQL Query | Schema Type | Existing Tool | Status |
|---|---|---|---|
| `issuedInvoices` | `IIssuedInvoice` | `m3_issued_invoices` (invoices.ts) | COVERED |
| `receivedInvoices` | `IReceivedInvoice` | `m3_received_invoices` (invoices.ts) | COVERED |
| `cashVouchers` | `ICashVoucher` | `m3_cash_desk_documents` (banking.ts) | COVERED |
| `bankStatements` | `IBankStatement` | `m3_bank_documents` (banking.ts) | COVERED |
| `internalDocuments` | `IInternalDocument` | `m3_internal_documents` (documents.ts) | COVERED |
| `liabilities` | `ILiability` | `m3_liabilities` (documents.ts) | COVERED |
| `receivables` | `IReceivable` | `m3_receivables` (documents.ts) | COVERED |
| `accountCharts` | `IAccountChart` | `m3_chart_of_accounts` (accounting.ts) | COVERED |
| `companies` | `ICompany` | `m3_address_book` (contacts.ts) | COVERED |
| `centres` | `ICentre` | `m3_cost_centers` (controlling.ts) | COVERED |
| `accountAssignmentAccs` | `IAccountAssignmentAcc` | `m3_predefined_entries` (accounting.ts) | COVERED |
| `journalAccs` | `IJournalAcc` | `m3_accounting_journal` (accounting.ts) | COVERED |
| `bankAccountCashBoxes` | `IBankAccountCashBox` | `m3_bank_accounts` (banking.ts) | COVERED |
| `jobOrders` | `IJobOrder` | `m3_projects` (controlling.ts) | COVERED |
| `operations` | (IOperation) | `m3_activities` (controlling.ts) | COVERED |
| `agendas` | — | `m3_agendas` (agendas.ts) | COVERED |
| `employees` | — | `m3_employees` (payroll.ts) | COVERED |
| `services` | — | `m3_service_repairs` (payroll.ts) | COVERED |
| `articles` | — | `m3_stock_cards` (stock.ts) | COVERED |
| `receivedSlips` | — | `m3_stock_documents` (stock.ts) | COVERED |
| `warehouses` | — | `m3_stock_lists` (stock.ts) | COVERED |
| `priceLevels` | — | `m3_stock_lists` (stock.ts) | COVERED |
| `inventoryDocuments` | — | `m3_inventory_documents` (documents.ts) | COVERED |
| `orderDocuments` | — | `m3_orders` (graphql.ts) | COVERED |
| `numericalSeries` | `INumericalSerie` | — | **MISSING** |
| `activities` | `IActivity` | — | **MISSING** |
| `currencies` | `ICurrency` | — | **MISSING** |
| `vatClassifications` | `IVatClassification` | — | **MISSING** |
| `flags` | `IFlagLink` | — | **MISSING** |
| `vatPurposes` | `IVatPurpose` | — | **MISSING** |
| `constantSymbols` | `IConstantSymbol` | — | **MISSING** |
| `countries` | `ICountry` | — | **MISSING** |

---

## 2. Mutation Coverage

| GraphQL Mutation | Input Type | Existing Tool | Status |
|---|---|---|---|
| `createIssuedInvoice` | `IssuedInvoiceInput` | `m3_create_issued_invoice` (invoices.ts) | COVERED |
| `deleteIssuedInvoice` | — | `m3_delete_invoice` (invoices.ts) | COVERED |
| `createReceivedInvoice` | `ReceivedInvoiceInput` | `m3_create_received_invoice` (invoices.ts) | COVERED |
| `deleteReceivedInvoice` | — | `m3_delete_invoice` (invoices.ts) | COVERED |
| `createCashVoucher` | `CashVoucherInput` | `m3_create_cash_desk_document` (banking.ts) | COVERED |
| `createBankStatement` | `BankStatementInput` | `m3_create_bank_document` (banking.ts) | COVERED |
| `createInternalDocument` | `InternalDocumentInput` | `m3_create_internal_document` (documents.ts) | COVERED |
| `createCompany` | `CompanyInput` | `m3_create_address` (contacts.ts) | COVERED |
| `deleteCompany` | — | `m3_delete_address` (contacts.ts) | COVERED |
| `createCentre` | `CentreInput` | `m3_create_cost_center` (controlling.ts) | COVERED |
| `createJobOrder` | — | `m3_create_project` (controlling.ts) | COVERED |
| `createOperation` | — | `m3_create_activity` (controlling.ts) | COVERED |
| `createLiability` | `LiabilityInput` | `m3_create_liability` (documents.ts) | COVERED |
| `createReceivable` | `ReceivableInput` | `m3_create_receivable` (documents.ts) | COVERED |
| `createArticle` | — | `m3_create_stock_card` (stock.ts) | COVERED |
| `createReceivedSlip` | — | `m3_create_stock_document` (stock.ts) | COVERED |
| `createStockTakingDocument` | — | `m3_create_inventory_document` (stock.ts) | COVERED |
| `createAccountChart` | `AccountChartInput` | — | **MISSING** |
| `createAccountAssignmentAcc` | `AccountAssignmentAccInput` | — | **MISSING** |
| `createWage` | — | — | **MISSING** |
| `deleteInternalDocument` | — | — | **MISSING** |
| `deleteLiability` | — | — | **MISSING** |
| `deleteReceivable` | — | — | **MISSING** |
| `deleteBankStatement` | — | — | **MISSING** |
| `deleteCashVoucher` | — | — | **MISSING** |
| `deleteArticle` | — | — | **MISSING** |
| `deleteReceivedSlip` | — | — | **MISSING** |
| `deleteStockTakingDocument` | — | — | **MISSING** |

---

## 3. Proposed New Tools

### File: `src/tools/lookups.ts` — Reference/Lookup Data Queries

These are read-only reference tables used across the system.

| Tool Name | GraphQL Query | Description | Key Fields |
|---|---|---|---|
| `m3_numerical_series` | `numericalSeries` | List numerical series (numbering rules) for all document types | `prefix, number, name, isInvoicesIssued, isInvoicesReceived, isCashVouchersReceived, isBankStatementsReceived, isLiabilities, isReceivables, isInternalDocuments, year, centre { shortCut }` |
| `m3_currencies` | `currencies` | List configured currencies | `code, name, exchangeRate, exchangeRateAmount` |
| `m3_vat_classifications` | `vatClassifications` | List VAT classifications (DPH) | `shortCut, name, type, vatRate` |
| `m3_vat_purposes` | `vatPurposes` | List VAT purposes (ucel DPH) | `shortCut, name` |
| `m3_constant_symbols` | `constantSymbols` | List constant symbols (konstantni symboly) | `code, name` |
| `m3_countries` | `countries` | List country codes | `code, name` |
| `m3_flags` | `flags` | List flags/labels used for document tagging | `shortCut, name, colour` |
| `m3_crm_activities` | `activities` | List CRM activity records (log of user actions on documents/contacts) | `dateOfStart, description, activityType, documentNumber, employee, company { id }, isDone, note` |

**Pattern**: Same as `m3_cost_centers` — simple paginated list query with `take`, `skip`, optional `where`/`order`.

**Registration function**: `registerLookupTools(server, client)`

---

### File: `src/tools/mutations-accounting.ts` — Accounting Mutations

| Tool Name | GraphQL Mutation | Description | Key Input Fields |
|---|---|---|---|
| `m3_create_account` | `createAccountChart` | Create a new account in the chart of accounts | `account` (required), `name`, `type`, `subtype1`, `subtype2`, `note`, `year` |
| `m3_create_predefined_entry` | `createAccountAssignmentAcc` | Create a predefined accounting entry (predkontace) | `shortCut` (required), `type`, `description`, `accountDebits`, `accountCredits`, `vatClassification`, `note`, `year` |

**Pattern**: Same as `m3_create_cost_center` — mutation with `definitionXMLTransfer`, returns `{ guid isSuccess }`.

**Registration function**: `registerAccountingMutationTools(server, client)`

---

### File: `src/tools/mutations-delete.ts` — Delete Mutations for All Remaining Entity Types

| Tool Name | GraphQL Mutation | Description | Key Input Fields |
|---|---|---|---|
| `m3_delete_internal_document` | `deleteInternalDocument` | Delete an internal document by ID and year | `id`, `year` |
| `m3_delete_liability` | `deleteLiability` | Delete a liability by ID and year | `id`, `year` |
| `m3_delete_receivable` | `deleteReceivable` | Delete a receivable by ID and year | `id`, `year` |
| `m3_delete_bank_document` | `deleteBankStatement` | Delete a bank statement by ID and year | `id`, `year` |
| `m3_delete_cash_desk_document` | `deleteCashVoucher` | Delete a cash voucher by ID and year | `id`, `year` |
| `m3_delete_stock_card` | `deleteArticle` | Delete a stock card by ID | `id` |
| `m3_delete_stock_document` | `deleteReceivedSlip` | Delete a stock document by ID and year | `id`, `year` |
| `m3_delete_inventory_document` | `deleteStockTakingDocument` | Delete a stocktaking document by ID | `id` |

**Pattern**: Same as `m3_delete_invoice` and `m3_delete_address` — simple mutation with ID (and year where applicable), returns `{ guid isSuccess }`.

**Registration function**: `registerDeleteTools(server, client)`

---

### File: `src/tools/wages.ts` — Wage/Payroll Mutations

| Tool Name | GraphQL Mutation | Description | Key Input Fields |
|---|---|---|---|
| `m3_create_wage` | `createWage` | Create a wage record (mzdovy doklad) for payroll processing | `employeeId`, `year`, `month`, `grossWage`, `hoursWorked`, `costCenterCode`, `projectCode`, `definitionShortcut` |

**Pattern**: Same as other create mutations.

**Registration function**: `registerWageTools(server, client)`

**Note**: The payroll.ts file already has a comment acknowledging this gap: `// Note: payroll query does not exist in the API schema. Use createWage mutation for wages.`

---

## 4. New Files Summary

| File | Tools | Count |
|---|---|---|
| `src/tools/lookups.ts` | `m3_numerical_series`, `m3_currencies`, `m3_vat_classifications`, `m3_vat_purposes`, `m3_constant_symbols`, `m3_countries`, `m3_flags`, `m3_crm_activities` | 8 |
| `src/tools/mutations-accounting.ts` | `m3_create_account`, `m3_create_predefined_entry` | 2 |
| `src/tools/mutations-delete.ts` | `m3_delete_internal_document`, `m3_delete_liability`, `m3_delete_receivable`, `m3_delete_bank_document`, `m3_delete_cash_desk_document`, `m3_delete_stock_card`, `m3_delete_stock_document`, `m3_delete_inventory_document` | 8 |
| `src/tools/wages.ts` | `m3_create_wage` | 1 |
| **Total new tools** | | **19** |

---

## 5. Registration Code for `src/index.ts`

Add these imports and registrations (DO NOT edit index.ts yet — for reference only):

```typescript
// New imports to add:
import { registerLookupTools } from "./tools/lookups.js";
import { registerAccountingMutationTools } from "./tools/mutations-accounting.js";
import { registerDeleteTools } from "./tools/mutations-delete.js";
import { registerWageTools } from "./tools/wages.js";

// New registrations to add (after existing ones):
registerLookupTools(server, client);
registerAccountingMutationTools(server, client);
registerDeleteTools(server, client);
registerWageTools(server, client);
```

---

## 6. Implementation Notes

### Patterns to follow (from existing code)

1. **Imports**: Always import from `@modelcontextprotocol/sdk/server/mcp.js`, `zod`, `../moneys3-client.js`, and `./helpers.js`
2. **Export**: Each file exports a single `register*Tools(server: McpServer, m3: MoneyS3Client)` function
3. **Query tools**: Use `buildArgs(take, skip, where, order)` for pagination, `m3.query<T>(gql)` for execution
4. **Mutation tools**: Use `escGql()` for string escaping, `m3.query<T>(gql, true)` (second arg = isMutation), return `{ guid isSuccess }`
5. **Date params**: Use `z.string().regex(DATE_RE, DATE_MSG)` for date inputs
6. **Error handling**: Every tool handler wraps in `try/catch`, returns `errorResult((err as Error).message)`
7. **Results**: Use `textResult()` for success, `errorResult()` for failure
8. **Mutations always pass** `definitionXMLTransfer: { shortCut: "..." }` as a second argument

### GraphQL field naming convention

- Query root fields use camelCase plural: `issuedInvoices`, `bankStatements`, `centres`, etc.
- Mutation root fields use `create` + PascalCase singular: `createIssuedInvoice`, `createCentre`, etc.
- Delete mutations use `delete` + PascalCase singular: `deleteIssuedInvoice`, `deleteCompany`, etc.
- All paginated queries return `{ items { ... } totalCount }`

### Default XML transfer definition shortcuts

These are educated guesses based on existing patterns. Verify against Money S3 documentation:

| Entity | Shortcut |
|---|---|
| Account chart | `_UC` |
| Predefined entry | `_PK` |
| Wage | `_MZ` |
| Delete operations | Not needed (deletes don't use definitionXMLTransfer) |

---

## 7. After Implementation Checklist

- [ ] Build passes: `npm run build`
- [ ] All 19 new tools appear in tool listing
- [ ] Update README.md tool count (43 -> 62)
- [ ] Update README.md tool reference tables
- [ ] Test each lookup query against a live API
- [ ] Test delete mutations against test data
- [ ] Test create mutations against test data
- [ ] Verify XML transfer definition shortcuts are correct
