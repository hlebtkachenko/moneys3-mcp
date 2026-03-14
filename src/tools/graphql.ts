import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { textResult, errorResult } from "./helpers.js";

export function registerGraphQLTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_graphql",
    "Execute a raw GraphQL query or mutation against the Money S3 API. For advanced use when built-in tools don't cover a specific need.",
    {
      query: z.string().min(1).describe("Full GraphQL query or mutation string"),
      isMutation: z.boolean().default(false).describe("Set true if this is a mutation (invalidates cache)"),
    },
    async ({ query, isMutation }) => {
      if (query.length > 10_000) {
        return errorResult("Query too long (max 10,000 characters).");
      }

      try {
        const data = await m3.query<unknown>(query, isMutation);
        const formatted = JSON.stringify(data, null, 2);

        if (formatted.length > 50_000) {
          return textResult(
            formatted.slice(0, 50_000) + "\n\n... (truncated, use pagination with take/skip to limit results)",
          );
        }

        return textResult(formatted);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_connection_test",
    "Test the Money S3 API connection — verifies OAuth2 auth, endpoint reachability, and agenda access",
    {},
    async () => {
      const lines: string[] = ["# Connection Test", ""];

      try {
        const gql = `{ agendas { items { guid name } } }`;
        const data = await m3.query<{ agendas: { items: Array<{ guid: string; name?: string }> } }>(gql);
        const agendas = data.agendas?.items ?? [];

        lines.push("- OAuth2 token: OK");
        lines.push(`- GraphQL endpoint: ${m3.graphqlUrl}`);
        lines.push(`- Agendas found: ${agendas.length}`);

        for (const a of agendas) {
          lines.push(`  - ${a.name ?? "Unnamed"}: \`${a.guid}\``);
        }

        lines.push("", "Connection successful.");
      } catch (err) {
        lines.push(`- Connection FAILED: ${(err as Error).message}`);
      }

      return textResult(lines.join("\n"));
    },
  );

  server.tool(
    "m3_orders",
    "Query order documents (objednávkové doklady) with pagination",
    {
      take: z.number().min(1).max(100).default(20),
      skip: z.number().min(0).default(0),
      where: z.string().optional().describe("GraphQL where filter"),
    },
    async ({ take, skip, where }) => {
      try {
        const parts: string[] = [`take: ${take}`, `skip: ${skip}`];
        if (where) parts.push(`where: ${where}`);

        const gql = `{ orderDocuments(${parts.join(", ")}) {
        items {
          id documentNumber dateOfIssue
          partnerAddress { businessAddress { name } company { identificationNumber } }
          totalPriceHcWithVat
          items { description amount unitPriceHc }
        }
        totalCount
      } }`;

        const data = await m3.query<{ orderDocuments: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const od = data.orderDocuments;

        if (!od?.items?.length) return textResult("No order documents found.");

        const lines = [`# Order Documents (${od.items.length} of ${od.totalCount})`, ""];
        for (const d of od.items) {
          const partner = d.partnerAddress as Record<string, unknown> | undefined;
          const biz = partner?.businessAddress as Record<string, unknown> | undefined;
          lines.push(`- **${d.documentNumber ?? "—"}** (${d.dateOfIssue ?? "—"}) — ${biz?.name ?? "—"} — ${d.totalPriceHcWithVat ?? "?"}`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
}
