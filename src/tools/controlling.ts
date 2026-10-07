import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { CREATE, READ, definitionParam, listTool, runMutation, str } from "./helpers.js";

// [read tool, description, root query, title, create tool, create mutation, argument, default definition]
const VARIABLES: Array<[string, string, string, string, string, string, string, string]> = [
  ["m3_cost_centers", "cost centers (střediska)", "centres", "Cost Centers", "m3_create_cost_center", "createCentre", "centre", "_ST"],
  ["m3_projects", "projects (zakázky)", "jobOrders", "Projects", "m3_create_project", "createJobOrder", "jobOrder", "_ZK"],
  ["m3_activities", "activities (činnosti)", "operations", "Activities", "m3_create_activity", "createOperation", "operation", "_CN"],
];

export function registerControllingTools(server: McpServer, m3: MoneyS3Client) {
  for (const [readTool, what, root, title, createTool, mutation, arg, def] of VARIABLES) {
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
      createTool,
      `Create one of the ${what}. Written to the Money S3 import queue; check the result with m3_import_status.`,
      {
        code: z.string().min(1).describe("Shortcut code"),
        name: z.string().min(1).describe("Name"),
        definitionShortcut: definitionParam(def),
      },
      CREATE,
      async ({ code, name, definitionShortcut }) =>
        runMutation(m3, {
          mutation,
          arg,
          label: `${title.replace(/s$/, "").replace(/ie$/, "y")} "${code}"`,
          verifyWith: readTool,
          definitionShortcut,
          input: { shortCut: code, name },
        }),
    );
  }
}
