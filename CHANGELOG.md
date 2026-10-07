# Changelog

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
