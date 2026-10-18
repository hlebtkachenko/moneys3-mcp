import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { CREATE, READ, definitionParam, listTool, runMutation, str, updateTool } from "./helpers.js";

// [read tool, description, root query, title, tool suffix, mutation suffix, argument, default definition]
const VARIABLES: Array<[string, string, string, string, string, string, string, string]> = [
  ["m3_cost_centers", "cost centers (střediska)", "centres", "Cost Centers", "cost_center", "Centre", "centre", "_STR"],
  ["m3_projects", "projects (zakázky)", "jobOrders", "Projects", "project", "JobOrder", "jobOrder", "_ZAK"],
  ["m3_activities", "activities (činnosti)", "operations", "Activities", "activity", "Operation", "operation", "_CIN"],
];

export function registerControllingTools(server: McpServer, m3: MoneyS3Client) {
  for (const [readTool, what, root, title, suffix, mutation, arg, def] of VARIABLES) {
    const single = title.replace(/s$/, "").replace(/ie$/, "y");
    server.tool(
      readTool,
      `Query ${what}, a controlling variable. Read-only.`,
      {
        take: z.number().int().min(1).max(200).default(50),
        skip: z.number().int().min(0).default(0),
      },
      READ,
      async (args) =>
        listTool(m3, root, "id shortCut name", title, args, (c) => `- **${str(c.shortCut)}** ${str(c.name)} (id: ${str(c.id, "?")})`, "\n"),
    );

    server.tool(
      `m3_create_${suffix}`,
      `Create one of the ${what}. Written to the Money S3 import queue; check the result with m3_import_status.`,
      {
        code: z.string().min(1).describe("Shortcut code"),
        name: z.string().min(1).describe("Name"),
        definitionShortcut: definitionParam(def),
      },
      CREATE,
      async ({ code, name, definitionShortcut }) =>
        runMutation(m3, {
          mutation: `create${mutation}`,
          arg,
          label: `${single} "${code}"`,
          verifyWith: readTool,
          definitionShortcut,
          input: { shortCut: code, name },
        }),
    );

    updateTool(server, m3, {
      name: `m3_update_${suffix}`,
      what: `one of the ${what}`,
      match: { code: z.string().min(1).describe("Shortcut code of the record to update (key)") },
      fields: { name: z.string().min(1).describe("Name"), note: z.string().describe("Note") },
      definition: def,
      // Code lists exist once per accounting year: one or more matches.
      lookup: { root, where: (p) => ({ shortCut: { eq: p.code as string } }), unique: false },
      mutation: `update${mutation}`,
      arg,
      verifyWith: readTool,
      label: (p) => `Update ${single.toLowerCase()} "${p.code}"`,
      input: (p) => ({ shortCut: p.code as string, name: p.name as string | undefined, note: p.note as string | undefined }),
    });
  }
}
