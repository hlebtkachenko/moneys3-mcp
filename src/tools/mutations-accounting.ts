import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { CREATE, definitionParam, enumParam, gqlEnum, runMutation } from "./helpers.js";

const enumOf = (v: string | undefined) => (v ? gqlEnum(v) : undefined);

export function registerAccountingMutationTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_create_account",
    "Create an account in the chart of accounts. Written to the Money S3 import queue; check the result with m3_import_status.",
    {
      account: z.string().min(1).describe("Account number (e.g. '211', '321')"),
      name: z.string().optional().describe("Account name"),
      type: enumParam().optional().describe("Account type (enum AccountChartType)"),
      subtype1: enumParam().optional().describe("Account subtype 1 (enum AccountChartAccountType)"),
      subtype2: enumParam().optional().describe("Account subtype 2 (enum AccountChartAccountSubtype)"),
      note: z.string().optional().describe("Note"),
      year: z.number().int().optional().describe("Accounting year"),
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
        input: {
          account: p.account,
          name: p.name,
          type: enumOf(p.type),
          subtype1: enumOf(p.subtype1),
          subtype2: enumOf(p.subtype2),
          note: p.note,
          year: p.year,
        },
      }),
  );

  server.tool(
    "m3_create_predefined_entry",
    "Create a predefined accounting entry (předkontace). Written to the Money S3 import queue; check the result with m3_import_status.",
    {
      shortCut: z.string().min(1).describe("Predefined entry shortcut code"),
      type: enumParam().optional().describe("Entry type (enum AccountAssignmentAccType)"),
      description: z.string().optional().describe("Description"),
      accountDebits: z.string().optional().describe("Debit account number"),
      accountCredits: z.string().optional().describe("Credit account number"),
      vatClassification: z.string().optional().describe("VAT classification shortcut"),
      note: z.string().optional().describe("Note"),
      year: z.number().int().optional().describe("Accounting year"),
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
        input: {
          shortCut: p.shortCut,
          type: enumOf(p.type),
          description: p.description,
          accountDebits: p.accountDebits ? { account: p.accountDebits } : undefined,
          accountCredits: p.accountCredits ? { account: p.accountCredits } : undefined,
          vatClassification: p.vatClassification ? { shortCut: p.vatClassification } : undefined,
          note: p.note,
          year: p.year,
        },
      }),
  );
}
