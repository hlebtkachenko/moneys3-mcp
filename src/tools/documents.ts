import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { escGql } from "./helpers.js";

const DATE_RE = /^\d{2}\.\d{2}\.\d{4}$/;
const DATE_MSG = "Expected DD.MM.YYYY format";

function buildArgs(take: number, skip: number, where?: string, order?: string): string {
  const parts: string[] = [`take: ${take}`, `skip: ${skip}`];
  if (where) parts.push(`where: ${where}`);
  if (order) parts.push(`order: ${order}`);
  return parts.join(", ");
}

const DOC_FIELDS = `
  items {
    id documentNumber dateOfIssue dateOfAccounting dateOfMaturity
    dateOfPayment isSettled remainingToPay
    totalPriceHcWithVat totalPriceHcWithoutVat
    currency { code }
    vatSummary {
      baseZeroRate baseReducedRate baseStandardRate
      vatReducedRate vatStandardRate
    }
    partnerAddress {
      businessAddress { name street city zip country }
      company { identificationNumber vatNumber }
    }
    variableSymbol constantSymbol specificSymbol
    costCenter { code name }
    project { code name }
    activity { code name }
    account predefinedEntry
    text note
    items { description amount unitPriceHc vatRate }
  }
  totalCount
`;

function formatDoc(d: Record<string, unknown>): string {
  const partner = d.partnerAddress as Record<string, unknown> | undefined;
  const biz = partner?.businessAddress as Record<string, unknown> | undefined;
  const co = partner?.company as Record<string, unknown> | undefined;
  const cur = d.currency as Record<string, unknown> | undefined;
  const vat = d.vatSummary as Record<string, unknown> | undefined;
  const cc = d.costCenter as Record<string, unknown> | undefined;
  const proj = d.project as Record<string, unknown> | undefined;
  const act = d.activity as Record<string, unknown> | undefined;
  const items = d.items as Array<Record<string, unknown>> | undefined;

  const lines = [
    `## ${d.documentNumber ?? "—"} (${d.dateOfIssue ?? "—"})`,
    `- Partner: ${biz?.name ?? "—"} (ICO: ${co?.identificationNumber ?? "—"}, VAT: ${co?.vatNumber ?? "—"})`,
    `- Address: ${[biz?.street, biz?.city, biz?.zip, biz?.country].filter(Boolean).join(", ") || "—"}`,
    `- VS: ${d.variableSymbol ?? "—"} | KS: ${d.constantSymbol ?? "—"} | SS: ${d.specificSymbol ?? "—"}`,
    `- Total: ${d.totalPriceHcWithVat ?? "?"} ${cur?.code ?? "CZK"} (without VAT: ${d.totalPriceHcWithoutVat ?? "?"})`,
  ];

  if (d.dateOfMaturity) {
    lines.push(`- Maturity: ${d.dateOfMaturity} | Paid: ${d.isSettled ? `Yes (${d.dateOfPayment ?? "—"})` : `No — remaining: ${d.remainingToPay ?? "?"}`}`);
  }

  if (vat) {
    const vatParts = [];
    if (vat.baseStandardRate) vatParts.push(`standard: ${vat.baseStandardRate} + ${vat.vatStandardRate}`);
    if (vat.baseReducedRate) vatParts.push(`reduced: ${vat.baseReducedRate} + ${vat.vatReducedRate}`);
    if (vatParts.length > 0) lines.push(`- VAT: ${vatParts.join(" | ")}`);
  }

  const ctrl = [cc?.code && `CC:${cc.code}`, proj?.code && `Proj:${proj.code}`, act?.code && `Act:${act.code}`].filter(Boolean);
  if (ctrl.length > 0) lines.push(`- Controlling: ${ctrl.join(" ")}`);
  if (d.account) lines.push(`- Account: ${d.account} | Entry: ${d.predefinedEntry ?? "—"}`);

  if (items && items.length > 0) {
    lines.push("- Items:");
    for (const it of items) {
      lines.push(`  - ${it.description ?? "—"}: ${it.amount ?? 0} × ${it.unitPriceHc ?? 0} (VAT ${it.vatRate ?? "—"}%)`);
    }
  }

  if (d.text) lines.push(`- Text: ${d.text}`);
  if (d.note) lines.push(`- Note: ${d.note}`);
  return lines.join("\n");
}

function formatSimpleDocs(entityName: string, data: { items: Record<string, unknown>[]; totalCount: number }): string {
  if (!data?.items?.length) return `No ${entityName} found.`;
  const header = `# ${entityName} (${data.items.length} of ${data.totalCount})\n`;
  return header + data.items.map(formatDoc).join("\n\n");
}

