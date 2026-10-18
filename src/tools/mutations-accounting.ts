import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { CREATE, definitionParam, gqlEnum, runMutation, updateTool } from "./helpers.js";

const enumOf = (v: string | undefined) => (v ? gqlEnum(v) : undefined);

// Enum values from docs/schema.graphql.
const accountFields = {
  name: z.string().describe("Account name"),
  type: z.enum(["BALANCE_SHEET", "PROFIT_LOSS", "FINAL", "OFF_BALANCE_SHEET"]).describe("Account type (AccountChartType)"),
  subtype1: z.enum(["UNDEFINED", "ACTIVE", "PASSIVE", "EXPENSE", "REVENUE"]).describe("Account subtype 1 (AccountChartAccountType)"),
  subtype2: z
    .enum(["TRACK_BALANCE", "NOT_TRACK_BALANCE", "AFFECTS_TAX", "NOT_AFFECTS_TAX", "ACCOUNT_DEBITS", "ACCOUNT_CREDITS"])
    .describe("Account subtype 2 (AccountChartAccountSubtype)"),
  note: z.string().describe("Note"),
};

const entryFields = {
  type: z
    .enum([
      "UNDEFINED", "INVOICES_ISSUED", "INVOICES_RECEIVED", "CASH_VOUCHER_RECEIVED", "CASH_VOUCHER_ISSUED",
      "BANK_STATEMENT_RECEIVED", "BANK_STATEMENT_ISSUED", "LIABILITY", "RECEIVABLE", "INTERNAL_DOCUMENT",
    ])
    .describe("Document type the entry is for (AccountAssignmentAccType)"),
  description: z.string().describe("Description"),
  accountDebits: z.string().describe("Debit account number"),
  accountCredits: z.string().describe("Credit account number"),
  vatClassification: z.string().describe("VAT classification shortcut"),
  note: z.string().describe("Note"),
};

type Account = { account: string; name?: string; type?: string; subtype1?: string; subtype2?: string; note?: string; year?: number };
type Entry = {
  shortCut: string;
  type?: string;
  description?: string;
  accountDebits?: string;
  accountCredits?: string;
  vatClassification?: string;
  note?: string;
  year?: number;
};

const accountInput = (p: Account) => ({
  account: p.account,
  name: p.name,
  type: enumOf(p.type),
  subtype1: enumOf(p.subtype1),
  subtype2: enumOf(p.subtype2),
  note: p.note,
  year: p.year,
});

const entryInput = (p: Entry) => ({
  shortCut: p.shortCut,
  type: enumOf(p.type),
  description: p.description,
  accountDebits: p.accountDebits ? { account: p.accountDebits } : undefined,
  accountCredits: p.accountCredits ? { account: p.accountCredits } : undefined,
  vatClassification: p.vatClassification ? { shortCut: p.vatClassification } : undefined,
  note: p.note,
  year: p.year,
});

const year = z.number().int().optional().describe("Accounting year");

export function registerAccountingMutationTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_create_account",
    "Create an account in the chart of accounts. Written to the Money S3 import queue; check the result with m3_import_status.",
    {
      account: z.string().min(1).describe("Account number (e.g. '211', '321')"),
      ...z.object(accountFields).partial().shape,
      year,
      definitionShortcut: definitionParam("_UC"),
    },
    CREATE,
    async (p) =>
      runMutation(m3, {
        mutation: "createAccountChart",
        arg: "accountChart",
        label: `Account "${p.account}"`,
        verifyWith: "m3_chart_of_accounts",
        definitionShortcut: p.definitionShortcut,
        input: accountInput(p),
      }),
  );

  // UpdateAccountChart has no year: the account is matched in the agenda's current year.
  updateTool(server, m3, {
    name: "m3_update_account",
    what: "an account in the chart of accounts",
    key: { account: z.string().min(1).describe("Account number to update (key)") },
    fields: accountFields,
    definition: "_UC",
    mutation: "updateAccountChart",
    arg: "accountChart",
    verifyWith: "m3_chart_of_accounts",
    label: (p) => `Update account "${p.account}"`,
    input: (p) => accountInput(p as Account),
  });

  server.tool(
    "m3_create_predefined_entry",
    "Create a predefined accounting entry (předkontace). Written to the Money S3 import queue; check the result with m3_import_status.",
    {
      shortCut: z.string().min(1).describe("Predefined entry shortcut code"),
      ...z.object(entryFields).partial().shape,
      year,
      definitionShortcut: definitionParam("_PK"),
    },
    CREATE,
    async (p) =>
      runMutation(m3, {
        mutation: "createAccountAssignmentAcc",
        arg: "accountAssignmentAcc",
        label: `Predefined entry "${p.shortCut}"`,
        verifyWith: "m3_predefined_entries",
        definitionShortcut: p.definitionShortcut,
        input: entryInput(p),
      }),
  );

  updateTool(server, m3, {
    name: "m3_update_predefined_entry",
    what: "a predefined accounting entry (předkontace)",
    key: { shortCut: z.string().min(1).describe("Shortcut of the entry to update (key)") },
    fields: entryFields,
    definition: "_PK",
    mutation: "updateAccountAssignmentAcc",
    arg: "accountAssignmentAcc",
    verifyWith: "m3_predefined_entries",
    label: (p) => `Update predefined entry "${p.shortCut}"`,
    input: (p) => entryInput(p as Entry),
  });
}
