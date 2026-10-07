// End-to-end tests: the real tool handlers from dist/ run against a fake Money S3
// transport (scripts/fake-money.mjs). Run with `npm test` (builds first).
// All data here is synthetic. Set M3_DIST to test another build.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parse, valueFromASTUntyped } from "graphql";
import { startFake, defaultData, AGENDA } from "../scripts/fake-money.mjs";
import { argsFor, validate } from "../scripts/contract-lib.mjs";

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
  m3_vat_purposes: ["vatPurposes"], m3_constant_symbols: ["constantSymbols"], m3_countries: ["countries"], m3_flags: ["flags"],
  m3_crm_activities: ["activities"], m3_create_account: ["createAccountChart"], m3_create_predefined_entry: ["createAccountAssignmentAcc"],
  m3_delete_internal_document: ["deleteInternalDocument"], m3_delete_liability: ["deleteLiability"], m3_delete_receivable: ["deleteReceivable"],
  m3_delete_bank_document: ["deleteBankStatement"], m3_delete_cash_desk_document: ["deleteCashVoucher"], m3_delete_stock_card: ["deleteArticle"],
  m3_delete_stock_document: ["deleteReceivedSlip"], m3_delete_inventory_document: ["deleteStockTakingDocument"], m3_create_wage: ["createWage"],
};

test("every tool sends the expected GraphQL request and succeeds", async () => {
  assert.deepEqual(tools.map((t) => t.name).sort(), Object.keys(ROOTS).sort());
  for (const tool of tools) {
    for (const requiredOnly of [false, true]) {
      fake.requests.length = 0;
      fake.m3.setAgendaGuid(AGENDA);
      const r = await call(tool.name, argsFor(tool, requiredOnly));
      assert.ok(!r.isError, `${tool.name}: ${text(r)}`);
      assert.deepEqual(fake.requests.flatMap((q) => rootOf(q.query)), ROOTS[tool.name], tool.name);
      for (const req of fake.requests) {
        assert.equal(req.method, "POST");
        assert.equal(new URL(req.url).pathname, "/graphql/");
        assert.deepEqual(req.bodyKeys, ["query"]);
        assert.equal(req.headers.AgendaId, AGENDA);
      }
    }
  }
});

test("contract: no request uses a field the schema summary rules out", async () => {
  for (const tool of tools) {
    fake.requests.length = 0;
    await call(tool.name, argsFor(tool));
    for (const req of fake.requests) assert.deepEqual(validate(req.query).errors, [], tool.name);
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
    if (t.name.startsWith("m3_delete_")) assert.equal(a.destructiveHint, true, t.name);
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
  const ok = await call("m3_create_account", { account: "211", name, type: "ACTIVE" });
  assert.ok(!ok.isError, text(ok));
  assert.deepEqual(rootOf(last()), ["createAccountChart"]);
  assert.equal(sentInput().name, name);
  assert.equal(sentInput().type, "ACTIVE");

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
  assert.doesNotMatch(last(), /costCenter|\bcity\b|\bzip\b/);
  await call("m3_create_inventory_document", { items: [{ catalogue: "SKU-1", warehouseCode: "MAIN", inventoryAmount: 3 }] });
  assert.deepEqual(sentInput().items, [{ article: { catalogue: "SKU-1" }, inventoryAmount: 3, warehouse: { code: "MAIN" } }]);
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

test("finding 15: the hand-written schema summary is named as such", () => {
  assert.ok(fs.existsSync(new URL("../docs/schema-summary.json", import.meta.url)));
  assert.ok(!fs.existsSync(new URL("../schema-introspection.json", import.meta.url)));
});

test("GraphQL errors and HTTP errors on reads are errors, not empty lists", async () => {
  fake.respond = () => Response.json({ errors: [{ message: "Synthetic failure" }] });
  const r = await call("m3_issued_invoices", {});
  assert.ok(r.isError);
  assert.match(text(r), /Synthetic failure/);
});
