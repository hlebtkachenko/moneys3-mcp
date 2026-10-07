import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import {
  CREATE,
  READ,
  controllingInput,
  controllingParams,
  controllingText,
  dateParam,
  definitionParam,
  errorResult,
  isoDate,
  listParams,
  listTool,
  partnerInput,
  partnerSchema,
  runMutation,
  str,
  textResult,
  vatText,
} from "./helpers.js";

// Fields shared by IBankStatement and ICashVoucher (docs/schema-summary.json).
// partnerAddress { address } was fixed against a live server in 6dca522.
const PAYMENT_FIELDS = `
  id year isDeleted documentNumber isExpense dateOfIssue dateOfPayment dateOfAccountingEvent
  totalWithVatHc totalWithVat currency { code }
  vatRateSummaryHc { vatRate totalWithoutVat totalVat }
  partnerAddress {
    address { name street municipality postalCode country }
    identificationNumber vatIdentificationNumber
  }
  variableSymbol pairingSymbol
  centre { shortCut name } jobOrder { shortCut name } operation { shortCut name }
  accountAssignment { accountAssignmentAcc { shortCut description } }
  description note
`;

const BANK_FIELDS = `${PAYMENT_FIELDS}
  bankStatementNumber constantSymbol specificSymbol
  bankAccount { shortCut description }
`;

// ICashVoucher has no bank statement number, constant/specific symbol or bankAccount; it has cashBox.
const CASH_FIELDS = `${PAYMENT_FIELDS}
  cashBox { shortCut description }
`;

function formatPaymentDoc(d: Record<string, unknown>): string {
  const partner = d.partnerAddress as Record<string, unknown> | undefined;
  const addr = partner?.address as Record<string, unknown> | undefined;
  const cur = d.currency as Record<string, unknown> | undefined;
  const aa = (d.accountAssignment as Record<string, unknown> | undefined)?.accountAssignmentAcc as Record<string, unknown> | undefined;
  const box = (d.bankAccount ?? d.cashBox) as Record<string, unknown> | undefined;

  const lines = [
    `## ${str(d.documentNumber)} [${d.isExpense ? "Expense" : "Receipt"}] (${str(d.dateOfPayment ?? d.dateOfIssue)}; id ${str(d.id)}, year ${str(d.year)})`,
    `- Partner: ${str(addr?.name)} (ICO: ${str(partner?.identificationNumber)})`,
    `- VS: ${str(d.variableSymbol)}${"constantSymbol" in d ? ` | KS: ${str(d.constantSymbol)} | SS: ${str(d.specificSymbol)}` : ""}`,
    `- Total: ${str(d.totalWithVatHc, "?")} ${str(cur?.code, "CZK")}`,
    `- ${d.bankAccount ? "Bank account" : "Cash box"}: ${str(box?.shortCut)} (${str(box?.description)})`,
  ];
  if (d.bankStatementNumber) lines.push(`- Statement no.: ${d.bankStatementNumber}`);
  for (const line of [vatText(d), controllingText(d)]) if (line) lines.push(line);
  if (aa?.shortCut) lines.push(`- Predkontace: ${aa.shortCut} (${str(aa.description, "")})`);
  if (d.description) lines.push(`- Description: ${d.description}`);
  if (d.note) lines.push(`- Note: ${d.note}`);
  return lines.join("\n");
}

const paymentParams = {
  dateOfIssue: dateParam("Issue date"),
  dateOfAccountingEvent: dateParam("Accounting event date").optional(),
  dateOfPayment: dateParam("Payment date").optional(),
  documentNumber: z.string().optional(),
  isExpense: z.boolean().optional().describe("True for expense (výdej), false for receipt (příjem)"),
  variableSymbol: z.string().optional(),
  partner: partnerSchema.optional(),
  ...controllingParams,
  description: z.string().optional().describe("Description"),
};

type PaymentParams = {
  dateOfIssue: string;
  dateOfAccountingEvent?: string;
  dateOfPayment?: string;
  documentNumber?: string;
  isExpense?: boolean;
  variableSymbol?: string;
  partner?: z.infer<typeof partnerSchema>;
  costCenterCode?: string;
  projectCode?: string;
  activityCode?: string;
  description?: string;
};

