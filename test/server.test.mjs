// End-to-end tests: the real tool handlers from dist/ run against a fake Money S3
// transport (scripts/fake-money.mjs). Run with `npm test` (builds first).
// All data here is synthetic. Set M3_DIST to test another build.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parse, valueFromASTUntyped } from "graphql";
import { startFake, defaultData, AGENDA } from "../scripts/fake-money.mjs";
import { SK_TOOLS, callsFor, validate } from "../scripts/contract-lib.mjs";

const dist = process.env.M3_DIST ? new URL(process.env.M3_DIST) : undefined;
let fake;
let tools;

before(async () => {
  fake = await startFake({ dist });
  tools = (await fake.client.listTools()).tools;
});
after(() => fake?.close());
beforeEach(() => {
  fake.requests.length = 0;
  fake.m3.cache.invalidate();
  fake.respond = (query) => Response.json({ data: defaultData(query) });
});

const call = (name, args) => fake.call(name, args);
const text = (r) => r.content[0].text;
const last = () => fake.requests.at(-1)?.query ?? "";
/** The first argument of the first root field of the last request, as plain JS. */
const sentInput = () => {
  const root = parse(last()).definitions[0].selectionSet.selections[0];
  return JSON.parse(JSON.stringify(valueFromASTUntyped(root.arguments[0].value)));
};
const rootOf = (q) => parse(q).definitions[0].selectionSet.selections.map((s) => s.name.value);

// Expected GraphQL root field per tool (the exact request each tool must send).
const ROOTS = {
  m3_agendas: ["agendas"], m3_set_agenda: [], m3_connection_test: ["agendas"], m3_graphql: ["centres"], m3_import_status: ["importStatus"],
  m3_issued_invoices: ["issuedInvoices"], m3_received_invoices: ["receivedInvoices"],
  m3_create_issued_invoice: ["createIssuedInvoice"], m3_create_received_invoice: ["createReceivedInvoice"], m3_delete_invoice: ["deleteIssuedInvoice"],
  m3_address_book: ["companies"], m3_create_address: ["createCompany"], m3_delete_address: ["deleteCompany"],
  m3_stock_cards: ["articles"], m3_stock_lists: ["warehouses", "priceLevels"], m3_stock_documents: ["receivedSlips"],
  m3_create_stock_card: ["createArticle"], m3_create_stock_document: ["createReceivedSlip"], m3_create_inventory_document: ["createStockTakingDocument"],
  m3_bank_documents: ["bankStatements"], m3_cash_desk_documents: ["cashVouchers"], m3_bank_accounts: ["bankAccountCashBoxes"],
  m3_create_bank_document: ["createBankStatement"], m3_create_cash_desk_document: ["createCashVoucher"],
  m3_internal_documents: ["internalDocuments"], m3_liabilities: ["liabilities"], m3_receivables: ["receivables"], m3_inventory_documents: ["stockTakingDocuments"],
  m3_create_internal_document: ["createInternalDocument"], m3_create_liability: ["createLiability"], m3_create_receivable: ["createReceivable"],
  m3_accounting_journal: ["journalAccs"], m3_chart_of_accounts: ["accountCharts"], m3_predefined_entries: ["accountAssignmentAccs"],
  m3_employees: ["employees"], m3_service_repairs: ["services"],
  m3_cost_centers: ["centres"], m3_projects: ["jobOrders"], m3_activities: ["operations"],
  m3_create_cost_center: ["createCentre"], m3_create_project: ["createJobOrder"], m3_create_activity: ["createOperation"],
  m3_orders: ["receivedOrders"],
  m3_numerical_series: ["numericalSeries"], m3_currencies: ["currencies"], m3_vat_classifications: ["vatClassifications"],
  m3_vat_purposes: ["vatPurposes"], m3_constant_symbols: ["constantSymbols"], m3_countries: ["countries"],
  m3_crm_activities: ["activities"], m3_create_account: ["createAccountChart"], m3_create_predefined_entry: ["createAccountAssignmentAcc"],
  m3_delete_internal_document: ["deleteInternalDocument"], m3_delete_liability: ["deleteLiability"], m3_delete_receivable: ["deleteReceivable"],
  m3_delete_bank_document: ["deleteBankStatement"], m3_delete_cash_desk_document: ["deleteCashVoucher"], m3_delete_stock_card: ["deleteArticle"],
  m3_delete_stock_document: ["deleteReceivedSlip"], m3_delete_inventory_document: ["deleteStockTakingDocument"], m3_create_wage: ["createWage"],
  // Updates read the record first, then write.
  m3_update_issued_invoice: ["issuedInvoices", "updateIssuedInvoice"], m3_update_received_invoice: ["receivedInvoices", "updateReceivedInvoice"],
  m3_update_address: ["companies", "updateCompany"], m3_update_stock_card: ["articles", "updateArticle"],
  m3_update_stock_document: ["receivedSlips", "updateReceivedSlip"], m3_update_inventory_document: ["stockTakingDocuments", "updateStockTakingDocument"],
  m3_update_bank_document: ["bankStatements", "updateBankStatement"], m3_update_cash_desk_document: ["cashVouchers", "updateCashVoucher"],
  m3_update_internal_document: ["internalDocuments", "updateInternalDocument"], m3_update_liability: ["liabilities", "updateLiability"],
  m3_update_receivable: ["receivables", "updateReceivable"], m3_update_cost_center: ["centres", "updateCentre"],
  m3_update_project: ["jobOrders", "updateJobOrder"], m3_update_activity: ["operations", "updateOperation"],
  m3_update_account: ["accountCharts", "updateAccountChart"], m3_update_predefined_entry: ["accountAssignmentAccs", "updateAccountAssignmentAcc"],
  m3_update_wage: ["employees", "updateWage"],
  m3_code_lists: ["jobOrderTypes"], m3_years: ["years"], m3_exchange_rates: ["exchangeLists"], m3_vat_accounting: ["vatAccountingAccs"],
  m3_stock_takings: ["stockTakings"],
};

