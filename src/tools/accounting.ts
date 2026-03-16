import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { buildArgs, textResult, errorResult } from "./helpers.js";

export function registerAccountingTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_accounting_journal",
    "Query the accounting journal with controlling variables (cost center, project, activity). Read-only.",
    {
      take: z.number().min(1).max(100).default(50),
      skip: z.number().min(0).default(0),
      where: z.string().optional().describe("GraphQL where filter"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      try {
        const gql = `{ journalAccs(${buildArgs(take, skip, where, order)}) {
        items {
          id date srcDocumentNumber description
          accountDebits { account name }
          accountCredits { account name }
          amount amountHc
          currency { code }
          centre { shortCut name }
          jobOrder { shortCut name }
          operation { shortCut name }
          note
        }
        totalCount
      } }`;

        const data = await m3.query<{ journalAccs: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const aj = data.journalAccs;
        if (!aj?.items?.length) return textResult("No journal entries found.");

        const lines = [`# Accounting Journal (${aj.items.length} of ${aj.totalCount})`, ""];
        for (const e of aj.items) {
          const cur = e.currency as Record<string, unknown> | undefined;
          const cc = e.centre as Record<string, unknown> | undefined;
          const proj = e.jobOrder as Record<string, unknown> | undefined;
          const act = e.operation as Record<string, unknown> | undefined;
          const ad = e.accountDebits as Record<string, unknown> | undefined;
          const ac = e.accountCredits as Record<string, unknown> | undefined;

          lines.push(
            `- **${e.srcDocumentNumber ?? "—"}** (${e.date ?? "—"}) ` +
            `D:${ad?.account ?? "—"} / C:${ac?.account ?? "—"} ` +
            `${e.amountHc ?? e.amount ?? "?"} ${cur?.code ?? "CZK"}` +
            (e.description ? ` — ${e.description}` : ""),
          );

          const ctrl = [cc?.shortCut && `CC:${cc.shortCut}`, proj?.shortCut && `Proj:${proj.shortCut}`, act?.shortCut && `Act:${act.shortCut}`].filter(Boolean);
          if (ctrl.length > 0) {
            lines.push(`  ${ctrl.join(" ")}`);
          }
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_chart_of_accounts",
    "Query the chart of accounts (accounting plan). Read-only.",
    {
      take: z.number().min(1).max(500).default(100),
      skip: z.number().min(0).default(0),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, order }) => {
      try {
        const gql = `{ accountCharts(${buildArgs(take, skip, undefined, order)}) {
        items { account name type year note }
        totalCount
      } }`;

        const data = await m3.query<{ accountCharts: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const coa = data.accountCharts;
        if (!coa?.items?.length) return textResult("No accounts found.");

        const lines = [`# Chart of Accounts (${coa.items.length} of ${coa.totalCount})`, ""];
        for (const a of coa.items) {
          lines.push(`- **${a.account ?? "—"}** ${a.name ?? "—"} (type: ${a.type ?? "—"})`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_predefined_entries",
    "Query predefined accounting entries (předkontace). Read-only.",
    {
      take: z.number().min(1).max(200).default(50),
      skip: z.number().min(0).default(0),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, order }) => {
      try {
        const gql = `{ accountAssignmentAccs(${buildArgs(take, skip, undefined, order)}) {
        items { shortCut type description note accountDebits { account name } accountCredits { account name } year }
        totalCount
      } }`;

        const data = await m3.query<{ accountAssignmentAccs: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const pe = data.accountAssignmentAccs;
        if (!pe?.items?.length) return textResult("No predefined entries found.");

        const lines = [`# Predefined Entries (${pe.items.length} of ${pe.totalCount})`, ""];
        for (const e of pe.items) {
          const ad = e.accountDebits as Record<string, unknown> | undefined;
          const ac = e.accountCredits as Record<string, unknown> | undefined;
          lines.push(`- **${e.shortCut ?? "—"}** (D:${ad?.account ?? "—"} / C:${ac?.account ?? "—"})${e.description ? ` — ${e.description}` : ""}`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
}
