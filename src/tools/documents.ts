import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { escGql } from "./helpers.js";

function paginationArgs(take: number, skip: number, where?: string, order?: string): string {
  const parts: string[] = [`take: ${take}`, `skip: ${skip}`];
  if (where) parts.push(`where: ${where}`);
  if (order) parts.push(`order: ${order}`);
  return parts.join(", ");
}

const GENERIC_DOC_FIELDS = `
  items {
    id documentNumber dateOfIssue
    totalPriceHcWithVat totalPriceHcWithoutVat
    partnerAddress { businessAddress { name } company { identificationNumber } }
    variableSymbol text
  }
  totalCount
`;

function formatDocs(entityName: string, data: { items: Record<string, unknown>[]; totalCount: number }): string {
  if (!data?.items?.length) return `No ${entityName} found.`;

  const lines = [`# ${entityName} (${data.items.length} of ${data.totalCount})`, ""];
  for (const d of data.items) {
    const partner = d.partnerAddress as Record<string, unknown> | undefined;
    const biz = partner?.businessAddress as Record<string, unknown> | undefined;
    lines.push(`- **${d.documentNumber ?? "—"}** (${d.dateOfIssue ?? "—"}) — ${biz?.name ?? "—"} — ${d.totalPriceHcWithVat ?? "?"}`);
    if (d.text) lines.push(`  ${d.text}`);
  }
  return lines.join("\n");
}

