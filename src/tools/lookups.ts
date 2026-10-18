import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { READ, buildArgs, errorResult, listParams, listTool, str, textResult } from "./helpers.js";

type Rec = Record<string, unknown>;

// [tool, description, root query, title, fields, line format]; fields from docs/schema.graphql.
const LOOKUPS: Array<[string, string, string, string, string, (item: Rec) => string]> = [
  ["m3_currencies", "List currencies with their country and rate unit (rates: m3_exchange_rates).", "currencies", "Currencies", "code country exchangeRateAmount",
    (c) => `- **${str(c.code)}** ${str(c.country)} (rate unit: ${str(c.exchangeRateAmount)})`],
  ["m3_vat_classifications", "List VAT classifications (členění DPH).", "vatClassifications", "VAT Classifications", "shortCut description type vatReturnRow",
    (v) => `- **${str(v.shortCut)}** ${str(v.description)} (type: ${str(v.type)}, VAT return row: ${str(v.vatReturnRow)})`],
  ["m3_vat_purposes", "List VAT purposes (účel DPH) with their coefficient. Slovak (SK legislation) agendas only: Czech agendas reject this query.", "vatPurposes", "VAT Purposes", "shortCut description coefficient",
    (v) => `- **${str(v.shortCut)}** ${str(v.description)} (coefficient: ${str(v.coefficient)})`],
  ["m3_constant_symbols", "List constant symbols (konstantní symboly).", "constantSymbols", "Constant Symbols", "code description",
    (c) => `- **${str(c.code)}** ${str(c.description)}`],
  ["m3_countries", "List country codes.", "countries", "Countries", "code name", (c) => `- **${str(c.code)}** ${str(c.name)}`],
];

// m3_code_lists: list name -> [root query, title, fields]. eshops is left out on
// purpose: its records hold FTP passwords and mail settings.
const CODE_LISTS = {
  job_order_types: ["jobOrderTypes", "Job Order Types", "shortCut name note"],
  address_keys: ["addressKeys", "Address Keys", "shortCut description isPreferred note"],
  shippings: ["shippings", "Shipping Methods", "shortCut name note"],
  combined_nomenclatures: ["combinedNomenclatures", "Combined Nomenclature", "code name measureUnit type"],
  postal_codes: ["municipalityPostalCodes", "Postal Codes", "postalCode municipality post region countryCode"],
  non_monetary_payments: ["nonMonetaryPayments", "Non-monetary Payments", "code description type amount variableSymbol"],
  xml_transfer_definitions: ["definitionXMLTransfers", "XML Transfer Definitions", "shortCut description type systemDefinition isCsw note"],
  employment_codes: ["employmentCode", "Employment Codes", "code name"],
  employment_types: ["employmentType", "Employment Types", "id name"],
  stock_taking_types: ["stockTakingTypes", "Stocktaking Types", "shortCut name note"],
  banks: ["banks", "Banks", "code shortCut name swift countryCode"],
  parameters: ["parameters", "Stock Card Parameters", "id name type measureUnit userCode values"],
  account_movements: ["accountMovements", "Tax Record Movements", "shortCut description type column year note"],
} as const;
type CodeList = keyof typeof CODE_LISTS;

/** One line per record: every non-empty field, the first in bold. */
function plainLine(item: Rec): string {
  const parts = Object.entries(item)
    .filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && !v.length))
    .map(([k, v], i) => (i === 0 ? `**${v}**` : `${k}: ${Array.isArray(v) ? v.join(", ") : v}`));
  return `- ${parts.join(" | ")}`;
}

