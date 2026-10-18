import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { CREATE, type GqlInput, definitionParam, runMutation, updateTool } from "./helpers.js";

const wageKey = {
  personalNumber: z.string().min(1).describe("Employee personal number (osobní číslo)"),
  year: z.number().int().min(2000).max(2100).describe("Payroll year"),
  month: z.number().int().min(1).max(12).describe("Payroll month"),
};

const employmentRelationships = z
  .array(
    z.object({
      id: z.number().int().positive().describe("Employment relationship ID (see m3_employees)"),
      workedDays: z.number().min(0).optional(),
      workedHours: z.number().min(0).optional(),
      workingDays: z.number().min(0).optional(),
      workingHours: z.number().min(0).optional(),
    }),
  )
  .min(1)
  .describe("Every employment relationship of the employee must be listed");

export function registerWageTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_create_wage",
    "Create a monthly wage (mzda) for an employee with worked time per employment relationship. Written to the Money S3 import queue; check the result with m3_import_status.",
    {
      ...wageKey,
      employmentRelationships,
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
        verifyWith: "the wage in Money S3 (the API has no wage query)",
        definitionShortcut,
        input: { employee: { personalNumber }, month, year, employmentRelationships },
      }),
  );

  // UpdateWage takes year and month as strings (docs/schema.graphql), WageInput as Int.
  updateTool(server, m3, {
    name: "m3_update_wage",
    what: "a monthly wage (mzda), found by employee, year and month",
    match: wageKey,
    fields: { employmentRelationships, note: z.string().describe("Note") },
    definition: "_MZDY",
    // The API has no wage query: only the employee is checked; the update definition keeps a miss from adding a wage.
    lookup: { root: "employees", where: (p) => ({ personalNumber: { eq: p.personalNumber as string } }), unique: true },
    mutation: "updateWage",
    arg: "wage",
    verifyWith: "the wage in Money S3 (the API has no wage query)",
    label: (p) => `Update wage for employee "${p.personalNumber}" (${p.month}/${p.year})`,
    input: (p) => ({
      employee: { personalNumber: p.personalNumber as string },
      year: String(p.year),
      month: String(p.month),
      note: p.note as string | undefined,
      employmentRelationships: p.employmentRelationships as GqlInput,
    }),
  });
}
