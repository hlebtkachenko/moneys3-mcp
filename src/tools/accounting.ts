import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";

export function registerAccountingTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_accounting_journal",
    "Query the accounting journal (podvojný deník) or cash journal (peněžní deník). Read-only.",
    {
      take: z.number().min(1).max(100).default(50),
      skip: z.number().min(0).default(0),
      where: z.string().optional().describe("GraphQL where filter"),
    },
    async ({ take, skip, where }) => {
      const parts: string[] = [`take: ${take}`, `skip: ${skip}`];
      if (where) parts.push(`where: ${where}`);

      const gql = `{ accountingJournal(${parts.join(", ")}) {
        items {
          id dateOfIssue documentNumber
          accountDebit accountCredit
          amount currency { code }
          text
        }
        totalCount
      } }`;

      const data = await m3.query<{ accountingJournal: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
      const aj = data.accountingJournal;

      if (!aj?.items?.length) return { content: [{ type: "text", text: "No journal entries found." }] };

      const lines = [`# Accounting Journal (${aj.items.length} of ${aj.totalCount})`, ""];
      for (const e of aj.items) {
        const cur = e.currency as Record<string, unknown> | undefined;
        lines.push(
          `- **${e.documentNumber ?? "—"}** (${e.dateOfIssue ?? "—"}) ` +
          `D:${e.accountDebit ?? "—"} / C:${e.accountCredit ?? "—"} ` +
          `${e.amount ?? "?"} ${cur?.code ?? "CZK"}` +
          (e.text ? ` — ${e.text}` : ""),
        );
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  server.tool(
    "m3_chart_of_accounts",
    "Query the chart of accounts (účetní osnova). Read/write accounting list.",
    {
      take: z.number().min(1).max(500).default(100),
      skip: z.number().min(0).default(0),
    },
    async ({ take, skip }) => {
      const gql = `{ chartOfAccounts(take: ${take}, skip: ${skip}) {
        items { id accountNumber name type analyticalGroup }
        totalCount
      } }`;

      const data = await m3.query<{ chartOfAccounts: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
      const coa = data.chartOfAccounts;

      if (!coa?.items?.length) return { content: [{ type: "text", text: "No accounts found." }] };

      const lines = [`# Chart of Accounts (${coa.items.length} of ${coa.totalCount})`, ""];
      for (const a of coa.items) {
        lines.push(`- **${a.accountNumber ?? "—"}** ${a.name ?? "—"} (type: ${a.type ?? "—"})`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  server.tool(
    "m3_predefined_entries",
    "Query predefined accounting entries (předkontace)",
    {
      take: z.number().min(1).max(200).default(50),
      skip: z.number().min(0).default(0),
    },
    async ({ take, skip }) => {
      const gql = `{ predefinedEntries(take: ${take}, skip: ${skip}) {
        items { id shortCut name accountDebit accountCredit }
        totalCount
      } }`;

      const data = await m3.query<{ predefinedEntries: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
      const pe = data.predefinedEntries;

      if (!pe?.items?.length) return { content: [{ type: "text", text: "No predefined entries found." }] };

      const lines = [`# Predefined Entries (${pe.items.length} of ${pe.totalCount})`, ""];
      for (const e of pe.items) {
        lines.push(`- **${e.shortCut ?? "—"}** ${e.name ?? "—"} (D:${e.accountDebit ?? "—"} / C:${e.accountCredit ?? "—"})`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