export function registerLookupTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_numerical_series",
    "List numerical series (numbering rules) for all document types. Read-only.",
    {
      take: z.number().min(1).max(200).default(50),
      skip: z.number().min(0).default(0),
      where: z.string().optional().describe("GraphQL where filter"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    READ,
    async ({ take, skip, where, order }) => {
      try {
        const gql = `{ numericalSeries(${buildArgs(take, skip, where, order)}) {
        items {
          prefix number name
          isInvoicesIssued isInvoicesReceived
          isCashVouchersReceived isBankStatementsReceived
          isLiabilities isReceivables isInternalDocuments
          year
          centre { shortCut }
        }
        totalCount
      } }`;

        const data = await m3.query<{ numericalSeries: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const ns = data.numericalSeries;
        if (!ns?.items?.length) return textResult("No numerical series found.");

        const lines = [`# Numerical Series (${ns.items.length} of ${ns.totalCount})`, ""];
        for (const s of ns.items) {
          const types: string[] = [];
          if (s.isInvoicesIssued) types.push("Issued Inv.");
          if (s.isInvoicesReceived) types.push("Received Inv.");
          if (s.isCashVouchersReceived) types.push("Cash Vouchers");
          if (s.isBankStatementsReceived) types.push("Bank Stmt.");
          if (s.isLiabilities) types.push("Liabilities");
          if (s.isReceivables) types.push("Receivables");
          if (s.isInternalDocuments) types.push("Internal Docs");
          const centre = s.centre as Record<string, unknown> | undefined;
          lines.push(`- **${s.prefix ?? "—"}** ${s.name ?? "—"} (num: ${s.number ?? "?"}, year: ${s.year ?? "?"})${types.length ? ` [${types.join(", ")}]` : ""}${centre?.shortCut ? ` CC:${centre.shortCut}` : ""}`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  for (const [name, description, root, title, fields, format] of LOOKUPS) {
    server.tool(name, `${description} Read-only.`, listParams(200, 50), READ, async (args) => listTool(m3, root, fields, title, args, format, "\n"));
  }

  server.tool(
    "m3_code_lists",
    "List one of the smaller code lists (číselníky): job order types, address keys, shipping methods, combined nomenclature, postal codes, non-monetary payments, XML transfer definitions (the definitionShortcut values of write tools), employment codes and types, stocktaking types, banks, stock card parameters, tax record movements (pohyby). Read-only.",
    { list: z.enum(Object.keys(CODE_LISTS) as [CodeList, ...CodeList[]]).describe("Code list to read"), ...listParams(200, 50) },
    READ,
    async ({ list, ...args }) => {
      const [root, title, fields] = CODE_LISTS[list];
      return listTool(m3, root, fields, title, args, plainLine, "\n");
    },
  );

  server.tool(
    "m3_years",
    "List the accounting years of the active agenda with their date ranges. Read-only.",
    {},
    READ,
    async () => {
      try {
        const data = await m3.query<{ years: Rec[] | null }>("{ years { year dateFrom dateTo } }");
        const years = data.years ?? [];
        const lines = years.map((y) => `- **${str(y.year)}**: ${str(y.dateFrom).slice(0, 10)} to ${str(y.dateTo).slice(0, 10)}`);
        return textResult(`# Accounting Years (${years.length})\n\n${lines.join("\n") || "Nothing to show."}`);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_exchange_rates",
    "List exchange rate lists (kurzovní lístky) by date and bank with the rate per currency. Read-only.",
    listParams(100, 10),
    READ,
    async (args) =>
      listTool(
        m3,
        "exchangeLists",
        "sequence date bank { shortCut name } exchangeRates { currency { code } country exchangeRateAmount foreignExchangeAverage currencyPurchase currencySale }",
        "Exchange Rate Lists",
        args,
        (l) => {
          const rates = (l.exchangeRates as Rec[] | undefined) ?? [];
          return [
            `## ${str(l.date)} (${str((l.bank as Rec | undefined)?.name, "no bank")}, sequence ${str(l.sequence)})`,
            ...rates.map(
              (r) => `- ${str((r.currency as Rec | null | undefined)?.code ?? r.country)}: ${str(r.foreignExchangeAverage)} per ${str(r.exchangeRateAmount)} (buy ${str(r.currencyPurchase)}, sell ${str(r.currencySale)})`,
            ),
          ].join("\n");
        },
      ),
  );

  server.tool(
    "m3_crm_activities",
    "List CRM activity records (log of user actions on documents/contacts). Read-only.",
    {
      take: z.number().min(1).max(200).default(50),
      skip: z.number().min(0).default(0),
      where: z.string().optional().describe("GraphQL where filter"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    READ,
    async ({ take, skip, where, order }) => {
      try {
        const gql = `{ activities(${buildArgs(take, skip, where, order)}) {
        items {
          dateOfStart description activityType
          documentNumber employee
          company { id }
          isDone note
        }
        totalCount
      } }`;

        const data = await m3.query<{ activities: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const act = data.activities;
        if (!act?.items?.length) return textResult("No CRM activities found.");

        const lines = [`# CRM Activities (${act.items.length} of ${act.totalCount})`, ""];
        for (const a of act.items) {
          const comp = a.company as Record<string, unknown> | undefined;
          lines.push(`- **${a.dateOfStart ?? "—"}** ${a.description ?? "—"} (type: ${a.activityType ?? "?"})${a.documentNumber ? ` doc: ${a.documentNumber}` : ""}${a.employee ? ` by: ${a.employee}` : ""}${comp?.id ? ` company: ${comp.id}` : ""}${a.isDone ? " [DONE]" : ""}`);
          if (a.note) lines.push(`  Note: ${a.note}`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
}
