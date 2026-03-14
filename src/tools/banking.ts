import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { escGql, DATE_RE, DATE_MSG, buildArgs, textResult, errorResult } from "./helpers.js";

const DOC_FIELDS = `
  items {
    id documentNumber dateOfIssue dateOfAccounting
    totalPriceHcWithVat totalPriceHcWithoutVat remainingToPay
    isSettled dateOfPayment
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

function formatBankDoc(d: Record<string, unknown>): string {
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
    `- Partner: ${biz?.name ?? "—"} (ICO: ${co?.identificationNumber ?? "—"})`,
    `- Address: ${[biz?.street, biz?.city, biz?.zip, biz?.country].filter(Boolean).join(", ") || "—"}`,
    `- VS: ${d.variableSymbol ?? "—"} | KS: ${d.constantSymbol ?? "—"} | SS: ${d.specificSymbol ?? "—"}`,
    `- Total: ${d.totalPriceHcWithVat ?? "?"} ${cur?.code ?? "CZK"} (without VAT: ${d.totalPriceHcWithoutVat ?? "?"})`,
    `- Paid: ${d.isSettled ? `Yes (${d.dateOfPayment ?? "—"})` : `No — remaining: ${d.remainingToPay ?? "?"}`}`,
  ];

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

export function registerBankingTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_bank_documents",
    "Query bank documents (payments, transfers) with VAT breakdown, payment status, controlling variables",
    {
      take: z.number().min(1).max(100).default(20),
      skip: z.number().min(0).default(0),
      where: z.string().optional().describe("GraphQL where filter"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      try {
        const gql = `{ bankDocuments(${buildArgs(take, skip, where, order)}) { ${DOC_FIELDS} } }`;
        const data = await m3.query<{ bankDocuments: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const bd = data.bankDocuments;
        if (!bd?.items?.length) return textResult("No bank documents found.");
        const header = `# Bank Documents (${bd.items.length} of ${bd.totalCount})\n`;
        return textResult(header + bd.items.map(formatBankDoc).join("\n\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_cash_desk_documents",
    "Query cash desk (register) documents with VAT breakdown, payment status, controlling variables",
    {
      take: z.number().min(1).max(100).default(20),
      skip: z.number().min(0).default(0),
      where: z.string().optional().describe("GraphQL where filter"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      try {
        const gql = `{ cashDeskDocuments(${buildArgs(take, skip, where, order)}) { ${DOC_FIELDS} } }`;
        const data = await m3.query<{ cashDeskDocuments: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const cd = data.cashDeskDocuments;
        if (!cd?.items?.length) return textResult("No cash desk documents found.");
        const header = `# Cash Desk Documents (${cd.items.length} of ${cd.totalCount})\n`;
        return textResult(header + cd.items.map(formatBankDoc).join("\n\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_create_bank_document",
    "Create a bank document (payment). Supports controlling variables. Async import queue.",
    {
      dateOfIssue: z.string().regex(DATE_RE, DATE_MSG).describe("Date (DD.MM.YYYY)"),
      documentNumber: z.string().optional(),
      totalAmount: z.number().describe("Total amount with VAT"),
      variableSymbol: z.string().optional(),
      constantSymbol: z.string().optional(),
      specificSymbol: z.string().optional(),
      partnerName: z.string().optional().describe("Partner company name"),
      partnerIco: z.string().optional().describe("Partner ICO"),
      costCenterCode: z.string().optional().describe("Cost center code (středisko)"),
      projectCode: z.string().optional().describe("Project code (zakázka)"),
      activityCode: z.string().optional().describe("Activity code (činnost)"),
      text: z.string().optional().describe("Description/note"),
      definitionShortcut: z.string().default("_BD").describe("XML transfer definition shortcut"),
    },
    async (params) => {
      try {
        const fields = [
          `dateOfIssue: "${escGql(params.dateOfIssue)}"`,
          params.documentNumber ? `documentNumber: "${escGql(params.documentNumber)}"` : "",
          `totalPriceHcWithVat: ${params.totalAmount}`,
          params.variableSymbol ? `variableSymbol: "${escGql(params.variableSymbol)}"` : "",
          params.constantSymbol ? `constantSymbol: "${escGql(params.constantSymbol)}"` : "",
          params.specificSymbol ? `specificSymbol: "${escGql(params.specificSymbol)}"` : "",
          params.text ? `text: "${escGql(params.text)}"` : "",
        ].filter(Boolean).join(", ");

        const extras = [
          params.partnerName ? `partnerAddress: { businessAddress: { name: "${escGql(params.partnerName)}" }${params.partnerIco ? ` company: { identificationNumber: "${escGql(params.partnerIco)}" }` : ""} }` : "",
          params.costCenterCode ? `costCenter: { code: "${escGql(params.costCenterCode)}" }` : "",
          params.projectCode ? `project: { code: "${escGql(params.projectCode)}" }` : "",
          params.activityCode ? `activity: { code: "${escGql(params.activityCode)}" }` : "",
        ].filter(Boolean).join("\n      ");

        const gql = `mutation {
  createBankDocument(
    bankDocument: { ${fields} ${extras} }
    definitionXMLTransfer: { shortCut: "${escGql(params.definitionShortcut)}" }
  ) { guid isSuccess }
}`;

        const data = await m3.query<{ createBankDocument: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.createBankDocument;
        return textResult(`Bank document ${result.isSuccess ? "created" : "queued"}.\nGUID: \`${result.guid}\``);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_create_cash_desk_document",
    "Create a cash desk (register) document. Supports controlling variables. Async import queue.",
    {
      dateOfIssue: z.string().regex(DATE_RE, DATE_MSG).describe("Date (DD.MM.YYYY)"),
      documentNumber: z.string().optional(),
      totalAmount: z.number().describe("Total amount with VAT"),
      costCenterCode: z.string().optional().describe("Cost center code"),
      projectCode: z.string().optional().describe("Project code"),
      activityCode: z.string().optional().describe("Activity code"),
      text: z.string().optional().describe("Description/note"),
      definitionShortcut: z.string().default("_PPD").describe("XML transfer definition shortcut"),
    },
    async (params) => {
      try {
        const fields = [
          `dateOfIssue: "${escGql(params.dateOfIssue)}"`,
          params.documentNumber ? `documentNumber: "${escGql(params.documentNumber)}"` : "",
          `totalPriceHcWithVat: ${params.totalAmount}`,
          params.text ? `text: "${escGql(params.text)}"` : "",
        ].filter(Boolean).join(", ");

        const extras = [
          params.costCenterCode ? `costCenter: { code: "${escGql(params.costCenterCode)}" }` : "",
          params.projectCode ? `project: { code: "${escGql(params.projectCode)}" }` : "",
          params.activityCode ? `activity: { code: "${escGql(params.activityCode)}" }` : "",
        ].filter(Boolean).join("\n      ");

        const gql = `mutation {
  createCashDeskDocument(
    cashDeskDocument: { ${fields} ${extras} }
    definitionXMLTransfer: { shortCut: "${escGql(params.definitionShortcut)}" }
  ) { guid isSuccess }
}`;

        const data = await m3.query<{ createCashDeskDocument: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.createCashDeskDocument;
        return textResult(`Cash desk document ${result.isSuccess ? "created" : "queued"}.\nGUID: \`${result.guid}\``);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_bank_accounts",
    "List bank accounts and cash desks configured in Money S3 (read-only)",
    {},
    async () => {
      try {
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
          lines.push(`- **${a.name ?? "—"}**: ${a.accountNumber ?? ""}/${a.bankCode ?? ""} (IBAN: ${a.iban ?? "—"}, SWIFT: ${a.swift ?? "—"}, ${cur?.code ?? "CZK"})`);
        }
        lines.push("", "## Cash Desks");
        for (const c of ba?.cashDesks?.items ?? []) {
          const cur = c.currency as Record<string, unknown> | undefined;
          lines.push(`- **${c.name ?? "—"}** (${cur?.code ?? "CZK"})`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
}
