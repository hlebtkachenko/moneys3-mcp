import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { escGql, textResult, errorResult } from "./helpers.js";

export function registerControllingTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_cost_centers",
    "Query cost centers (střediska) — controlling variable. Read/write.",
    {
      take: z.number().min(1).max(200).default(50),
      skip: z.number().min(0).default(0),
    },
    async ({ take, skip }) => {
      try {
        const gql = `{ centres(take: ${take}, skip: ${skip}) {
        items { id shortCut name }
        totalCount
      } }`;

        const data = await m3.query<{ centres: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const cc = data.centres;

        if (!cc?.items?.length) return textResult("No cost centers found.");

        const lines = [`# Cost Centers (${cc.items.length} of ${cc.totalCount})`, ""];
        for (const c of cc.items) {
          lines.push(`- **${c.shortCut ?? "—"}** ${c.name ?? "—"} (id: ${c.id ?? "?"})`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_projects",
    "Query projects (zakázky) — controlling variable. Read/write.",
    {
      take: z.number().min(1).max(200).default(50),
      skip: z.number().min(0).default(0),
    },
    async ({ take, skip }) => {
      try {
        const gql = `{ jobOrders(take: ${take}, skip: ${skip}) {
        items { id shortCut name }
        totalCount
      } }`;

        const data = await m3.query<{ jobOrders: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const p = data.jobOrders;

        if (!p?.items?.length) return textResult("No projects found.");

        const lines = [`# Projects (${p.items.length} of ${p.totalCount})`, ""];
        for (const proj of p.items) {
          lines.push(`- **${proj.shortCut ?? "—"}** ${proj.name ?? "—"} (id: ${proj.id ?? "?"})`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_activities",
    "Query activities (činnosti) — controlling variable. Read/write.",
    {
      take: z.number().min(1).max(200).default(50),
      skip: z.number().min(0).default(0),
    },
    async ({ take, skip }) => {
      try {
        const gql = `{ operations(take: ${take}, skip: ${skip}) {
        items { id shortCut name }
        totalCount
      } }`;

        const data = await m3.query<{ operations: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const a = data.operations;

        if (!a?.items?.length) return textResult("No activities found.");

        const lines = [`# Activities (${a.items.length} of ${a.totalCount})`, ""];
        for (const act of a.items) {
          lines.push(`- **${act.shortCut ?? "—"}** ${act.name ?? "—"} (id: ${act.id ?? "?"})`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_create_cost_center",
    "Create a cost center (středisko). Async import queue.",
    {
      code: z.string().min(1).describe("Cost center code"),
      name: z.string().min(1).describe("Cost center name"),
      definitionShortcut: z.string().default("_ST").describe("XML transfer shortcut"),
    },
    async ({ code, name, definitionShortcut }) => {
      try {
        const gql = `mutation {
  createCentre(
    centre: { shortCut: "${escGql(code)}", name: "${escGql(name)}" }
    definitionXMLTransfer: { shortCut: "${escGql(definitionShortcut)}" }
  ) { guid isSuccess }
}`;
        const data = await m3.query<{ createCentre: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.createCentre;
        return textResult(`Cost center "${code}" ${result.isSuccess ? "created" : "queued"}.\nGUID: \`${result.guid}\``);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_create_project",
    "Create a project (zakázka). Async import queue.",
    {
      code: z.string().min(1).describe("Project code"),
      name: z.string().min(1).describe("Project name"),
      definitionShortcut: z.string().default("_ZK").describe("XML transfer shortcut"),
    },
    async ({ code, name, definitionShortcut }) => {
      try {
        const gql = `mutation {
  createJobOrder(
    jobOrder: { shortCut: "${escGql(code)}", name: "${escGql(name)}" }
    definitionXMLTransfer: { shortCut: "${escGql(definitionShortcut)}" }
  ) { guid isSuccess }
}`;
        const data = await m3.query<{ createJobOrder: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.createJobOrder;
        return textResult(`Project "${code}" ${result.isSuccess ? "created" : "queued"}.\nGUID: \`${result.guid}\``);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_create_activity",
    "Create an activity (činnost). Async import queue.",
    {
      code: z.string().min(1).describe("Activity code"),
      name: z.string().min(1).describe("Activity name"),
      definitionShortcut: z.string().default("_CN").describe("XML transfer shortcut"),
    },
    async ({ code, name, definitionShortcut }) => {
      try {
        const gql = `mutation {
  createOperation(
    operation: { shortCut: "${escGql(code)}", name: "${escGql(name)}" }
    definitionXMLTransfer: { shortCut: "${escGql(definitionShortcut)}" }
  ) { guid isSuccess }
}`;
        const data = await m3.query<{ createOperation: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.createOperation;
        return textResult(`Activity "${code}" ${result.isSuccess ? "created" : "queued"}.\nGUID: \`${result.guid}\``);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
}
