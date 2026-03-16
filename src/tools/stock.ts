import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { escGql, DATE_RE, DATE_MSG, buildArgs, textResult, errorResult } from "./helpers.js";

export function registerStockTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_stock_cards",
    "Query stock/inventory cards with full detail: pricing, stock levels, barcodes, weight, warranty, categories",
    {
      take: z.number().min(1).max(100).default(20).describe("Number of records"),
      skip: z.number().min(0).default(0).describe("Records to skip"),
      where: z.string().optional().describe("GraphQL where filter"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      try {
        const gql = `{ articles(${buildArgs(take, skip, where, order)}) {
        items {
          id shortCut name description
          unit
          note
        }
        totalCount
      } }`;

        const data = await m3.query<{ articles: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const sc = data.articles;
        if (!sc?.items?.length) return textResult("No stock cards found.");

        const lines = [`# Stock Cards (${sc.items.length} of ${sc.totalCount})`, ""];
        for (const c of sc.items) {
          lines.push(`## ${c.name ?? "—"} (#${c.id ?? "?"}) [${c.shortCut ?? "—"}]`);
          lines.push(`- Unit: ${c.unit ?? "—"}`);
          if (c.description) lines.push(`- ${c.description}`);
          if (c.note) lines.push(`- Note: ${c.note}`);
          lines.push("");
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_stock_lists",
    "Query warehouses and price levels (read-only)",
    {},
    async () => {
      try {
        const whGql = `{ warehouses(take: 100) { items { id shortCut name } totalCount } }`;
        const plGql = `{ priceLevels(take: 100) { items { id shortCut name } totalCount } }`;
        const [whData, plData] = await Promise.all([
          m3.query<{ warehouses: { items: Record<string, unknown>[]; totalCount: number } }>(whGql),
          m3.query<{ priceLevels: { items: Record<string, unknown>[]; totalCount: number } }>(plGql),
        ]);
        const lines = ["# Stock Lists", "", "## Warehouses"];
        for (const w of whData.warehouses?.items ?? []) {
          lines.push(`- ${w.name ?? "—"} (shortCut: ${w.shortCut ?? "—"}, id: ${w.id ?? "?"})`);
        }
        lines.push("", "## Price Levels");
        for (const p of plData.priceLevels?.items ?? []) {
          lines.push(`- ${p.name ?? "—"} (shortCut: ${p.shortCut ?? "—"}, id: ${p.id ?? "?"})`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_stock_documents",
    "Query stock/warehouse documents with controlling variables, partner details, and line items",
    {
      take: z.number().min(1).max(100).default(20),
      skip: z.number().min(0).default(0),
      where: z.string().optional().describe("GraphQL where filter"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      try {
        const gql = `{ receivedSlips(${buildArgs(take, skip, where, order)}) {
        items {
          id documentNumber dateOfIssue
          totalWithVatHc
          partnerAddress {
            businessAddress { name street municipality postalCode country }
            identificationNumber
          }
          centre { shortCut name }
          jobOrder { shortCut name }
          operation { shortCut name }
          items { description amount unitPriceHc vatRate }
          description
        }
        totalCount
      } }`;

        const data = await m3.query<{ receivedSlips: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const sd = data.receivedSlips;
        if (!sd?.items?.length) return textResult("No stock documents found.");

        const lines = [`# Stock Documents (${sd.items.length} of ${sd.totalCount})`, ""];
        for (const d of sd.items) {
          const partner = d.partnerAddress as Record<string, unknown> | undefined;
          const biz = partner?.businessAddress as Record<string, unknown> | undefined;
          const cc = d.centre as Record<string, unknown> | undefined;
          const proj = d.jobOrder as Record<string, unknown> | undefined;
          const act = d.operation as Record<string, unknown> | undefined;
          const items = d.items as Array<Record<string, unknown>> | undefined;

          lines.push(`## ${d.documentNumber ?? "—"} (${d.dateOfIssue ?? "—"})`);
          lines.push(`- Partner: ${biz?.name ?? "—"} (ICO: ${partner?.identificationNumber ?? "—"})`);
          lines.push(`- Total: ${d.totalWithVatHc ?? "?"}`);

          const ctrl = [cc?.shortCut && `CC:${cc.shortCut}`, proj?.shortCut && `Proj:${proj.shortCut}`, act?.shortCut && `Act:${act.shortCut}`].filter(Boolean);
          if (ctrl.length > 0) lines.push(`- Controlling: ${ctrl.join(" ")}`);

          if (items && items.length > 0) {
            lines.push("- Items:");
            for (const it of items) {
              lines.push(`  - ${it.description ?? "—"}: ${it.amount ?? 0} × ${it.unitPriceHc ?? 0}`);
            }
          }
          if (d.description) lines.push(`- Description: ${d.description}`);
          lines.push("");
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_create_stock_card",
    "Create a new stock/inventory card with optional barcode, weight, warranty, category. Async import queue.",
    {
      catalogueNumber: z.string().describe("Catalogue/SKU number"),
      name: z.string().describe("Product name"),
      unit: z.string().default("ks").describe("Unit of measure"),
      sellingPriceHc: z.number().optional().describe("Selling price"),
      purchasePriceHc: z.number().optional().describe("Purchase price"),
      ean: z.string().optional().describe("EAN barcode"),
      weight: z.number().optional().describe("Weight per unit"),
      minimumStock: z.number().optional().describe("Minimum stock level"),
      maximumStock: z.number().optional().describe("Maximum stock level"),
      warrantyMonths: z.number().int().optional().describe("Warranty period in months"),
      categoryCode: z.string().optional().describe("Category code"),
      groupCode: z.string().optional().describe("Group code"),
      warehouseCode: z.string().optional().describe("Default warehouse code"),
      definitionShortcut: z.string().default("_zSK").describe("XML transfer definition shortcut"),
    },
    async (params) => {
      try {
        const fields = [
          `shortCut: "${escGql(params.catalogueNumber)}"`,
          `name: "${escGql(params.name)}"`,
          `unit: "${escGql(params.unit)}"`,
        ].filter(Boolean).join(", ");

        const gql = `mutation {
  createArticle(
    article: { ${fields} }
    definitionXMLTransfer: { shortCut: "${escGql(params.definitionShortcut)}" }
  ) { guid isSuccess }
}`;

        const data = await m3.query<{ createArticle: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.createArticle;
        return textResult(`Stock card "${params.name}" ${result.isSuccess ? "created" : "queued"}.\nGUID: \`${result.guid}\``);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_create_stock_document",
    "Create a stock/warehouse document (receipt or dispatch) with controlling vars. Async import queue.",
    {
      dateOfIssue: z.string().regex(DATE_RE, DATE_MSG).describe("Date (DD.MM.YYYY)"),
      documentNumber: z.string().optional(),
      partnerName: z.string().optional().describe("Partner company name"),
      costCenterCode: z.string().optional().describe("Cost center code"),
      projectCode: z.string().optional().describe("Project code"),
      activityCode: z.string().optional().describe("Activity code"),
      warehouseCode: z.string().optional().describe("Warehouse code"),
      items: z.array(z.object({
        description: z.string(),
        amount: z.number().min(0),
        unitPriceHc: z.number(),
        serialNumber: z.string().optional(),
        discount: z.number().min(0).max(100).optional(),
      })).min(1).describe("Document line items"),
      definitionShortcut: z.string().default("_SD").describe("XML transfer definition shortcut"),
    },
    async (params) => {
      try {
        const itemsGql = params.items.map((it) => {
          const parts = [
            `description: "${escGql(it.description)}"`,
            `amount: ${it.amount}`,
            `unitPriceHc: ${it.unitPriceHc}`,
            it.serialNumber ? `serialNumber: "${escGql(it.serialNumber)}"` : "",
            it.discount ? `discount: ${it.discount}` : "",
          ].filter(Boolean);
          return `{ ${parts.join(", ")} }`;
        }).join(", ");

        const extras = [
          params.partnerName ? `partnerAddress: { businessAddress: { name: "${escGql(params.partnerName)}" } }` : "",
          params.documentNumber ? `documentNumber: "${escGql(params.documentNumber)}"` : "",
          params.costCenterCode ? `centre: { shortCut: "${escGql(params.costCenterCode)}" }` : "",
          params.projectCode ? `jobOrder: { shortCut: "${escGql(params.projectCode)}" }` : "",
          params.activityCode ? `operation: { shortCut: "${escGql(params.activityCode)}" }` : "",
          params.warehouseCode ? `warehouse: { shortCut: "${escGql(params.warehouseCode)}" }` : "",
        ].filter(Boolean).join("\n      ");

        const gql = `mutation {
  createReceivedSlip(
    receivedSlip: {
      dateOfIssue: "${escGql(params.dateOfIssue)}"
      ${extras}
      items: [${itemsGql}]
    }
    definitionXMLTransfer: { shortCut: "${escGql(params.definitionShortcut)}" }
  ) { guid isSuccess }
}`;

        const data = await m3.query<{ createReceivedSlip: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.createReceivedSlip;
        return textResult(`Stock document ${result.isSuccess ? "created" : "queued"}.\nGUID: \`${result.guid}\``);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_create_inventory_document",
    "Create an inventory/stocktaking document. Async import queue.",
    {
      dateOfIssue: z.string().regex(DATE_RE, DATE_MSG).describe("Date (DD.MM.YYYY)"),
      documentNumber: z.string().optional(),
      warehouseCode: z.string().optional().describe("Warehouse code"),
      definitionShortcut: z.string().default("_INV").describe("XML transfer definition shortcut"),
    },
    async (params) => {
      try {
        const extras = [
          params.documentNumber ? `documentNumber: "${escGql(params.documentNumber)}"` : "",
          params.warehouseCode ? `warehouse: { shortCut: "${escGql(params.warehouseCode)}" }` : "",
        ].filter(Boolean).join("\n      ");

        const gql = `mutation {
  createStockTakingDocument(
    stockTakingDocument: {
      dateOfIssue: "${escGql(params.dateOfIssue)}"
      ${extras}
    }
    definitionXMLTransfer: { shortCut: "${escGql(params.definitionShortcut)}" }
  ) { guid isSuccess }
}`;

        const data = await m3.query<{ createStockTakingDocument: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.createStockTakingDocument;
        return textResult(`Inventory document ${result.isSuccess ? "created" : "queued"}.\nGUID: \`${result.guid}\``);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
}
