import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";

interface AgendaItem {
  guid: string;
  name?: string;
  ico?: string;
}

interface AgendaResult {
  agendas: { items: AgendaItem[] };
}

export function registerAgendaTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_agendas",
    "List all agendas (companies/databases) in this Money S3 instance with their GUIDs. Use the GUID to select which agenda to work with via m3_set_agenda.",
    {},
    async () => {
      const gql = `{ agendas { items { guid name ico } } }`;
      const data = await m3.query<AgendaResult>(gql);
      const items = data.agendas?.items ?? [];

      if (items.length === 0) {
        return { content: [{ type: "text" as const, text: "No agendas found." }] };
      }

      const lines = ["# Agendas", ""];
      for (const a of items) {
        lines.push(`- **${a.name ?? "Unnamed"}** (ICO: ${a.ico ?? "—"})  `);
        lines.push(`  GUID: \`${a.guid}\``);
      }
      lines.push("", "Use `m3_set_agenda` with one of these GUIDs to select the working agenda.");
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "m3_set_agenda",
    "Set the active agenda (company) for all subsequent API calls. Required before querying any data.",
    {
      guid: z.string().min(36).max(36).describe("Agenda GUID from m3_agendas"),
    },
    async ({ guid }) => {
      if (!/^[0-9a-f-]{36}$/i.test(guid)) {
        return { content: [{ type: "text" as const, text: "Invalid GUID format. Expected UUID like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`." }], isError: true };
      }
      m3.setAgendaGuid(guid);
      return { content: [{ type: "text" as const, text: `Active agenda set to \`${guid}\`. All data queries will now target this agenda.` }] };
    },
  );
}