test("every tool sends the expected GraphQL request and succeeds", async () => {
  assert.deepEqual(tools.map((t) => t.name).sort(), Object.keys(ROOTS).sort());
  for (const tool of tools) {
    for (const { label, args, requiredOnly } of callsFor(tool)) {
      fake.requests.length = 0;
      fake.m3.setAgendaGuid(AGENDA);
      const r = await call(tool.name, args);
      if (requiredOnly && tool.name.startsWith("m3_update_")) {
        assert.ok(r.isError && fake.requests.length === 0, `${tool.name}: a key-only update must be refused before sending`);
        continue;
      }
      assert.ok(!r.isError, `${tool.name} (${label}): ${text(r)}`);
      if (label === "full" || label === "required") assert.deepEqual(fake.requests.flatMap((q) => rootOf(q.query)), ROOTS[tool.name], tool.name);
      for (const req of fake.requests) {
        assert.equal(req.method, "POST");
        assert.equal(new URL(req.url).pathname, "/graphql/");
        assert.deepEqual(req.bodyKeys, ["query"]);
        assert.equal(req.headers.AgendaId, AGENDA);
      }
    }
  }
});

test("contract: every request validates against the live schema", async () => {
  for (const tool of tools) {
    for (const { label, args } of callsFor(tool)) {
      fake.requests.length = 0;
      await call(tool.name, args);
      for (const req of fake.requests) {
        const { errors, skOnly } = validate(req.query);
        assert.deepEqual(errors, [], `${tool.name} (${label})`);
        if (!SK_TOOLS.has(tool.name)) assert.deepEqual(skOnly, [], `${tool.name} (${label}) fails on Czech agendas`);
      }
    }
  }
});

