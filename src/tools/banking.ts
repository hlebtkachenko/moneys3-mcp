import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { escGql } from "./helpers.js";

const DOC_FIELDS = `
  items {
    id documentNumber dateOfIssue
    totalPriceHcWithVat totalPriceHcWithoutVat
    currency { code }
    partnerAddress { businessAddress { name } company { identificationNumber } }
    variableSymbol constantSymbol specificSymbol
    text
  }
  totalCount
`;

function formatBankDoc(d: Record<string, unknown>): string {
  const partner = d.partnerAddress as Record<string, unknown> | undefined;
  const biz = partner?.businessAddress as Record<string, unknown> | undefined;
  const co = partner?.company as Record<string, unknown> | undefined;
  const cur = d.currency as Record<string, unknown> | undefined;
  return [
    `- **${d.documentNumber ?? "—"}** (${d.dateOfIssue ?? "—"})`,
    `  Partner: ${biz?.name ?? "—"} (${co?.identificationNumber ?? "—"})`,
    `  Amount: ${d.totalPriceHcWithVat ?? "?"} ${cur?.code ?? "CZK"} | VS: ${d.variableSymbol ?? "—"}`,
  ].join("\n");
}

export function registerBankingTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_bank_documents",
    "Query bank documents (payments, transfers) with pagination",
    {
      take: z.number().min(1).max(100).default(20),
      skip: z.number().min(0).default(0),
      where: z.string().optional().describe("GraphQL where filter"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      const parts: string[] = [`take: ${take}`, `skip: ${skip}`];
      if (where) parts.push(`where: ${where}`);
      if (order) parts.push(`order: ${order}`);

      const gql = `{ bankDocuments(${parts.join(", ")}) { ${DOC_FIELDS} } }`;
      const data = await m3.query<{ bankDocuments: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
      const bd = data.bankDocuments;

      if (!bd?.items?.length) return { content: [{ type: "text", text: "No bank documents found." }] };

      const header = `# Bank Documents (${bd.items.length} of ${bd.totalCount})\n`;
      return { content: [{ type: "text", text: header + bd.items.map(formatBankDoc).join("\n\n") }] };
    },
  );

  server.tool(
    "m3_cash_desk_documents",
    "Query cash desk (register) documents with pagination",
    {
      take: z.number().min(1).max(100).default(20),
      skip: z.number().min(0).default(0),
      where: z.string().optional().describe("GraphQL where filter"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      const parts: string[] = [`take: ${take}`, `skip: ${skip}`];
      if (where) parts.push(`where: ${where}`);
      if (order) parts.push(`order: ${order}`);

      const gql = `{ cashDeskDocuments(${parts.join(", ")}) { ${DOC_FIELDS} } }`;
      const data = await m3.query<{ cashDeskDocuments: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
      const cd = data.cashDeskDocuments;

      if (!cd?.items?.length) return { content: [{ type: "text", text: "No cash desk documents found." }] };

      const header = `# Cash Desk Documents (${cd.items.length} of ${cd.totalCount})\n`;
      return { content: [{ type: "text", text: header + cd.items.map(formatBankDoc).join("\n\n") }] };
    },
  );

  server.tool(
    "m3_create_bank_document",
    "Create a bank document (payment). Async import queue.",
    {
      dateOfIssue: z.string().regex(/^\d{2}\.\d{2}\.\d{4}$/, "Expected DD.MM.YYYY format").describe("Date (DD.MM.YYYY)"),
      documentNumber: z.string().optional(),
      totalAmount: z.number().describe("Total amount with VAT"),
      variableSymbol: z.string().optional(),
      partnerName: z.string().optional().describe("Partner company name"),
      text: z.string().optional().describe("Description/note"),
      definitionShortcut: z.string().default("_BD").describe("XML transfer definition shortcut"),
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
        ? `partnerAddress: { businessAddress: { name: "${escGql(params.partnerName!)}" } }`
        : "";

      const gql = `mutation {
  createBankDocument(
    bankDocument: { ${fields} ${partner} }
    definitionXMLTransfer: { shortCut: "${escGql(params.definitionShortcut)}" }
  ) { guid isSuccess }
}`;

      const data = await m3.query<{ createBankDocument: { guid: string; isSuccess: boolean } }>(gql, true);
      const result = data.createBankDocument;
      return { content: [{ type: "text", text: `Bank document ${result.isSuccess ? "created" : "queued"}.\nGUID: \`${result.guid}\`` }] };
    },
  );

  server.tool(
    "m3_create_cash_desk_document",
    "Create a cash desk (register) document. Async import queue.",
    {
      dateOfIssue: z.string().regex(/^\d{2}\.\d{2}\.\d{4}$/, "Expected DD.MM.YYYY format").describe("Date (DD.MM.YYYY)"),
      documentNumber: z.string().optional(),
      totalAmount: z.number().describe("Total amount with VAT"),
      text: z.string().optional().describe("Description/note"),
      definitionShortcut: z.string().default("_PPD").describe("XML transfer definition shortcut"),
    },
    async (params) => {
      const fields = [
        `dateOfIssue: "${escGql(params.dateOfIssue)}"`,
        params.documentNumber ? `documentNumber: "${escGql(params.documentNumber)}"` : "",
        `totalPriceHcWithVat: ${params.totalAmount}`,
        params.text ? `text: "${escGql(params.text)}"` : "",
      ].filter(Boolean).join(", ");

      const gql = `mutation {
  createCashDeskDocument(
    cashDeskDocument: { ${fields} }
    definitionXMLTransfer: { shortCut: "${escGql(params.definitionShortcut)}" }
  ) { guid isSuccess }
}`;

      const data = await m3.query<{ createCashDeskDocument: { guid: string; isSuccess: boolean } }>(gql, true);
      const result = data.createCashDeskDocument;
      return { content: [{ type: "text", text: `Cash desk document ${result.isSuccess ? "created" : "queued"}.\nGUID: \`${result.guid}\`` }] };
    },
  );

  server.tool(
    "m3_bank_accounts",
    "List bank accounts and cash desks configured in Money S3 (read-only)",
    {},
    async () => {
      const gql = `{ bankAccountsAndCashDesks {
        bankAccounts { items { id name bankCode accountNumber iban swift currency { code } } }
        cashDesks { items { id name currency { code } } }
      } }`;

      const data = await m3.query<{ bankAccountsAndCashDesks: {
        bankAccounts: { items: Record<string, unknown>[] };
        cashDesks: { items: Record<string, unknown>[] };
      } }>(gql);

      const ba = data.bankAccountsAndCashDesks;
      const lines = ["# Bank Accounts & Cash Desks", "", "## Bank Accounts"];
      for (const a of ba?.bankAccounts?.items ?? []) {
        const cur = a.currency as Record<string, unknown> | undefined;
        lines.push(`- **${a.name ?? "—"}**: ${a.accountNumber ?? ""}/${a.bankCode ?? ""} (IBAN: ${a.iban ?? "—"}, ${cur?.code ?? "CZK"})`);
      }
      lines.push("", "## Cash Desks");
      for (const c of ba?.cashDesks?.items ?? []) {
        const cur = c.currency as Record<string, unknown> | undefined;
        lines.push(`- **${c.name ?? "—"}** (${cur?.code ?? "CZK"})`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