function paymentInput(p: PaymentParams) {
  return {
    dateOfIssue: isoDate(p.dateOfIssue),
    dateOfAccountingEvent: isoDate(p.dateOfAccountingEvent),
    dateOfPayment: isoDate(p.dateOfPayment),
    documentNumber: p.documentNumber,
    isExpense: p.isExpense,
    variableSymbol: p.variableSymbol,
    description: p.description,
    partnerAddress: partnerInput(p.partner),
    ...controllingInput(p),
  };
}

export function registerBankingTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_bank_documents",
    "Query bank documents (bankovní doklady) with VAT summary, statement number and controlling variables. Read-only.",
    listParams(),
    READ,
    async (args) => listTool(m3, "bankStatements", BANK_FIELDS, "Bank Documents", args, formatPaymentDoc),
  );

  server.tool(
    "m3_cash_desk_documents",
    "Query cash desk documents (pokladní doklady) with VAT summary, cash box and controlling variables. Read-only.",
    listParams(),
    READ,
    async (args) => listTool(m3, "cashVouchers", CASH_FIELDS, "Cash Desk Documents", args, formatPaymentDoc),
  );

  server.tool(
    "m3_create_bank_document",
    "Create a bank document. Written to the Money S3 import queue; check the result with m3_import_status.",
    {
      ...paymentParams,
      constantSymbol: z.string().optional(),
      specificSymbol: z.string().optional(),
      bankStatementNumber: z.number().int().positive().optional(),
      bankAccountCode: z.string().optional().describe("Bank account shortcut (see m3_bank_accounts)"),
      definitionShortcut: definitionParam("_BD"),
    },
    CREATE,
    async (p) =>
      runMutation(m3, {
        mutation: "createBankStatement",
        arg: "bankStatement",
        label: "Bank document",
        verifyWith: "m3_bank_documents",
        definitionShortcut: p.definitionShortcut,
        input: {
          ...paymentInput(p),
          constantSymbol: p.constantSymbol,
          specificSymbol: p.specificSymbol,
          bankStatementNumber: p.bankStatementNumber,
          bankAccount: p.bankAccountCode ? { shortCut: p.bankAccountCode } : undefined,
        },
      }),
  );

  server.tool(
    "m3_create_cash_desk_document",
    "Create a cash desk document. Written to the Money S3 import queue; check the result with m3_import_status.",
    {
      ...paymentParams,
      cashBoxCode: z.string().optional().describe("Cash box shortcut (see m3_bank_accounts)"),
      // Default from the official cash voucher example (mutation_priklady.pdf).
      definitionShortcut: definitionParam("_PD"),
    },
    CREATE,
    async (p) =>
      runMutation(m3, {
        mutation: "createCashVoucher",
        arg: "cashVoucher",
        label: "Cash desk document",
        verifyWith: "m3_cash_desk_documents",
        definitionShortcut: p.definitionShortcut,
        input: { ...paymentInput(p), cashBox: p.cashBoxCode ? { shortCut: p.cashBoxCode } : undefined },
      }),
  );

  server.tool(
    "m3_bank_accounts",
    "List bank accounts and cash boxes configured in Money S3. Read-only.",
    {},
    READ,
    async () => {
      try {
        const gql = `{ bankAccountCashBoxes(take: 100) { items { shortCut description type accountNumber bankName iban currency { code } } totalCount } }`;
        const data = await m3.query<{ bankAccountCashBoxes: { items: Record<string, unknown>[] } }>(gql);
        const items = data.bankAccountCashBoxes?.items ?? [];
        const lines = ["# Bank Accounts & Cash Boxes", ""];
        if (!items.length) lines.push("None found.");
        for (const a of items) {
          const cur = a.currency as Record<string, unknown> | undefined;
          lines.push(
            `- **${str(a.description)}** [${str(a.shortCut)}] type: ${str(a.type, "?")} acct: ${str(a.accountNumber)} IBAN: ${str(a.iban)} bank: ${str(a.bankName)} (${str(cur?.code, "CZK")})`,
          );
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
}