test("finding 1: internal documents, liabilities and receivables query their own schema fields", async () => {
  for (const name of ["m3_internal_documents", "m3_liabilities", "m3_receivables"]) {
    await call(name, {});
    const q = last();
    assert.match(q, /dateOfAccountingEvent/);
    assert.match(q, /totalWithVatHc/);
    assert.match(q, /normalItems/);
    assert.match(q, /centre \{ shortCut/);
    assert.doesNotMatch(q, /\b(dateOfAccounting|isSettled|remainingToPay|totalPriceHcWithVat|vatSummary|costCenter|project|activity|predefinedEntry|text)\b/, name);
    assert.deepEqual(validate(q).errors, [], name);
  }
  await call("m3_liabilities", {});
  assert.match(last(), /remainingAmountToPayHc/);
  await call("m3_internal_documents", {});
  assert.doesNotMatch(last(), /dateOfIssue|dateOfMaturity/);
});

test("finding 2: cash desk documents use ICashVoucher fields", async () => {
  await call("m3_cash_desk_documents", {});
  assert.match(last(), /cashBox \{ shortCut/);
  assert.doesNotMatch(last(), /bankStatementNumber|constantSymbol|specificSymbol|bankAccount/);
  assert.deepEqual(validate(last()).errors, []);
});

test("kept fixes: document reads skip the cache (950ac9a); bank/cash partner uses address (6dca522)", async () => {
  await call("m3_issued_invoices", {});
  await call("m3_issued_invoices", {});
  assert.equal(fake.requests.length, 2);
  for (const name of ["m3_bank_documents", "m3_cash_desk_documents"]) {
    await call(name, {});
    assert.match(last(), /partnerAddress \{\s*address \{ name/, name);
  }
});

test("import status accepts any 8-4-4-4-12 GUID", async () => {
  const r = await call("m3_import_status", { guid: "ABCDEF01-2345-0789-0BCD-EF0123456789" });
  assert.ok(!r.isError, text(r));
});

test("finding 3: isSuccess=false is an error for creates and deletes; import status is queryable", async () => {
  fake.respond = (query) => {
    const data = defaultData(query);
    for (const k of Object.keys(data)) if (data[k].isSuccess) data[k].isSuccess = false;
    return Response.json({ data });
  };
  const created = await call("m3_create_cost_center", { code: "CC1", name: "Synthetic" });
  assert.ok(created.isError, text(created));
  const deleted = await call("m3_delete_liability", { id: 1, year: 2026 });
  assert.ok(deleted.isError, text(deleted));

  fake.respond = (query) => Response.json({ data: defaultData(query) });
  const status = await call("m3_import_status", { guid: "00000000-0000-4000-8000-0000000000bb" });
  assert.ok(!status.isError);
  assert.match(last(), /importStatus\(importGuid: "00000000-0000-4000-8000-0000000000bb"\) \{ guid state stateInfo \}/);
  assert.match(text(status), /IMPORTED/);
});

test("finding 4: every tool carries annotations matching what it does", () => {
  for (const t of tools) {
    const a = t.annotations;
    assert.ok(a, `${t.name} has no annotations`);
    if (t.name.startsWith("m3_delete_") || t.name.startsWith("m3_update_")) assert.deepEqual([a.readOnlyHint, a.destructiveHint], [false, true], t.name);
    else if (t.name.startsWith("m3_create_")) assert.deepEqual([a.readOnlyHint, a.destructiveHint], [false, false], t.name);
    else if (t.name === "m3_graphql") assert.deepEqual([a.destructiveHint, a.openWorldHint], [true, true]);
    else assert.equal(a.readOnlyHint, true, t.name);
  }
});

test("finding 5: enum arguments cannot inject GraphQL and strings are escaped", async () => {
  const bad = await call("m3_create_account", { account: "211", type: 'ACTIVE } ) { guid } } mutation { deleteCompany(company: { id: 1 }' });
  assert.ok(bad.isError);
  assert.equal(fake.requests.length, 0, "nothing may be sent");

  const name = 'Quote " back\\slash \r\n new line';
  const ok = await call("m3_create_account", { account: "211", name, type: "BALANCE_SHEET" });
  assert.ok(!ok.isError, text(ok));
  assert.deepEqual(rootOf(last()), ["createAccountChart"]);
  assert.equal(sentInput().name, name);
  assert.equal(sentInput().type, "BALANCE_SHEET");

  const where = await call("m3_issued_invoices", { where: "{ id: { eq: 1 } }) { totalCount } } mutation { deleteCompany(company: { id: 1 }) { guid } } #" });
  assert.ok(where.isError);
  assert.equal(fake.requests.length, 1, "only the first (valid) call was sent");
});

test("finding 6: a mutation is never resent after a timeout or an error mentioning 401", async () => {
  fake.respond = () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  };
  const r = await call("m3_create_cost_center", { code: "CC1", name: "Synthetic" });
  assert.ok(r.isError);
  assert.match(text(r), /Outcome unknown/);
  assert.equal(fake.requests.length, 1);

  fake.requests.length = 0;
  fake.respond = () => Response.json({ errors: [{ message: "Document 4012026 is locked" }] });
  await call("m3_create_cost_center", { code: "CC1", name: "Synthetic" });
  assert.equal(fake.requests.length, 1);
});

test("finding 7: raw mutations are detected by parsing and never cached; reads are", async () => {
  const mutation = 'mutation { createCentre(centre: { shortCut: "CC9" }) { guid isSuccess } }';
  await call("m3_graphql", { query: mutation });
  await call("m3_graphql", { query: mutation });
  assert.equal(fake.requests.length, 2);

  const read = "{ centres(take: 3) { items { shortCut } totalCount } }";
  await call("m3_graphql", { query: read });
  await call("m3_graphql", { query: read });
  assert.equal(fake.requests.length, 3);
});

test("finding 8: dates are sent as ISO, DD.MM.YYYY input is accepted", async () => {
  const r = await call("m3_create_issued_invoice", {
    dateOfIssue: "02.03.2026", dateOfTaxing: "2026-03-02", dateOfMaturity: "16.03.2026",
    items: [{ description: "Service", amount: 1, unitPriceHc: 100, vatRate: 21 }],
  });
  assert.ok(!r.isError, text(r));
  const input = sentInput();
  assert.deepEqual([input.dateOfIssue, input.dateOfTaxing, input.dateOfMaturity], ["2026-03-02", "2026-03-02", "2026-03-16"]);
  assert.equal(input.items[0].vatRate, 21);
  assert.equal(input.items[0].priceType, "WITHOUT_VAT");
  const bad = await call("m3_create_internal_document", { dateOfAccountingEvent: "31.02.2026" });
  assert.ok(bad.isError);
});

test("finding 9: stock card and address parameters are all sent", async () => {
  await call("m3_create_stock_card", { catalogue: "SKU-1", description: "Synthetic", barCode: "8590000000001", plu: "7", weight: 1.5 });
  assert.deepEqual(sentInput(), { catalogue: "SKU-1", description: "Synthetic", barCode: "8590000000001", plu: "7", weight: 1.5 });

  await call("m3_create_address", { name: "Example s.r.o.", city: "Praha", zip: "11000", countryCode: "CZ", country: "Czechia", identificationNumber: "12345678" });
  const input = sentInput();
  assert.deepEqual(input.businessAddress, {
    name: "Example s.r.o.", municipality: "Praha", municipalityPostalCode: { postalCode: "11000" }, country: { code: "CZ" }, countryName: "Czechia",
  });
  assert.equal(input.identificationNumber, "12345678");
  const params = Object.keys(tools.find((t) => t.name === "m3_create_address").inputSchema.properties);
  assert.ok(!params.includes("iban") && !params.includes("groupCode"));
});

test("finding 10: invoice creates send the partner", async () => {
  await call("m3_create_received_invoice", {
    dateOfIssue: "2026-03-02", dateOfTaxing: "2026-03-02", dateOfMaturity: "2026-03-16",
    partner: { name: "Example s.r.o.", identificationNumber: "12345678", vatIdentificationNumber: "CZ12345678", city: "Praha", countryCode: "CZ" },
    items: [{ description: "Goods", amount: 2, unitPriceHc: 50 }],
  });
  assert.deepEqual(sentInput().partnerAddress, {
    businessAddress: { name: "Example s.r.o.", municipality: "Praha", country: { code: "CZ" } },
    identificationNumber: "12345678",
    vatIdentificationNumber: "CZ12345678",
  });
  assert.deepEqual(validate(last()).errors, []);
});

test("finding 11: collection and field names follow the official examples", async () => {
  await call("m3_inventory_documents", {});
  assert.deepEqual(rootOf(last()), ["stockTakingDocuments"]);
  await call("m3_orders", { type: "issued" });
  assert.deepEqual(rootOf(last()), ["issuedOrders"]);
  await call("m3_employees", {});
  assert.match(last(), /centre \{ shortCut name \}/);
  assert.doesNotMatch(last(), /costCenter|\bcity\b|\bzip\b|dateOfBirth|birthNumber/);
  await call("m3_create_inventory_document", { stockTakingId: 4, stockTakingDocumentId: 2, items: [{ catalogue: "SKU-1", warehouseCode: "MAIN", inventoryAmount: 3 }] });
  assert.deepEqual(sentInput(), {
    stockTakingId: 4, stockTakingDocumentId: 2, items: [{ article: { catalogue: "SKU-1" }, inventoryAmount: 3, warehouse: { code: "MAIN" } }],
  });
});

test("finding 12: hidden deleted records are stated in the list header", async () => {
  fake.respond = () =>
    Response.json({ data: { liabilities: { totalCount: 10, items: [{ id: 1 }, { id: 2, isDeleted: true }, { id: 3 }] } } });
  const r = await call("m3_liabilities", { take: 3 });
  assert.match(text(r), /2 shown, records 1-3 of 10; 1 deleted on this page hidden, total includes deleted/);
});

test("finding 13: a failed connection test is an error", async () => {
  fake.respond = () => new Response("down", { status: 503 });
  const r = await call("m3_connection_test", {});
  assert.ok(r.isError);
  assert.match(text(r), /Connection FAILED/);
});

test("finding 14: the README lists exactly the registered tools", () => {
  const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const listed = [...new Set([...readme.matchAll(/^\| `(m3_[a-z_]+)` \|/gm)].map((m) => m[1]))].sort();
  assert.deepEqual(listed, tools.map((t) => t.name).sort());
  assert.match(readme, new RegExp(`\\*\\*${tools.length} tools\\*\\*`));
});

test("the contract schema is the live SDL", () => {
  assert.match(fs.readFileSync(new URL("../docs/schema.graphql", import.meta.url), "utf8"), /^# Money S3 GraphQL schema from a live S3Api/);
  assert.ok(!fs.existsSync(new URL("../docs/schema-summary.json", import.meta.url)));
});

test("GraphQL errors and HTTP errors on reads are errors, not empty lists", async () => {
  fake.respond = () => Response.json({ errors: [{ message: "Synthetic failure" }] });
  const r = await call("m3_issued_invoices", {});
  assert.ok(r.isError);
  assert.match(text(r), /Synthetic failure/);
});

test("m3_graphql never cuts JSON: large lists drop whole records and say so", async () => {
  const items = Array.from({ length: 2000 }, (_, i) => ({ shortCut: `CC${i}`, name: "Synthetic centre with a longer name" }));
  fake.respond = () => Response.json({ data: { centres: { items, totalCount: 5000 } } });
  const r = await call("m3_graphql", { query: "{ centres(take: 2000) { items { shortCut name } totalCount } }" });
  assert.ok(!r.isError, text(r));
  const json = JSON.parse(r.content[0].text);
  assert.ok(r.content[0].text.length <= 50_000);
  assert.ok(json.centres.items.length > 0 && json.centres.items.length < 2000);
  assert.equal(json.centres.totalCount, 5000);
  assert.match(r.content[1].text, new RegExp(`centres: first ${json.centres.items.length} of 2000 returned items shown`));

  fake.respond = () => Response.json({ data: { __schema: { types: Array.from({ length: 3000 }, (_, i) => ({ name: `Type${i}`, kind: "OBJECT" })) } } });
  const big = await call("m3_graphql", { query: "{ __schema { types { name kind } } }" });
  assert.ok(big.isError);
  assert.match(text(big), /over the 50,000 characters output limit.*__type\(name/s);

  fake.respond = () => Response.json({ data: { centres: { items: [{ note: "x".repeat(60_000) }], totalCount: 1 } } });
  const one = await call("m3_graphql", { query: "{ centres(take: 1) { items { note } totalCount } }" });
  assert.ok(one.isError, "a single record over the limit is not trimmed to an empty list");
});

test("update tools send only the key and the changed fields, refuse key-only calls and are never retried", async () => {
  const r = await call("m3_update_issued_invoice", { documentNumber: "FV2026001", variableSymbol: "2026001" });
  assert.ok(!r.isError, text(r));
  assert.deepEqual(rootOf(last()), ["updateIssuedInvoice"]);
  assert.deepEqual(sentInput(), { documentNumber: "FV2026001", variableSymbol: "2026001" });
  assert.match(last(), /definitionXMLTransfer: \{ shortCut: "UPD_FP\+FV" \}/);
  assert.match(fake.requests.at(-2).query, /issuedInvoices\(take: 10, where: \{ documentNumber: \{ eq: "FV2026001" \} \}\)/);

  fake.requests.length = 0;
  const empty = await call("m3_update_liability", { documentNumber: "ZV001", year: 2026 });
  assert.ok(empty.isError);
  assert.equal(fake.requests.length, 0);
  const noKey = await call("m3_update_address", { email: "info@example.com" });
  assert.ok(noKey.isError);
  assert.match(text(noKey), /guid, code or identificationNumber/);
  assert.equal(fake.requests.length, 0);

  // Values the mappers drop, empty strings and lists, and IČO alone never reach Money S3.
  for (const [name, args] of [
    ["m3_update_issued_invoice", { documentNumber: "FV1", costCenterCode: "" }],
    ["m3_update_issued_invoice", { documentNumber: "FV1", description: "" }],
    ["m3_update_inventory_document", { stockTakingId: 1, stockTakingDocumentId: 1, items: [] }],
    ["m3_update_address", { identificationNumber: "12345678" }],
    ["m3_update_address", { guid: "00000000-0000-4000-8000-000000000001", street: "" }],
  ]) {
    const refused = await call(name, args);
    assert.ok(refused.isError, `${name} ${JSON.stringify(args)}: ${text(refused)}`);
  }
  assert.equal(fake.requests.length, 0);
  const params = (name) => Object.keys(tools.find((t) => t.name === name).inputSchema.properties);
  assert.ok(!params("m3_update_bank_document").includes("isExpense") && !params("m3_update_issued_invoice").includes("isCreditNote"));
  assert.ok(!params("m3_update_liability").includes("partner") && !params("m3_update_cash_desk_document").includes("partner"));

  await call("m3_update_address", { code: "P1", discount: 0, creditLimit: 0 });
  assert.deepEqual(sentInput(), { code: "P1", discount: 0, isDiscount: false, creditValue: 0, isCredit: false });
  await call("m3_update_address", { identificationNumber: "12345678", email: "info@example.com" });
  assert.deepEqual(sentInput(), { identificationNumber: "12345678", email: "info@example.com" });
  await call("m3_update_stock_document", { documentNumber: "PR001", description: "Synthetic" });
  assert.deepEqual(sentInput(), { documentNumber: "PR001", description: "Synthetic", items: [] });
  await call("m3_update_wage", { personalNumber: "00001", year: 2026, month: 3, note: "Synthetic" });
  assert.deepEqual(sentInput(), { employee: { personalNumber: "00001" }, year: "2026", month: "3", note: "Synthetic" });
  await call("m3_update_cost_center", { code: "CC1", note: "Synthetic" });
  assert.deepEqual(sentInput(), { shortCut: "CC1", note: "Synthetic" });

  fake.requests.length = 0;
  fake.respond = (query) => {
    if (!query.startsWith("mutation")) return Response.json({ data: defaultData(query) });
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  };
  const lost = await call("m3_update_receivable", { documentNumber: "PH001", description: "Synthetic" });
  assert.ok(lost.isError);
  assert.match(text(lost), /Outcome unknown.*m3_receivables/s);
  assert.equal(fake.requests.length, 2, "one lookup, one mutation, no resend");

  fake.respond = (query) =>
    Response.json({ data: query.startsWith("mutation") ? { updateCentre: { guid: "00000000-0000-4000-8000-0000000000bb", isSuccess: false } } : defaultData(query) });
  const rejected = await call("m3_update_cost_center", { code: "CC1", name: "Synthetic" });
  assert.ok(rejected.isError);
  assert.match(text(rejected), /did not accept/);
});

test("enum arguments take the live schema's values", async () => {
  const bad = await call("m3_create_account", { account: "211", type: "ACTIVE" });
  assert.ok(bad.isError, "ACTIVE is a subtype1 value, not an AccountChartType");
  const ok = await call("m3_create_account", { account: "211", type: "BALANCE_SHEET", subtype1: "ACTIVE" });
  assert.ok(!ok.isError, text(ok));
  assert.deepEqual([sentInput().type, sentInput().subtype1], ["BALANCE_SHEET", "ACTIVE"]);
});

test("updates read the record first and send nothing when it is missing, ambiguous or deleted", async () => {
  const page = (items) => (query) =>
    Response.json({ data: query.startsWith("mutation") ? defaultData(query) : { [rootOf(query)[0]]: { items, totalCount: items.length } } });
  const mutations = () => fake.requests.filter((r) => r.query.startsWith("mutation")).length;

  fake.respond = page([]);
  const missing = await call("m3_update_issued_invoice", { documentNumber: "NOPE", description: "Synthetic" });
  assert.ok(missing.isError);
  assert.match(text(missing), /no issuedInvoices record matches.*nothing was sent/);

  fake.respond = page([{ __typename: "ILiability", isDeleted: true }]);
  const deleted = await call("m3_update_liability", { documentNumber: "ZV1", description: "Synthetic" });
  assert.match(text(deleted), /no liabilities record matches/);

  fake.respond = page([{ __typename: "ICompany" }, { __typename: "ICompany" }]);
  const twice = await call("m3_update_address", { identificationNumber: "12345678", email: "info@example.com" });
  assert.match(text(twice), /2 companies records match.*narrow the key/);
  assert.match(fake.requests.at(-1).query, /identificationNumber: \{ eq: "12345678" \}/);
  assert.equal(mutations(), 0);

  // Year-scoped code lists may match once per year.
  const perYear = await call("m3_update_cost_center", { code: "CC1", name: "Synthetic" });
  assert.ok(!perYear.isError, text(perYear));
  assert.equal(mutations(), 1);

  fake.respond = () => new Response("down", { status: 503 });
  const down = await call("m3_update_liability", { documentNumber: "ZV1", year: 2026, description: "Synthetic" });
  assert.match(text(down), /could not read the record before updating, nothing was sent/);
  assert.equal(mutations(), 1);
});
