import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";

const INVOICE_FIELDS = `
  items {
    id dateOfIssue dateOfTaxing dateOfMaturity
    documentNumber variableSymbol constantSymbol specificSymbol
    totalPriceHcWithVat totalPriceHcWithoutVat
    currency { code }
    partnerAddress {
      businessAddress { name street city zip country }
      company { identificationNumber vatNumber }
    }
    items { description plu amount unitPriceHc vatRate }
    text
  }
  totalCount
`;

function buildFilter(where?: string, order?: string, take?: number, skip?: number): string {
  const parts: string[] = [];
  if (take != null) parts.push(`take: ${take}`);
  if (skip != null) parts.push(`skip: ${skip}`);
  if (where) parts.push(`where: ${where}`);
  if (order) parts.push(`order: ${order}`);
  return parts.length > 0 ? `(${parts.join(", ")})` : "";
}

function formatInvoice(inv: Record<string, unknown>): string {
  const partner = inv.partnerAddress as Record<string, unknown> | undefined;
  const biz = partner?.businessAddress as Record<string, unknown> | undefined;
  const co = partner?.company as Record<string, unknown> | undefined;
  const items = inv.items as Array<Record<string, unknown>> | undefined;
  const cur = inv.currency as Record<string, unknown> | undefined;

  const lines = [
    `## ${inv.documentNumber ?? "—"}`,
    `- Date: ${inv.dateOfIssue ?? "—"} | Taxing: ${inv.dateOfTaxing ?? "—"} | Maturity: ${inv.dateOfMaturity ?? "—"}`,
    `- Partner: ${biz?.name ?? "—"} (ICO: ${co?.identificationNumber ?? "—"}, VAT: ${co?.vatNumber ?? "—"})`,
    `- Address: ${[biz?.street, biz?.city, biz?.zip, biz?.country].filter(Boolean).join(", ") || "—"}`,
    `- VS: ${inv.variableSymbol ?? "—"} | KS: ${inv.constantSymbol ?? "—"} | SS: ${inv.specificSymbol ?? "—"}`,
    `- Total: ${inv.totalPriceHcWithVat ?? "?"} ${cur?.code ?? "CZK"} (without VAT: ${inv.totalPriceHcWithoutVat ?? "?"})`,
  ];

  if (items && items.length > 0) {
    lines.push("- Items:");
    for (const it of items) {
      lines.push(`  - ${it.description ?? "—"}: ${it.amount ?? 0} × ${it.unitPriceHc ?? 0} (VAT ${it.vatRate ?? "—"}%)`);
    }
  }

  if (inv.text) lines.push(`- Note: ${inv.text}`);
  return lines.join("\n");
}

