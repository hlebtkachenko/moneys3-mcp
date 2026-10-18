# Changelog

## [3.0.0] - 2026-10-18

### Breaking
- `m3_flags` removed: the API has no flags query (flags exist only as `flagLinks` on documents).
- `m3_create_inventory_document` requires `stockTakingId` and `stockTakingDocumentId` (required by `StockTakingDocumentInput`).
- `m3_create_account` and `m3_create_predefined_entry` take the schema's enum values (`type` of an account is `BALANCE_SHEET`, `PROFIT_LOSS`, `FINAL` or `OFF_BALANCE_SHEET`); other enum names are refused.
- `m3_currencies` shows country and rate unit; exchange rates moved to `m3_exchange_rates` (`ICurrency` has no name or rate).
- `m3_vat_classifications`, `m3_vat_purposes`, `m3_constant_symbols` show `description` (they have no `name`).

### Fixed
- Field names checked against the live Money S3 26.900 schema; 14 tools sent fields that do not exist: `m3_employees` (`dateOfBirth`, `dateOfEntry`, address, contact, position, department, centre), `m3_address_book` (bank account bank), `m3_currencies`, `m3_vat_classifications`, `m3_vat_purposes`, `m3_constant_symbols`, `m3_flags`, `m3_stock_lists` (price level `id`), `m3_stock_documents`, `m3_orders` and `m3_inventory_documents` (`isDeleted`), `m3_create_account`, `m3_create_predefined_entry`, `m3_create_inventory_document`.
- `m3_employees` reads employment relationships and the current address and contact from the employee's time periods; birth numbers are not read.
- `m3_graphql` no longer cuts output mid-JSON at 50,000 characters: compact JSON, then whole records trimmed with a notice; a result that cannot be trimmed is an error with narrowing advice.
- `m3_vat_purposes` says it works on Slovak agendas only (the query is SK-legislation only).
- `m3_create_address`: a discount, credit limit or maturity of 0 switches that term off instead of on.

### Added
- 17 update tools: invoices (issued, received), address, stock card, stock document, inventory document, bank and cash desk documents, internal document, liability, receivable, cost center, project, activity, account, predefined entry, wage. Same write semantics as creates: never retried, "outcome unknown" on timeout, `isSuccess=false` is an error. A call that would send only the key, or that contains an empty string or list, is refused before sending. Updates do not offer `partner`, `isExpense` or `isCreditNote`.
- Read tools: `m3_code_lists` (13 code lists), `m3_years`, `m3_exchange_rates`, `m3_vat_accounting`, `m3_stock_takings`; `m3_predefined_entries` gains `ledger: tax` (accountAssignmentTrs), `m3_service_repairs` gains `type: repairs`.
- `docs/schema.graphql` (live SDL, replaces the hand-written `docs/schema-summary.json`) and `npm run introspect`.
- `npm run check:contract` validates all tools with graphql-js against the full schema, every enum argument value, and flags SK-only fields.

## [2.0.0] - 2026-10-07

### Breaking
- Tools return `isError` when Money S3 answers `isSuccess: false`; successful writes say "queued for import" with the import GUID.
- `m3_graphql` drops `isMutation`: mutations are detected by parsing the document.
- Create tools take a `partner` object instead of `partnerName`/`partnerIco`; invoice items take a numeric `vatRate` and are sent as prices without VAT; `discount` dropped.
- `m3_create_stock_card` takes `catalogue`, `description`, `barCode`, `plu`, `weight` (other params were never sent).
- `m3_create_address` drops `iban` and `groupCode` (never sent).
- `m3_create_stock_document` items are stock items (`catalogue`, `warehouseCode`, `quantity`, `unitPrice`).
- `m3_create_inventory_document` takes counted `items`; `dateOfIssue`, `documentNumber`, `warehouseCode` removed.
- `m3_create_wage` takes `personalNumber` and `employmentRelationships`.
- `m3_orders` requires `type` (received or issued).
- Default definition shortcuts follow money.cz's examples: cash `_PD`, received invoice `_FP+FV`, stock slip `_S`, stocktaking `_INVD`, wage `_MZDY`.

### Fixed
- Internal documents, liabilities, receivables and cash vouchers query their own schema fields.
- Mutations are never cached and never retried after a timeout.
- Enum arguments and all strings are encoded safely (GraphQL injection).
- Dates are sent as ISO `YYYY-MM-DD`; `DD.MM.YYYY` is still accepted.
- Stocktaking, orders and employee queries use the documented names.
- List headers state hidden deleted records; a failed connection test is an error.

### Added
- `m3_import_status`, MCP annotations on every tool, node:test suite, `npm run check:contract`.
- Node 22+, TypeScript 7, MCP SDK 1.32, zod 4, graphql 17.

## [1.0.0] - 2026-03-14
- Initial release
