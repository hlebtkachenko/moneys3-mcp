import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { escGql, DATE_RE, DATE_MSG, buildArgs, textResult, errorResult } from "./helpers.js";

const DOC_FIELDS = `
  items {
    id documentNumber dateOfIssue
    totalWithVatHc amountToPayHc remainingAmountToPayHc
    isBilled dateOfPayment
    currency { code }
    vatRateSummaryHc { vatRate totalWithoutVat totalVat }
    partnerAddress {
      businessAddress { name street municipality postalCode country }
      identificationNumber vatIdentificationNumber
    }
    variableSymbol constantSymbol { code } specificSymbol
    centre { shortCut name }
    jobOrder { shortCut name }
    operation { shortCut name }
    accountAssignment { accountAssignmentAcc { shortCut } }
    description
    items { description amount unitPriceHc vatRate }
  }
  totalCount
`;

function formatBankDoc(d: Record<string, unknown>): string {
  const partner = d.partnerAddress as Record<string, unknown> | undefined;
  const biz = partner?.businessAddress as Record<string, unknown> | undefined;
  const cur = d.currency as Record<string, unknown> | undefined;
  const vatSummary = d.vatRateSummaryHc as Array<Record<string, unknown>> | undefined;
  const cc = d.centre as Record<string, unknown> | undefined;
  const proj = d.jobOrder as Record<string, unknown> | undefined;
  const act = d.operation as Record<string, unknown> | undefined;
  const aa = d.accountAssignment as Record<string, unknown> | undefined;
  const aaAcc = aa?.accountAssignmentAcc as Record<string, unknown> | undefined;
  const ks = d.constantSymbol as Record<string, unknown> | undefined;
  const items = d.items as Array<Record<string, unknown>> | undefined;

  const lines = [
    `## ${d.documentNumber ?? "—"} (${d.dateOfIssue ?? "—"})`,
    `- Partner: ${biz?.name ?? "—"} (ICO: ${partner?.identificationNumber ?? "—"})`,
    `- Address: ${[biz?.street, biz?.municipality, biz?.postalCode, biz?.country].filter(Boolean).join(", ") || "—"}`,
    `- VS: ${d.variableSymbol ?? "—"} | KS: ${ks?.code ?? "—"} | SS: ${d.specificSymbol ?? "—"}`,
    `- Total: ${d.totalWithVatHc ?? "?"} ${cur?.code ?? "CZK"}`,
    `- Paid: ${d.isBilled ? `Yes (${d.dateOfPayment ?? "—"})` : `No — remaining: ${d.remainingAmountToPayHc ?? "?"}`}`,
  ];

  if (vatSummary && vatSummary.length > 0) {
    const vatParts = vatSummary.map((v) => `${v.vatRate}%: base ${v.totalWithoutVat}, VAT ${v.totalVat}`);
    lines.push(`- VAT: ${vatParts.join(" | ")}`);
  }

  const ctrl = [cc?.shortCut && `CC:${cc.shortCut}`, proj?.shortCut && `Proj:${proj.shortCut}`, act?.shortCut && `Act:${act.shortCut}`].filter(Boolean);
  if (ctrl.length > 0) lines.push(`- Controlling: ${ctrl.join(" ")}`);
  if (aaAcc?.shortCut) lines.push(`- Account assignment: ${aaAcc.shortCut}`);

  if (items && items.length > 0) {
    lines.push("- Items:");
    for (const it of items) {
      lines.push(`  - ${it.description ?? "—"}: ${it.amount ?? 0} × ${it.unitPriceHc ?? 0} (VAT ${it.vatRate ?? "—"}%)`);
    }
  }

  if (d.description) lines.push(`- Description: ${d.description}`);
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
        const gql = `{ bankStatements(${buildArgs(take, skip, where, order)}) { ${DOC_FIELDS} } }`;
        const data = await m3.query<{ bankStatements: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const bd = data.bankStatements;
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
        const gql = `{ cashVouchers(${buildArgs(take, skip, where, order)}) { ${DOC_FIELDS} } }`;
        const data = await m3.query<{ cashVouchers: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const cd = data.cashVouchers;
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
          params.variableSymbol ? `variableSymbol: "${escGql(params.variableSymbol)}"` : "",
          params.specificSymbol ? `specificSymbol: "${escGql(params.specificSymbol)}"` : "",
          params.text ? `description: "${escGql(params.text)}"` : "",
        ].filter(Boolean).join(", ");

        const extras = [
          params.partnerName ? `partnerAddress: { businessAddress: { name: "${escGql(params.partnerName)}" }${params.partnerIco ? ` identificationNumber: "${escGql(params.partnerIco)}"` : ""} }` : "",
          params.costCenterCode ? `centre: { shortCut: "${escGql(params.costCenterCode)}" }` : "",
          params.projectCode ? `jobOrder: { shortCut: "${escGql(params.projectCode)}" }` : "",
          params.activityCode ? `operation: { shortCut: "${escGql(params.activityCode)}" }` : "",
        ].filter(Boolean).join("\n      ");

        const gql = `mutation {
  createBankStatement(
    bankStatement: { ${fields} ${extras} }
    definitionXMLTransfer: { shortCut: "${escGql(params.definitionShortcut)}" }
  ) { guid isSuccess }
}`;

        const data = await m3.query<{ createBankStatement: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.createBankStatement;
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
          params.text ? `description: "${escGql(params.text)}"` : "",
        ].filter(Boolean).join(", ");

        const extras = [
          params.costCenterCode ? `centre: { shortCut: "${escGql(params.costCenterCode)}" }` : "",
          params.projectCode ? `jobOrder: { shortCut: "${escGql(params.projectCode)}" }` : "",
          params.activityCode ? `operation: { shortCut: "${escGql(params.activityCode)}" }` : "",
        ].filter(Boolean).join("\n      ");

        const gql = `mutation {
  createCashVoucher(
    cashVoucher: { ${fields} ${extras} }
    definitionXMLTransfer: { shortCut: "${escGql(params.definitionShortcut)}" }
  ) { guid isSuccess }
}`;

        const data = await m3.query<{ createCashVoucher: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.createCashVoucher;
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
        const gql = `{ bankAccountCashBoxes(take: 100) {
        items { id shortCut name currency { code } }
        totalCount
      } }`;

        const data = await m3.query<{ bankAccountCashBoxes: { items: Record<string, unknown>[]; totalCount: number } }>(gql);

        const ba = data.bankAccountCashBoxes;
        const lines = ["# Bank Accounts & Cash Desks"];
        if (!ba?.items?.length) {
          lines.push("", "No bank accounts or cash desks found.");
        } else {
          lines.push("");
          for (const a of ba.items) {
            const cur = a.currency as Record<string, unknown> | undefined;
            lines.push(`- **${a.name ?? "—"}** [${a.shortCut ?? "—"}] (${cur?.code ?? "CZK"}) id: ${a.id ?? "?"}`);
          }
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
}
