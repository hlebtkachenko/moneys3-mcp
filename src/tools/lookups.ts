import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { buildArgs, textResult, errorResult } from "./helpers.js";

export function registerLookupTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_numerical_series",
    "List numerical series (numbering rules) for all document types. Read-only.",
    {
      take: z.number().min(1).max(200).default(50),
      skip: z.number().min(0).default(0),
      where: z.string().optional().describe("GraphQL where filter"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      try {
        const gql = `{ numericalSeries(${buildArgs(take, skip, where, order)}) {
        items {
          prefix number name
          isInvoicesIssued isInvoicesReceived
          isCashVouchersReceived isBankStatementsReceived
          isLiabilities isReceivables isInternalDocuments
          year
          centre { shortCut }
        }
        totalCount
      } }`;

        const data = await m3.query<{ numericalSeries: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const ns = data.numericalSeries;
        if (!ns?.items?.length) return textResult("No numerical series found.");

        const lines = [`# Numerical Series (${ns.items.length} of ${ns.totalCount})`, ""];
        for (const s of ns.items) {
          const types: string[] = [];
          if (s.isInvoicesIssued) types.push("Issued Inv.");
          if (s.isInvoicesReceived) types.push("Received Inv.");
          if (s.isCashVouchersReceived) types.push("Cash Vouchers");
          if (s.isBankStatementsReceived) types.push("Bank Stmt.");
          if (s.isLiabilities) types.push("Liabilities");
          if (s.isReceivables) types.push("Receivables");
          if (s.isInternalDocuments) types.push("Internal Docs");
          const centre = s.centre as Record<string, unknown> | undefined;
          lines.push(`- **${s.prefix ?? "—"}** ${s.name ?? "—"} (num: ${s.number ?? "?"}, year: ${s.year ?? "?"})${types.length ? ` [${types.join(", ")}]` : ""}${centre?.shortCut ? ` CC:${centre.shortCut}` : ""}`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_currencies",
    "List configured currencies with exchange rates. Read-only.",
    {
      take: z.number().min(1).max(200).default(50),
      skip: z.number().min(0).default(0),
      where: z.string().optional().describe("GraphQL where filter"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      try {
        const gql = `{ currencies(${buildArgs(take, skip, where, order)}) {
        items { code name exchangeRate exchangeRateAmount }
        totalCount
      } }`;

        const data = await m3.query<{ currencies: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const cur = data.currencies;
        if (!cur?.items?.length) return textResult("No currencies found.");

        const lines = [`# Currencies (${cur.items.length} of ${cur.totalCount})`, ""];
        for (const c of cur.items) {
          lines.push(`- **${c.code ?? "—"}** ${c.name ?? "—"} (rate: ${c.exchangeRate ?? "?"} per ${c.exchangeRateAmount ?? "?"})`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_vat_classifications",
    "List VAT classifications (DPH). Read-only.",
    {
      take: z.number().min(1).max(200).default(50),
      skip: z.number().min(0).default(0),
      where: z.string().optional().describe("GraphQL where filter"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      try {
        const gql = `{ vatClassifications(${buildArgs(take, skip, where, order)}) {
        items { shortCut name type vatRate }
        totalCount
      } }`;

        const data = await m3.query<{ vatClassifications: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const vc = data.vatClassifications;
        if (!vc?.items?.length) return textResult("No VAT classifications found.");

        const lines = [`# VAT Classifications (${vc.items.length} of ${vc.totalCount})`, ""];
        for (const v of vc.items) {
          lines.push(`- **${v.shortCut ?? "—"}** ${v.name ?? "—"} (type: ${v.type ?? "?"}, rate: ${v.vatRate ?? "?"}%)`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_vat_purposes",
    "List VAT purposes (ucel DPH). Read-only.",
    {
      take: z.number().min(1).max(200).default(50),
      skip: z.number().min(0).default(0),
      where: z.string().optional().describe("GraphQL where filter"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      try {
        const gql = `{ vatPurposes(${buildArgs(take, skip, where, order)}) {
        items { shortCut name }
        totalCount
      } }`;

        const data = await m3.query<{ vatPurposes: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const vp = data.vatPurposes;
        if (!vp?.items?.length) return textResult("No VAT purposes found.");

        const lines = [`# VAT Purposes (${vp.items.length} of ${vp.totalCount})`, ""];
        for (const v of vp.items) {
          lines.push(`- **${v.shortCut ?? "—"}** ${v.name ?? "—"}`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_constant_symbols",
    "List constant symbols (konstantni symboly). Read-only.",
    {
      take: z.number().min(1).max(200).default(50),
      skip: z.number().min(0).default(0),
      where: z.string().optional().describe("GraphQL where filter"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      try {
        const gql = `{ constantSymbols(${buildArgs(take, skip, where, order)}) {
        items { code name }
        totalCount
      } }`;

        const data = await m3.query<{ constantSymbols: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const cs = data.constantSymbols;
        if (!cs?.items?.length) return textResult("No constant symbols found.");

        const lines = [`# Constant Symbols (${cs.items.length} of ${cs.totalCount})`, ""];
        for (const c of cs.items) {
          lines.push(`- **${c.code ?? "—"}** ${c.name ?? "—"}`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_countries",
    "List country codes. Read-only.",
    {
      take: z.number().min(1).max(200).default(50),
      skip: z.number().min(0).default(0),
      where: z.string().optional().describe("GraphQL where filter"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      try {
        const gql = `{ countries(${buildArgs(take, skip, where, order)}) {
        items { code name }
        totalCount
      } }`;

        const data = await m3.query<{ countries: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const ct = data.countries;
        if (!ct?.items?.length) return textResult("No countries found.");

        const lines = [`# Countries (${ct.items.length} of ${ct.totalCount})`, ""];
        for (const c of ct.items) {
          lines.push(`- **${c.code ?? "—"}** ${c.name ?? "—"}`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_flags",
    "List flags/labels used for document tagging. Read-only.",
    {
      take: z.number().min(1).max(200).default(50),
      skip: z.number().min(0).default(0),
      where: z.string().optional().describe("GraphQL where filter"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      try {
        const gql = `{ flags(${buildArgs(take, skip, where, order)}) {
        items { shortCut name colour }
        totalCount
      } }`;

        const data = await m3.query<{ flags: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const fl = data.flags;
        if (!fl?.items?.length) return textResult("No flags found.");

        const lines = [`# Flags (${fl.items.length} of ${fl.totalCount})`, ""];
        for (const f of fl.items) {
          lines.push(`- **${f.shortCut ?? "—"}** ${f.name ?? "—"}${f.colour ? ` (colour: ${f.colour})` : ""}`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_crm_activities",
    "List CRM activity records (log of user actions on documents/contacts). Read-only.",
    {
      take: z.number().min(1).max(200).default(50),
      skip: z.number().min(0).default(0),
      where: z.string().optional().describe("GraphQL where filter"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      try {
        const gql = `{ activities(${buildArgs(take, skip, where, order)}) {
        items {
          dateOfStart description activityType
          documentNumber employee
          company { id }
          isDone note
        }
        totalCount
      } }`;

        const data = await m3.query<{ activities: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const act = data.activities;
        if (!act?.items?.length) return textResult("No CRM activities found.");

        const lines = [`# CRM Activities (${act.items.length} of ${act.totalCount})`, ""];
        for (const a of act.items) {
          const comp = a.company as Record<string, unknown> | undefined;
          lines.push(`- **${a.dateOfStart ?? "—"}** ${a.description ?? "—"} (type: ${a.activityType ?? "?"})${a.documentNumber ? ` doc: ${a.documentNumber}` : ""}${a.employee ? ` by: ${a.employee}` : ""}${comp?.id ? ` company: ${comp.id}` : ""}${a.isDone ? " [DONE]" : ""}`);
          if (a.note) lines.push(`  Note: ${a.note}`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
}
