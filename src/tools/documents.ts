import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";

function paginationArgs(take: number, skip: number, where?: string): string {
  const parts: string[] = [`take: ${take}`, `skip: ${skip}`];
  if (where) parts.push(`where: ${where}`);
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
    },
    async ({ take, skip, where }) => {
      const gql = `{ internalDocuments(${paginationArgs(take, skip, where)}) { ${GENERIC_DOC_FIELDS} } }`;
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
    },
    async ({ take, skip, where }) => {
      const gql = `{ liabilities(${paginationArgs(take, skip, where)}) { ${GENERIC_DOC_FIELDS} } }`;
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
    },
    async ({ take, skip, where }) => {
      const gql = `{ receivables(${paginationArgs(take, skip, where)}) { ${GENERIC_DOC_FIELDS} } }`;
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
    },
    async ({ take, skip, where }) => {
      const gql = `{ inventoryDocuments(${paginationArgs(take, skip, where)}) {
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
      dateOfIssue: z.string().describe("Date (DD.MM.YYYY)"),
      documentNumber: z.string().optional(),
      text: z.string().optional(),
      totalAmount: z.number().optional(),
      definitionShortcut: z.string().default("_ID").describe("XML transfer definition shortcut"),
    },
    async (params) => {
      const fields = [
        `dateOfIssue: "${params.dateOfIssue}"`,
        params.documentNumber ? `documentNumber: "${params.documentNumber}"` : "",
        params.text ? `text: "${params.text}"` : "",
        params.totalAmount != null ? `totalPriceHcWithVat: ${params.totalAmount}` : "",
      ].filter(Boolean).join(", ");

      const gql = `mutation {
  createInternalDocument(
    internalDocument: { ${fields} }
    definitionXMLTransfer: { shortCut: "${params.definitionShortcut}" }
  ) { guid isSuccess }
}`;

      const data = await m3.query<{ createInternalDocument: { guid: string; isSuccess: boolean } }>(gql, true);
      const result = data.createInternalDocument;
      return { content: [{ type: "text", text: `Internal document ${result.isSuccess ? "created" : "queued"}.\nGUID: \`${result.guid}\`` }] };
    },
  );
}
