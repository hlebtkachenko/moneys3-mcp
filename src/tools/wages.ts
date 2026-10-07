import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { CREATE, definitionParam, runMutation } from "./helpers.js";

export function registerWageTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_create_wage",
    "Create a monthly wage (mzda) for an employee with worked time per employment relationship. Written to the Money S3 import queue; check the result with m3_import_status.",
    {
      personalNumber: z.string().min(1).describe("Employee personal number (osobní číslo)"),
      year: z.number().int().min(2000).max(2100).describe("Payroll year"),
      month: z.number().int().min(1).max(12).describe("Payroll month"),
      employmentRelationships: z
        .array(
          z.object({
            id: z.number().int().positive().describe("Employment relationship ID"),
            workedDays: z.number().min(0).optional(),
            workedHours: z.number().min(0).optional(),
            workingDays: z.number().min(0).optional(),
            workingHours: z.number().min(0).optional(),
          }),
        )
        .min(1)
        .describe("Every employment relationship of the employee must be listed"),
      // Default from the official wage example (mutation_priklady.pdf).
      definitionShortcut: definitionParam("_MZDY"),
    },
    CREATE,
    // Shape from the createWage example in mutation_priklady.pdf. Absences are not exposed.
    async ({ personalNumber, year, month, employmentRelationships, definitionShortcut }) =>
      runMutation(m3, {
        mutation: "createWage",
        arg: "wage",
        label: `Wage for employee "${personalNumber}" (${month}/${year})`,
        verifyWith: "m3_employees",
        definitionShortcut,
        input: { employee: { personalNumber }, month, year, employmentRelationships },
      }),
  );
}
