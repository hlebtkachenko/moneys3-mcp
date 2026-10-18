import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { READ, buildArgs, errorResult, listParams, listTool, str, textResult } from "./helpers.js";

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
    READ,
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
    READ,
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
    "Query predefined entries (předkontace) for double-entry accounting or for tax records (daňová evidence). Read-only.",
    {
      ledger: z.enum(["accounting", "tax"]).default("accounting").describe("accounting: accountAssignmentAccs; tax: accountAssignmentTrs"),
      ...listParams(200, 50),
    },
    READ,
    async ({ ledger, ...args }) =>
      ledger === "accounting"
        ? listTool(
            m3,
            "accountAssignmentAccs",
            "shortCut type description note year accountDebits { account name } accountCredits { account name } vatClassification { shortCut }",
            "Predefined Entries (accounting)",
            args,
            (e) =>
              `- **${str(e.shortCut)}** (${str(e.type)}; D:${str(shortOf(e.accountDebits, "account"))} / C:${str(shortOf(e.accountCredits, "account"))}${vatOf(e)})${e.description ? ` ${e.description}` : ""}`,
            "\n",
          )
        : listTool(
            m3,
            "accountAssignmentTrs",
            "shortCut type description note year accountMovement { shortCut description } vatAccountingTr { shortCut } vatClassification { shortCut }",
            "Predefined Entries (tax records)",
            args,
            (e) =>
              `- **${str(e.shortCut)}** (${str(e.type)}; movement ${str(shortOf(e.accountMovement, "shortCut"))}${vatOf(e)})${e.description ? ` ${e.description}` : ""}`,
            "\n",
          ),
  );

  server.tool(
    "m3_vat_accounting",
    "Query VAT accounting rules (rozúčtování DPH): basic and reduced rate accounts for double-entry accounting, or movements for tax records. Read-only.",
    { ledger: z.enum(["accounting", "tax"]).default("accounting").describe("accounting: vatAccountingAccs; tax: vatAccountingTrs"), ...listParams(200, 50) },
    READ,
    async ({ ledger, ...args }) =>
      ledger === "accounting"
        ? listTool(
            m3,
            "vatAccountingAccs",
            "id shortCut type description year accountDebitsBasic { account } accountCreditsBasic { account } accountDebitsReduced { account } accountCreditsReduced { account }",
            "VAT Accounting (accounting)",
            args,
            (v) =>
              `- **${str(v.shortCut)}** ${str(v.description)} (${str(v.type)}, ${str(v.year)}): basic D:${str(shortOf(v.accountDebitsBasic, "account"))} C:${str(shortOf(v.accountCreditsBasic, "account"))}, reduced D:${str(shortOf(v.accountDebitsReduced, "account"))} C:${str(shortOf(v.accountCreditsReduced, "account"))}`,
            "\n",
          )
        : listTool(
            m3,
            "vatAccountingTrs",
            "id shortCut type description year accountMovementBasic { shortCut } accountMovementReduced { shortCut }",
            "VAT Accounting (tax records)",
            args,
            (v) =>
              `- **${str(v.shortCut)}** ${str(v.description)} (${str(v.type)}, ${str(v.year)}): basic ${str(shortOf(v.accountMovementBasic, "shortCut"))}, reduced ${str(shortOf(v.accountMovementReduced, "shortCut"))}`,
            "\n",
          ),
  );
}

type Rec = Record<string, unknown>;
const shortOf = (v: unknown, key: string) => (v as Rec | null | undefined)?.[key];
const vatOf = (e: Rec) => (shortOf(e.vatClassification, "shortCut") ? `; VAT ${shortOf(e.vatClassification, "shortCut")}` : "");