export function registerDocumentTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_internal_documents",
    "Query internal documents with pagination",
    {
      take: z.number().min(1).max(100).default(20),
      skip: z.number().min(0).default(0),
      where: z.string().optional(),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      const gql = `{ internalDocuments(${paginationArgs(take, skip, where, order)}) { ${GENERIC_DOC_FIELDS} } }`;
      const data = await m3.query<{ internalDocuments: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
      return { content: [{ type: "text", text: formatDocs("Internal Documents", data.internalDocuments) }] };
    },
  );

  server.tool(
    "m3_liabilities",
    "Query liabilities (payables/obligations) with pagination",
    {
      take: z.number().min(1).max(100).default(20),
      skip: z.number().min(0).default(0),
      where: z.string().optional(),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      const gql = `{ liabilities(${paginationArgs(take, skip, where, order)}) { ${GENERIC_DOC_FIELDS} } }`;
      const data = await m3.query<{ liabilities: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
      return { content: [{ type: "text", text: formatDocs("Liabilities", data.liabilities) }] };
    },
  );

  server.tool(
    "m3_receivables",
    "Query receivables (amounts owed to you) with pagination",
    {
      take: z.number().min(1).max(100).default(20),
      skip: z.number().min(0).default(0),
      where: z.string().optional(),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      const gql = `{ receivables(${paginationArgs(take, skip, where, order)}) { ${GENERIC_DOC_FIELDS} } }`;
      const data = await m3.query<{ receivables: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
      return { content: [{ type: "text", text: formatDocs("Receivables", data.receivables) }] };
    },
  );

  server.tool(
    "m3_inventory_documents",
    "Query inventory (stocktaking) documents with pagination",
    {
      take: z.number().min(1).max(100).default(20),
      skip: z.number().min(0).default(0),
      where: z.string().optional(),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      const gql = `{ inventoryDocuments(${paginationArgs(take, skip, where, order)}) {
        items {
          id documentNumber dateOfIssue
          items { stockCard { name catalogueNumber } expectedAmount realAmount }
        }
        totalCount
      } }`;
      const data = await m3.query<{ inventoryDocuments: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
      const inv = data.inventoryDocuments;

      if (!inv?.items?.length) return { content: [{ type: "text", text: "No inventory documents found." }] };

      const lines = [`# Inventory Documents (${inv.items.length} of ${inv.totalCount})`, ""];
      for (const d of inv.items) {
        lines.push(`## ${d.documentNumber ?? "—"} (${d.dateOfIssue ?? "—"})`);
        const items = d.items as Array<Record<string, unknown>> | undefined;
        for (const it of items ?? []) {
          const sc = it.stockCard as Record<string, unknown> | undefined;
          lines.push(`- ${sc?.name ?? "—"} [${sc?.catalogueNumber ?? "—"}]: expected ${it.expectedAmount ?? "?"}, actual ${it.realAmount ?? "?"}`);
        }
        lines.push("");
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  server.tool(
    "m3_create_internal_document",
    "Create an internal document. Async import queue.",
    {
      dateOfIssue: z.string().regex(/^\d{2}\.\d{2}\.\d{4}$/, "Expected DD.MM.YYYY format").describe("Date (DD.MM.YYYY)"),
      documentNumber: z.string().optional(),
      text: z.string().optional(),
      totalAmount: z.number().optional(),
      definitionShortcut: z.string().default("_ID").describe("XML transfer definition shortcut"),
    },
    async (params) => {
      const fields = [
        `dateOfIssue: "${escGql(params.dateOfIssue)}"`,
        params.documentNumber ? `documentNumber: "${escGql(params.documentNumber)}"` : "",
        params.text ? `text: "${escGql(params.text)}"` : "",
        params.totalAmount != null ? `totalPriceHcWithVat: ${params.totalAmount}` : "",
      ].filter(Boolean).join(", ");

      const gql = `mutation {
  createInternalDocument(
    internalDocument: { ${fields} }
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
    "Create a liability (závazek/payable). Async import queue.",
    {
      dateOfIssue: z.string().regex(/^\d{2}\.\d{2}\.\d{4}$/, "Expected DD.MM.YYYY format").describe("Date (DD.MM.YYYY)"),
      documentNumber: z.string().optional(),
      totalAmount: z.number().describe("Total amount"),
      variableSymbol: z.string().optional(),
      partnerName: z.string().optional().describe("Partner/creditor name"),
      text: z.string().optional(),
      definitionShortcut: z.string().default("_ZV").describe("XML transfer definition shortcut"),
    },
    async (params) => {
      const fields = [
        `dateOfIssue: "${escGql(params.dateOfIssue)}"`,
        params.documentNumber ? `documentNumber: "${escGql(params.documentNumber)}"` : "",
        `totalPriceHcWithVat: ${params.totalAmount}`,
        params.variableSymbol ? `variableSymbol: "${escGql(params.variableSymbol)}"` : "",
        params.text ? `text: "${escGql(params.text)}"` : "",
      ].filter(Boolean).join(", ");

      const partner = params.partnerName
        ? `partnerAddress: { businessAddress: { name: "${escGql(params.partnerName)}" } }`
        : "";

      const gql = `mutation {
  createLiability(
    liability: { ${fields} ${partner} }
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
    "Create a receivable (pohledávka/amount owed to you). Async import queue.",
    {
      dateOfIssue: z.string().regex(/^\d{2}\.\d{2}\.\d{4}$/, "Expected DD.MM.YYYY format").describe("Date (DD.MM.YYYY)"),
      documentNumber: z.string().optional(),
      totalAmount: z.number().describe("Total amount"),
      variableSymbol: z.string().optional(),
      partnerName: z.string().optional().describe("Partner/debtor name"),
      text: z.string().optional(),
      definitionShortcut: z.string().default("_PH").describe("XML transfer definition shortcut"),
    },
    async (params) => {
      const fields = [
        `dateOfIssue: "${escGql(params.dateOfIssue)}"`,
        params.documentNumber ? `documentNumber: "${escGql(params.documentNumber)}"` : "",
        `totalPriceHcWithVat: ${params.totalAmount}`,
        params.variableSymbol ? `variableSymbol: "${escGql(params.variableSymbol)}"` : "",
        params.text ? `text: "${escGql(params.text)}"` : "",
      ].filter(Boolean).join(", ");

      const partner = params.partnerName
        ? `partnerAddress: { businessAddress: { name: "${escGql(params.partnerName)}" } }`
        : "";

      const gql = `mutation {
  createReceivable(
    receivable: { ${fields} ${partner} }
    definitionXMLTransfer: { shortCut: "${escGql(params.definitionShortcut)}" }
  ) { guid isSuccess }
}`;

      const data = await m3.query<{ createReceivable: { guid: string; isSuccess: boolean } }>(gql, true);
      const result = data.createReceivable;
      return { content: [{ type: "text", text: `Receivable ${result.isSuccess ? "created" : "queued"}.\nGUID: \`${result.guid}\`` }] };
    },
  );

}
