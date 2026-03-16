import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { escGql, textResult, errorResult } from "./helpers.js";

export function registerWageTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_create_wage",
    "Create a wage record (mzdovy doklad) for payroll processing. Async import queue.",
    {
      employeeId: z.string().min(1).describe("Employee personal number"),
      year: z.number().int().describe("Payroll year"),
      month: z.number().int().min(1).max(12).describe("Payroll month"),
      grossWage: z.number().optional().describe("Gross wage amount"),
      hoursWorked: z.number().optional().describe("Hours worked"),
      costCenterCode: z.string().optional().describe("Cost center code"),
      projectCode: z.string().optional().describe("Project code (zakázka)"),
      definitionShortcut: z.string().default("_MZ").describe("XML transfer shortcut"),
    },
    async ({ employeeId, year, month, grossWage, hoursWorked, costCenterCode, projectCode, definitionShortcut }) => {
      try {
        const fields = [
          `employee: { personalNumber: "${escGql(employeeId)}" }`,
          `year: ${year}`,
          `month: ${month}`,
          grossWage != null ? `grossWage: ${grossWage}` : "",
          hoursWorked != null ? `hoursWorked: ${hoursWorked}` : "",
          costCenterCode ? `centre: { shortCut: "${escGql(costCenterCode)}" }` : "",
          projectCode ? `jobOrder: { shortCut: "${escGql(projectCode)}" }` : "",
        ].filter(Boolean).join(", ");

        const gql = `mutation {
  createWage(
    wage: { ${fields} }
    definitionXMLTransfer: { shortCut: "${escGql(definitionShortcut)}" }
  ) { guid isSuccess }
}`;
        const data = await m3.query<{ createWage: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.createWage;
        return textResult(`Wage for employee "${employeeId}" (${month}/${year}) ${result.isSuccess ? "created" : "queued"}.\nGUID: \`${result.guid}\``);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
}
