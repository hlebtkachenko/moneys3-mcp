import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";

export function registerStockTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_stock_cards",
    "Query stock/inventory cards (products, materials) with optional filtering and pagination",
    {
      take: z.number().min(1).max(100).default(20).describe("Number of records"),
      skip: z.number().min(0).default(0).describe("Records to skip"),
      where: z.string().optional().describe("GraphQL where filter"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      const parts: string[] = [`take: ${take}`, `skip: ${skip}`];
      if (where) parts.push(`where: ${where}`);
      if (order) parts.push(`order: ${order}`);

      const gql = `{ stockCards(${parts.join(", ")}) {
        items {
          id catalogueNumber name description
          unit sellingPriceHc purchasePriceHc
          stockAmount minimumStock
          vatRateSale vatRatePurchase
          ean barcode
        }
        totalCount
      } }`;

      const data = await m3.query<{ stockCards: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
      const sc = data.stockCards;

      if (!sc?.items?.length) {
        return { content: [{ type: "text", text: "No stock cards found." }] };
      }

      const lines = [`# Stock Cards (${sc.items.length} of ${sc.totalCount})`, ""];
      for (const c of sc.items) {
        lines.push(`## ${c.name ?? "—"} (#${c.id ?? "?"}) [${c.catalogueNumber ?? "—"}]`);
        lines.push(`- Unit: ${c.unit ?? "—"} | Stock: ${c.stockAmount ?? 0} (min: ${c.minimumStock ?? 0})`);
        lines.push(`- Sell: ${c.sellingPriceHc ?? "—"} | Buy: ${c.purchasePriceHc ?? "—"}`);
        if (c.ean) lines.push(`- EAN: ${c.ean}`);
        if (c.description) lines.push(`- ${c.description}`);
        lines.push("");
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  server.tool(
    "m3_stock_lists",
    "Query stock lists — warehouses and price levels (read-only)",
    {},
    async () => {
      const gql = `{ stockLists {
        warehouses { items { id name code } }
        priceLevels { items { id name code } }
      } }`;
      const data = await m3.query<{ stockLists: { warehouses: { items: Record<string, unknown>[] }; priceLevels: { items: Record<string, unknown>[] } } }>(gql);
      const sl = data.stockLists;
      const lines = ["# Stock Lists", "", "## Warehouses"];
      for (const w of sl?.warehouses?.items ?? []) {
        lines.push(`- ${w.name ?? "—"} (code: ${w.code ?? "—"}, id: ${w.id ?? "?"})`);
      }
      lines.push("", "## Price Levels");
      for (const p of sl?.priceLevels?.items ?? []) {
        lines.push(`- ${p.name ?? "—"} (code: ${p.code ?? "—"}, id: ${p.id ?? "?"})`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  server.tool(
    "m3_stock_documents",
    "Query stock/warehouse documents (receipts, dispatches) with pagination",
    {
      take: z.number().min(1).max(100).default(20).describe("Number of records"),
      skip: z.number().min(0).default(0).describe("Records to skip"),
      where: z.string().optional().describe("GraphQL where filter"),
    },
    async ({ take, skip, where }) => {
      const parts: string[] = [`take: ${take}`, `skip: ${skip}`];
      if (where) parts.push(`where: ${where}`);

      const gql = `{ stockDocuments(${parts.join(", ")}) {
        items {
          id documentNumber dateOfIssue
          partnerAddress { businessAddress { name } }
          items { description amount unitPriceHc }
        }
        totalCount
      } }`;

      const data = await m3.query<{ stockDocuments: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
      const sd = data.stockDocuments;

      if (!sd?.items?.length) {
        return { content: [{ type: "text", text: "No stock documents found." }] };
      }

      const lines = [`# Stock Documents (${sd.items.length} of ${sd.totalCount})`, ""];
      for (const d of sd.items) {
        const partner = d.partnerAddress as Record<string, unknown> | undefined;
        const biz = partner?.businessAddress as Record<string, unknown> | undefined;
        lines.push(`- **${d.documentNumber ?? "—"}** (${d.dateOfIssue ?? "—"}) — ${biz?.name ?? "—"}`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  server.tool(
    "m3_create_stock_card",
    "Create a new stock/inventory card. Async import queue.",
    {
      catalogueNumber: z.string().describe("Catalogue/SKU number"),
      name: z.string().describe("Product name"),
      unit: z.string().default("ks").describe("Unit of measure"),
      sellingPriceHc: z.number().optional().describe("Selling price"),
      purchasePriceHc: z.number().optional().describe("Purchase price"),
      definitionShortcut: z.string().default("_zSK").describe("XML transfer definition shortcut"),
    },
    async (params) => {
      const fields = [
        `catalogueNumber: "${params.catalogueNumber}"`,
        `name: "${params.name}"`,
        `unit: "${params.unit}"`,
        params.sellingPriceHc != null ? `sellingPriceHc: ${params.sellingPriceHc}` : "",
        params.purchasePriceHc != null ? `purchasePriceHc: ${params.purchasePriceHc}` : "",
      ].filter(Boolean).join(", ");

      const gql = `mutation {
  createStockCard(
    stockCard: { ${fields} }
    definitionXMLTransfer: { shortCut: "${params.definitionShortcut}" }
  ) { guid isSuccess }
}`;

      const data = await m3.query<{ createStockCard: { guid: string; isSuccess: boolean } }>(gql, true);
      const result = data.createStockCard;
      return { content: [{ type: "text", text: `Stock card "${params.name}" ${result.isSuccess ? "created" : "queued"}.\nGUID: \`${result.guid}\`` }] };
    },
  );
}
