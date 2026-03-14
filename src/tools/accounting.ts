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
        const gql = `{ accountingJournal(${buildArgs(take, skip, where, order)}) {
        items {
          id dateOfIssue dateOfAccounting documentNumber
          accountDebit accountCredit
          amount currency { code }
          costCenter { code name }
          project { code name }
          activity { code name }
          predefinedEntry
          text
        }
        totalCount
      } }`;

        const data = await m3.query<{ accountingJournal: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const aj = data.accountingJournal;
        if (!aj?.items?.length) return textResult("No journal entries found.");

        const lines = [`# Accounting Journal (${aj.items.length} of ${aj.totalCount})`, ""];
        for (const e of aj.items) {
          const cur = e.currency as Record<string, unknown> | undefined;
          const cc = e.costCenter as Record<string, unknown> | undefined;
          const proj = e.project as Record<string, unknown> | undefined;
          const act = e.activity as Record<string, unknown> | undefined;

          lines.push(
            `- **${e.documentNumber ?? "—"}** (${e.dateOfIssue ?? "—"}) ` +
            `D:${e.accountDebit ?? "—"} / C:${e.accountCredit ?? "—"} ` +
            `${e.amount ?? "?"} ${cur?.code ?? "CZK"}` +
            (e.text ? ` — ${e.text}` : ""),
          );

          const ctrl = [cc?.code && `CC:${cc.code}`, proj?.code && `Proj:${proj.code}`, act?.code && `Act:${act.code}`].filter(Boolean);
          if (ctrl.length > 0 || e.predefinedEntry) {
            lines.push(`  ${ctrl.join(" ")}${e.predefinedEntry ? ` | Entry: ${e.predefinedEntry}` : ""}`);
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
        const gql = `{ chartOfAccounts(${buildArgs(take, skip, undefined, order)}) {
        items { id accountNumber name type analyticalGroup }
        totalCount
      } }`;

        const data = await m3.query<{ chartOfAccounts: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const coa = data.chartOfAccounts;
        if (!coa?.items?.length) return textResult("No accounts found.");

        const lines = [`# Chart of Accounts (${coa.items.length} of ${coa.totalCount})`, ""];
        for (const a of coa.items) {
          lines.push(`- **${a.accountNumber ?? "—"}** ${a.name ?? "—"} (type: ${a.type ?? "—"}${a.analyticalGroup ? `, group: ${a.analyticalGroup}` : ""})`);
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
        const gql = `{ predefinedEntries(${buildArgs(take, skip, undefined, order)}) {
        items { id shortCut name accountDebit accountCredit description }
        totalCount
      } }`;

        const data = await m3.query<{ predefinedEntries: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const pe = data.predefinedEntries;
        if (!pe?.items?.length) return textResult("No predefined entries found.");

        const lines = [`# Predefined Entries (${pe.items.length} of ${pe.totalCount})`, ""];
        for (const e of pe.items) {
          lines.push(`- **${e.shortCut ?? "—"}** ${e.name ?? "—"} (D:${e.accountDebit ?? "—"} / C:${e.accountCredit ?? "—"})${e.description ? ` — ${e.description}` : ""}`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
}
