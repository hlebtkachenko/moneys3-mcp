import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { escGql, textResult, errorResult } from "./helpers.js";

export function registerAccountingMutationTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_create_account",
    "Create a new account in the chart of accounts. Async import queue.",
    {
      account: z.string().min(1).describe("Account number (e.g. '211', '321')"),
      name: z.string().optional().describe("Account name"),
      type: z.string().optional().describe("Account type (enum AccountChartType)"),
      subtype1: z.string().optional().describe("Account subtype 1 (enum AccountChartAccountType)"),
      subtype2: z.string().optional().describe("Account subtype 2 (enum AccountChartAccountSubtype)"),
      note: z.string().optional().describe("Note"),
      year: z.number().int().optional().describe("Accounting year"),
      definitionShortcut: z.string().default("_UC").describe("XML transfer shortcut"),
    },
    async ({ account, name, type, subtype1, subtype2, note, year, definitionShortcut }) => {
      try {
        const fields = [
          `account: "${escGql(account)}"`,
          name ? `name: "${escGql(name)}"` : "",
          type ? `type: ${type}` : "",
          subtype1 ? `subtype1: ${subtype1}` : "",
          subtype2 ? `subtype2: ${subtype2}` : "",
          note ? `note: "${escGql(note)}"` : "",
          year != null ? `year: ${year}` : "",
        ].filter(Boolean).join(", ");

        const gql = `mutation {
  createAccountChart(
    accountChart: { ${fields} }
    definitionXMLTransfer: { shortCut: "${escGql(definitionShortcut)}" }
  ) { guid isSuccess }
}`;
        const data = await m3.query<{ createAccountChart: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.createAccountChart;
        return textResult(`Account "${account}" ${result.isSuccess ? "created" : "queued"}.\nGUID: \`${result.guid}\``);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_create_predefined_entry",
    "Create a predefined accounting entry (predkontace). Async import queue.",
    {
      shortCut: z.string().min(1).describe("Predefined entry shortcut code"),
      type: z.string().optional().describe("Entry type (enum AccountAssignmentAccType)"),
      description: z.string().optional().describe("Description"),
      accountDebits: z.string().optional().describe("Debit account number"),
      accountCredits: z.string().optional().describe("Credit account number"),
      vatClassification: z.string().optional().describe("VAT classification shortcut"),
      note: z.string().optional().describe("Note"),
      year: z.number().int().optional().describe("Accounting year"),
      definitionShortcut: z.string().default("_PK").describe("XML transfer shortcut"),
    },
    async ({ shortCut, type, description, accountDebits, accountCredits, vatClassification, note, year, definitionShortcut }) => {
      try {
        const fields = [
          `shortCut: "${escGql(shortCut)}"`,
          type ? `type: ${type}` : "",
          description ? `description: "${escGql(description)}"` : "",
          accountDebits ? `accountDebits: { account: "${escGql(accountDebits)}" }` : "",
          accountCredits ? `accountCredits: { account: "${escGql(accountCredits)}" }` : "",
          vatClassification ? `vatClassification: { shortCut: "${escGql(vatClassification)}" }` : "",
          note ? `note: "${escGql(note)}"` : "",
          year != null ? `year: ${year}` : "",
        ].filter(Boolean).join(", ");

        const gql = `mutation {
  createAccountAssignmentAcc(
    accountAssignmentAcc: { ${fields} }
    definitionXMLTransfer: { shortCut: "${escGql(definitionShortcut)}" }
  ) { guid isSuccess }
}`;
        const data = await m3.query<{ createAccountAssignmentAcc: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.createAccountAssignmentAcc;
        return textResult(`Predefined entry "${shortCut}" ${result.isSuccess ? "created" : "queued"}.\nGUID: \`${result.guid}\``);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
}
