import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { RAW, READ, errorResult, listParams, listTool, str, textResult } from "./helpers.js";

export function registerGraphQLTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_graphql",
    "Execute a raw GraphQL query or mutation against the Money S3 API. Mutations are detected by parsing the document; they are never cached or retried. Use when no built-in tool covers the need.",
    {
      query: z.string().min(1).max(10_000).describe("Full GraphQL query or mutation document"),
    },
    RAW,
    async ({ query }) => {
      try {
        const formatted = JSON.stringify(await m3.raw<unknown>(query), null, 2);
        if (formatted.length > 50_000) {
          return textResult(`${formatted.slice(0, 50_000)}\n\n... (truncated, use take/skip to limit results)`);
        }
        return textResult(formatted);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_import_status",
    "Check how Money S3 processed a queued write. Pass the import GUID returned by any m3_create_* or m3_delete_* tool. Read-only.",
    { guid: z.guid().describe("Import GUID returned by a create/delete tool") },
    READ,
    // Shape from money.cz's output-message examples (vystupni_zpravy_priklady.pdf):
    // importStatus(importGuid) { guid state stateInfo }. The state values are not
    // documented, so they are reported verbatim.
    async ({ guid }) => {
      try {
        const data = await m3.query<{ importStatus: Record<string, unknown> | null }>(
          `{ importStatus(importGuid: ${JSON.stringify(guid)}) { guid state stateInfo } }`,
        );
        const s = data.importStatus;
        if (!s) return errorResult(`No import found for GUID ${guid}.`);
        return textResult(`# Import ${str(s.guid, guid)}\n- State: ${str(s.state)}\n- Info: ${str(s.stateInfo)}`);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_connection_test",
    "Test the Money S3 API connection: OAuth2 auth, endpoint reachability and agenda access. Auto-selects the agenda when there is only one.",
    {},
    READ,
    async () => {
      try {
        const data = await m3.query<{ agendas: { items: Array<{ guid: string; name?: string }> } }>(`{ agendas { items { guid name } } }`);
        const agendas = data.agendas?.items ?? [];
        const lines = ["# Connection Test", "", "- OAuth2 token: OK", `- GraphQL endpoint: ${m3.graphqlUrl}`, `- Agendas found: ${agendas.length}`];
        for (const a of agendas) lines.push(`  - ${a.name ?? "Unnamed"}: \`${a.guid}\``);

        const current = m3.getAgendaGuid();
        if (current) {
          const match = agendas.find((a) => a.guid === current);
          lines.push("", `- Active agenda: \`${current}\`${match ? ` (${match.name ?? "Unnamed"})` : " (not found in agenda list!)"}`);
        } else if (agendas.length === 1) {
          m3.setAgendaGuid(agendas[0].guid);
          lines.push("", `- Auto-selected the only agenda: \`${agendas[0].guid}\` (${agendas[0].name ?? "Unnamed"})`);
        } else {
          lines.push("", "- No agenda selected. Use `m3_set_agenda` to select one before querying data.");
        }
        lines.push("", "Connection successful.");
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult(`Connection FAILED: ${(err as Error).message}`);
      }
    },
  );

  server.tool(
    "m3_orders",
    "Query received or issued orders (objednávky) with partner and items. Read-only.",
    { type: z.enum(["received", "issued"]).describe("Order direction"), ...listParams() },
    READ,
    // Collections from 950ac9a's list; fields mirror the createReceivedOrder
    // example in mutation_priklady.pdf (order read types are not in the summary).
    async ({ type, ...args }) =>
      listTool(
        m3,
        type === "received" ? "receivedOrders" : "issuedOrders",
        `id year isDeleted documentNumber variableSymbol dateOfIssue description
         partnerAddress { businessAddress { name } identificationNumber }
         items { description amount unitPriceHc vatRate }`,
        type === "received" ? "Received Orders" : "Issued Orders",
        args,
        (d) => {
          const partner = d.partnerAddress as Record<string, unknown> | undefined;
          const biz = partner?.businessAddress as Record<string, unknown> | undefined;
          const items = (d.items as Array<Record<string, unknown>> | undefined) ?? [];
          return [
            `- **${str(d.documentNumber)}** (${str(d.dateOfIssue)}; id ${str(d.id)}) ${str(biz?.name)} (ICO: ${str(partner?.identificationNumber)})`,
            ...items.map((it) => `  - ${str(it.description)}: ${it.amount ?? 0} × ${it.unitPriceHc ?? 0} (VAT ${str(it.vatRate)}%)`),
          ].join("\n");
        },
        "\n",
      ),
  );
}