export function registerInvoiceTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_issued_invoices",
    "Query issued (outgoing) invoices from Money S3 with optional filtering, ordering, and pagination",
    {
      take: z.number().min(1).max(100).default(20).describe("Number of records to return"),
      skip: z.number().min(0).default(0).describe("Number of records to skip"),
      where: z.string().optional().describe("GraphQL where filter, e.g. { dateOfIssue: { gt: \"2024-01-01\" } }"),
      order: z.string().optional().describe("GraphQL order clause, e.g. { dateOfIssue: DESC }"),
    },
    async ({ take, skip, where, order }) => {
      const params = buildFilter(where, order, take, skip);
      const gql = `{ issuedInvoices${params} { ${INVOICE_FIELDS} } }`;
      const data = await m3.query<{ issuedInvoices: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
      const inv = data.issuedInvoices;

      if (!inv?.items?.length) {
        return { content: [{ type: "text", text: "No issued invoices found." }] };
      }

      const header = `# Issued Invoices (${inv.items.length} of ${inv.totalCount})\n`;
      const body = inv.items.map(formatInvoice).join("\n\n");
      return { content: [{ type: "text", text: header + body }] };
    },
  );

  server.tool(
    "m3_received_invoices",
    "Query received (incoming) invoices from Money S3 with optional filtering, ordering, and pagination",
    {
      take: z.number().min(1).max(100).default(20).describe("Number of records to return"),
      skip: z.number().min(0).default(0).describe("Number of records to skip"),
      where: z.string().optional().describe("GraphQL where filter"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      const params = buildFilter(where, order, take, skip);
      const gql = `{ receivedInvoices${params} { ${INVOICE_FIELDS} } }`;
      const data = await m3.query<{ receivedInvoices: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
      const inv = data.receivedInvoices;

      if (!inv?.items?.length) {
        return { content: [{ type: "text", text: "No received invoices found." }] };
      }

      const header = `# Received Invoices (${inv.items.length} of ${inv.totalCount})\n`;
      const body = inv.items.map(formatInvoice).join("\n\n");
      return { content: [{ type: "text", text: header + body }] };
    },
  );

  server.tool(
    "m3_create_issued_invoice",
    "Create a new issued (outgoing) invoice in Money S3. Written to async import queue.",
    {
      dateOfIssue: z.string().describe("Issue date (DD.MM.YYYY)"),
      dateOfTaxing: z.string().describe("Tax date (DD.MM.YYYY)"),
      dateOfMaturity: z.string().describe("Maturity date (DD.MM.YYYY)"),
      documentNumber: z.string().optional().describe("Document number (auto-generated if omitted)"),
      numericalSeriePrefix: z.string().default("").describe("Numerical series prefix"),
      items: z.array(z.object({
        description: z.string(),
        amount: z.number().min(0),
        unitPriceHc: z.number(),
        vatRate: z.string().optional().describe("VAT rate identifier"),
      })).min(1).describe("Invoice line items"),
      definitionShortcut: z.string().default("_FP+FV").describe("XML transfer definition shortcut"),
    },
    async ({ dateOfIssue, dateOfTaxing, dateOfMaturity, documentNumber, numericalSeriePrefix, items, definitionShortcut }) => {
      const itemsGql = items.map((it) =>
        `{ description: "${it.description}", amount: ${it.amount}, unitPriceHc: ${it.unitPriceHc}${it.vatRate ? `, vatRate: ${it.vatRate}` : ""}, warrantyType: CONSTANT, isInverse: false }`
      ).join(", ");

      const docNum = documentNumber ? `documentNumber: "${documentNumber}"` : "";
      const gql = `mutation {
  createIssuedInvoice(
    issuedInvoice: {
      dateOfIssue: "${dateOfIssue}"
      dateOfTaxing: "${dateOfTaxing}"
      dateOfMaturity: "${dateOfMaturity}"
      numericalSerie: { prefix: "${numericalSeriePrefix}" }
      ${docNum}
      items: [${itemsGql}]
    }
    definitionXMLTransfer: { shortCut: "${definitionShortcut}" }
  ) { guid isSuccess }
}`;

      const data = await m3.query<{ createIssuedInvoice: { guid: string; isSuccess: boolean } }>(gql, true);
      const result = data.createIssuedInvoice;
      const status = result.isSuccess ? "queued successfully" : "queued (check import queue for status)";
      return { content: [{ type: "text", text: `Issued invoice ${status}.\nGUID: \`${result.guid}\`` }] };
    },
  );

  server.tool(
    "m3_create_received_invoice",
    "Create a new received (incoming) invoice in Money S3. Written to async import queue.",
    {
      dateOfIssue: z.string().describe("Issue date (DD.MM.YYYY)"),
      dateOfTaxing: z.string().describe("Tax date (DD.MM.YYYY)"),
      dateOfMaturity: z.string().describe("Maturity date (DD.MM.YYYY)"),
      documentNumber: z.string().optional().describe("Document number"),
      numericalSeriePrefix: z.string().default("").describe("Numerical series prefix"),
      items: z.array(z.object({
        description: z.string(),
        amount: z.number().min(0),
        unitPriceHc: z.number(),
        vatRate: z.string().optional(),
      })).min(1).describe("Invoice line items"),
      definitionShortcut: z.string().default("_FP+PF").describe("XML transfer definition shortcut"),
    },
    async ({ dateOfIssue, dateOfTaxing, dateOfMaturity, documentNumber, numericalSeriePrefix, items, definitionShortcut }) => {
      const itemsGql = items.map((it) =>
        `{ description: "${it.description}", amount: ${it.amount}, unitPriceHc: ${it.unitPriceHc}${it.vatRate ? `, vatRate: ${it.vatRate}` : ""}, warrantyType: CONSTANT, isInverse: false }`
      ).join(", ");

      const docNum = documentNumber ? `documentNumber: "${documentNumber}"` : "";
      const gql = `mutation {
  createReceivedInvoice(
    receivedInvoice: {
      dateOfIssue: "${dateOfIssue}"
      dateOfTaxing: "${dateOfTaxing}"
      dateOfMaturity: "${dateOfMaturity}"
      numericalSerie: { prefix: "${numericalSeriePrefix}" }
      ${docNum}
      items: [${itemsGql}]
    }
    definitionXMLTransfer: { shortCut: "${definitionShortcut}" }
  ) { guid isSuccess }
}`;

      const data = await m3.query<{ createReceivedInvoice: { guid: string; isSuccess: boolean } }>(gql, true);
      const result = data.createReceivedInvoice;
      const status = result.isSuccess ? "queued successfully" : "queued (check import queue for status)";
      return { content: [{ type: "text", text: `Received invoice ${status}.\nGUID: \`${result.guid}\`` }] };
    },
  );

  server.tool(
    "m3_delete_invoice",
    "Delete an invoice by ID and year. Fails if the invoice has dependent records (e.g. stock movements).",
    {
      type: z.enum(["issued", "received"]).describe("Invoice type"),
      id: z.number().int().positive().describe("Invoice record ID"),
      year: z.number().int().min(2000).max(2100).describe("Accounting year"),
    },
    async ({ type, id, year }) => {
      const mutationName = type === "issued" ? "deleteIssuedInvoice" : "deleteReceivedInvoice";
      const inputName = type === "issued" ? "issuedInvoice" : "receivedInvoice";
      const gql = `mutation { ${mutationName}(${inputName}: { id: ${id}, year: ${year} }) { guid isSuccess } }`;
      const data = await m3.query<Record<string, { guid: string; isSuccess: boolean }>>(gql, true);
      const result = data[mutationName];
      const status = result.isSuccess ? "deleted" : "deletion queued (check import queue)";
      return { content: [{ type: "text", text: `Invoice ${type} #${id} (${year}): ${status}.\nGUID: \`${result.guid}\`` }] };
    },
  );
}