export function registerDocumentTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_internal_documents",
    "Query internal documents with VAT breakdown, payment status, controlling variables",
    {
      take: z.number().min(1).max(100).default(20),
      skip: z.number().min(0).default(0),
      where: z.string().optional(),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      const gql = `{ internalDocuments(${buildArgs(take, skip, where, order)}) { ${DOC_FIELDS} } }`;
      const data = await m3.query<{ internalDocuments: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
      return { content: [{ type: "text", text: formatSimpleDocs("Internal Documents", data.internalDocuments) }] };
    },
  );

  server.tool(
    "m3_liabilities",
    "Query liabilities (payables/obligations) with VAT, payment status, maturity dates, controlling vars",
    {
      take: z.number().min(1).max(100).default(20),
      skip: z.number().min(0).default(0),
      where: z.string().optional(),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      const gql = `{ liabilities(${buildArgs(take, skip, where, order)}) { ${DOC_FIELDS} } }`;
      const data = await m3.query<{ liabilities: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
      return { content: [{ type: "text", text: formatSimpleDocs("Liabilities", data.liabilities) }] };
    },
  );

  server.tool(
    "m3_receivables",
    "Query receivables (amounts owed to you) with VAT, payment status, maturity dates, controlling vars",
    {
      take: z.number().min(1).max(100).default(20),
      skip: z.number().min(0).default(0),
      where: z.string().optional(),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      const gql = `{ receivables(${buildArgs(take, skip, where, order)}) { ${DOC_FIELDS} } }`;
      const data = await m3.query<{ receivables: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
      return { content: [{ type: "text", text: formatSimpleDocs("Receivables", data.receivables) }] };
    },
  );

  server.tool(
    "m3_inventory_documents",
    "Query inventory (stocktaking) documents with line items and expected vs real amounts",
    {
      take: z.number().min(1).max(100).default(20),
      skip: z.number().min(0).default(0),
      where: z.string().optional(),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      const gql = `{ inventoryDocuments(${buildArgs(take, skip, where, order)}) {
        items {
          id documentNumber dateOfIssue
          warehouse { name code }
          items {
            stockCard { name catalogueNumber }
            expectedAmount realAmount difference
            unitPriceHc
          }
        }
        totalCount
      } }`;
      const data = await m3.query<{ inventoryDocuments: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
      const inv = data.inventoryDocuments;
      if (!inv?.items?.length) return { content: [{ type: "text", text: "No inventory documents found." }] };

      const lines = [`# Inventory Documents (${inv.items.length} of ${inv.totalCount})`, ""];
      for (const d of inv.items) {
        const wh = d.warehouse as Record<string, unknown> | undefined;
        lines.push(`## ${d.documentNumber ?? "—"} (${d.dateOfIssue ?? "—"})${wh?.name ? ` — Warehouse: ${wh.name}` : ""}`);
        const items = d.items as Array<Record<string, unknown>> | undefined;
        for (const it of items ?? []) {
          const sc = it.stockCard as Record<string, unknown> | undefined;
          lines.push(`- ${sc?.name ?? "—"} [${sc?.catalogueNumber ?? "—"}]: expected ${it.expectedAmount ?? "?"}, actual ${it.realAmount ?? "?"}, diff ${it.difference ?? "?"} (@ ${it.unitPriceHc ?? "?"})`);
        }
        lines.push("");
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  server.tool(
    "m3_create_internal_document",
    "Create an internal document with controlling variables. Async import queue.",
    {
      dateOfIssue: z.string().regex(DATE_RE, DATE_MSG).describe("Date (DD.MM.YYYY)"),
      documentNumber: z.string().optional(),
      text: z.string().optional(),
      totalAmount: z.number().optional(),
      costCenterCode: z.string().optional().describe("Cost center code"),
      projectCode: z.string().optional().describe("Project code"),
      activityCode: z.string().optional().describe("Activity code"),
      definitionShortcut: z.string().default("_ID").describe("XML transfer definition shortcut"),
    },
    async (params) => {
      const fields = [
        `dateOfIssue: "${escGql(params.dateOfIssue)}"`,
        params.documentNumber ? `documentNumber: "${escGql(params.documentNumber)}"` : "",
        params.text ? `text: "${escGql(params.text)}"` : "",
        params.totalAmount != null ? `totalPriceHcWithVat: ${params.totalAmount}` : "",
      ].filter(Boolean).join(", ");

      const extras = [
        params.costCenterCode ? `costCenter: { code: "${escGql(params.costCenterCode)}" }` : "",
        params.projectCode ? `project: { code: "${escGql(params.projectCode)}" }` : "",
        params.activityCode ? `activity: { code: "${escGql(params.activityCode)}" }` : "",
      ].filter(Boolean).join("\n      ");

      const gql = `mutation {
  createInternalDocument(
    internalDocument: { ${fields} ${extras} }
    definitionXMLTransfer: { shortCut: "${escGql(params.definitionShortcut)}" }
  ) { guid isSuccess }
}`;

      const data = await m3.query<{ createInternalDocument: { guid: string; isSuccess: boolean } }>(gql, true);
      const result = data.createInternalDocument;
      return { content: [{ type: "text", text: `Internal document ${result.isSuccess ? "created" : "queued"}.\nGUID: \`${result.guid}\`` }] };
    },
  );

  server.tool(
    "m3_create_liability",
    "Create a liability (závazek/payable) with maturity date and controlling vars. Async import queue.",
    {
      dateOfIssue: z.string().regex(DATE_RE, DATE_MSG).describe("Date (DD.MM.YYYY)"),
      dateOfMaturity: z.string().regex(DATE_RE, DATE_MSG).optional().describe("Maturity date (DD.MM.YYYY)"),
      documentNumber: z.string().optional(),
      totalAmount: z.number().describe("Total amount"),
      variableSymbol: z.string().optional(),
      partnerName: z.string().optional().describe("Partner/creditor name"),
      partnerIco: z.string().optional().describe("Partner ICO"),
      costCenterCode: z.string().optional(),
      projectCode: z.string().optional(),
      activityCode: z.string().optional(),
      text: z.string().optional(),
      definitionShortcut: z.string().default("_ZV").describe("XML transfer definition shortcut"),
    },
    async (params) => {
      const fields = [
        `dateOfIssue: "${escGql(params.dateOfIssue)}"`,
        params.dateOfMaturity ? `dateOfMaturity: "${escGql(params.dateOfMaturity)}"` : "",
        params.documentNumber ? `documentNumber: "${escGql(params.documentNumber)}"` : "",
        `totalPriceHcWithVat: ${params.totalAmount}`,
        params.variableSymbol ? `variableSymbol: "${escGql(params.variableSymbol)}"` : "",
        params.text ? `text: "${escGql(params.text)}"` : "",
      ].filter(Boolean).join(", ");

      const extras = [
        params.partnerName ? `partnerAddress: { businessAddress: { name: "${escGql(params.partnerName)}" }${params.partnerIco ? ` company: { identificationNumber: "${escGql(params.partnerIco)}" }` : ""} }` : "",
        params.costCenterCode ? `costCenter: { code: "${escGql(params.costCenterCode)}" }` : "",
        params.projectCode ? `project: { code: "${escGql(params.projectCode)}" }` : "",
        params.activityCode ? `activity: { code: "${escGql(params.activityCode)}" }` : "",
      ].filter(Boolean).join("\n      ");

      const gql = `mutation {
  createLiability(
    liability: { ${fields} ${extras} }
    definitionXMLTransfer: { shortCut: "${escGql(params.definitionShortcut)}" }
  ) { guid isSuccess }
}`;

      const data = await m3.query<{ createLiability: { guid: string; isSuccess: boolean } }>(gql, true);
      const result = data.createLiability;
      return { content: [{ type: "text", text: `Liability ${result.isSuccess ? "created" : "queued"}.\nGUID: \`${result.guid}\`` }] };
    },
  );

  server.tool(
    "m3_create_receivable",
    "Create a receivable (pohledávka) with maturity date and controlling vars. Async import queue.",
    {
      dateOfIssue: z.string().regex(DATE_RE, DATE_MSG).describe("Date (DD.MM.YYYY)"),
      dateOfMaturity: z.string().regex(DATE_RE, DATE_MSG).optional().describe("Maturity date (DD.MM.YYYY)"),
      documentNumber: z.string().optional(),
      totalAmount: z.number().describe("Total amount"),
      variableSymbol: z.string().optional(),
      partnerName: z.string().optional().describe("Partner/debtor name"),
      partnerIco: z.string().optional().describe("Partner ICO"),
      costCenterCode: z.string().optional(),
      projectCode: z.string().optional(),
      activityCode: z.string().optional(),
      text: z.string().optional(),
      definitionShortcut: z.string().default("_PH").describe("XML transfer definition shortcut"),
    },
    async (params) => {
      const fields = [
        `dateOfIssue: "${escGql(params.dateOfIssue)}"`,
        params.dateOfMaturity ? `dateOfMaturity: "${escGql(params.dateOfMaturity)}"` : "",
        params.documentNumber ? `documentNumber: "${escGql(params.documentNumber)}"` : "",
        `totalPriceHcWithVat: ${params.totalAmount}`,
        params.variableSymbol ? `variableSymbol: "${escGql(params.variableSymbol)}"` : "",
        params.text ? `text: "${escGql(params.text)}"` : "",
      ].filter(Boolean).join(", ");

      const extras = [
        params.partnerName ? `partnerAddress: { businessAddress: { name: "${escGql(params.partnerName)}" }${params.partnerIco ? ` company: { identificationNumber: "${escGql(params.partnerIco)}" }` : ""} }` : "",
        params.costCenterCode ? `costCenter: { code: "${escGql(params.costCenterCode)}" }` : "",
        params.projectCode ? `project: { code: "${escGql(params.projectCode)}" }` : "",
        params.activityCode ? `activity: { code: "${escGql(params.activityCode)}" }` : "",
      ].filter(Boolean).join("\n      ");

      const gql = `mutation {
  createReceivable(
    receivable: { ${fields} ${extras} }
    definitionXMLTransfer: { shortCut: "${escGql(params.definitionShortcut)}" }
  ) { guid isSuccess }
}`;

      const data = await m3.query<{ createReceivable: { guid: string; isSuccess: boolean } }>(gql, true);
      const result = data.createReceivable;
      return { content: [{ type: "text", text: `Receivable ${result.isSuccess ? "created" : "queued"}.\nGUID: \`${result.guid}\`` }] };
    },
  );
}
