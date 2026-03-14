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
        const gql = `{ stockCards(${buildArgs(take, skip, where, order)}) {
        items {
          id catalogueNumber name description
          unit sellingPriceHc purchasePriceHc lastPurchasePriceHc
          stockAmount minimumStock maximumStock reorderLevel
          vatRateSale vatRatePurchase
          ean barcode serialNumbers
          weight volume
          warrantyMonths
          supplier { name identificationNumber }
          category { name code }
          group { name code }
          warehouse { name code }
          note
        }
        totalCount
      } }`;

        const data = await m3.query<{ stockCards: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const sc = data.stockCards;
        if (!sc?.items?.length) return textResult("No stock cards found.");

        const lines = [`# Stock Cards (${sc.items.length} of ${sc.totalCount})`, ""];
        for (const c of sc.items) {
          const sup = c.supplier as Record<string, unknown> | undefined;
          const cat = c.category as Record<string, unknown> | undefined;
          const grp = c.group as Record<string, unknown> | undefined;
          const wh = c.warehouse as Record<string, unknown> | undefined;

          lines.push(`## ${c.name ?? "—"} (#${c.id ?? "?"}) [${c.catalogueNumber ?? "—"}]`);
          lines.push(`- Unit: ${c.unit ?? "—"} | Stock: ${c.stockAmount ?? 0} (min: ${c.minimumStock ?? "—"}, max: ${c.maximumStock ?? "—"})`);
          lines.push(`- Sell: ${c.sellingPriceHc ?? "—"} | Buy: ${c.purchasePriceHc ?? "—"} | Last buy: ${c.lastPurchasePriceHc ?? "—"}`);
          lines.push(`- VAT sale: ${c.vatRateSale ?? "—"} | VAT purchase: ${c.vatRatePurchase ?? "—"}`);
          if (c.ean || c.barcode) lines.push(`- EAN: ${c.ean ?? "—"} | Barcode: ${c.barcode ?? "—"}`);
          if (c.weight || c.volume) lines.push(`- Weight: ${c.weight ?? "—"} | Volume: ${c.volume ?? "—"}`);
          if (c.warrantyMonths) lines.push(`- Warranty: ${c.warrantyMonths} months`);
          if (sup?.name) lines.push(`- Supplier: ${sup.name} (${sup.identificationNumber ?? "—"})`);
          if (cat?.name) lines.push(`- Category: ${cat.name} (${cat.code ?? "—"})`);
          if (grp?.name) lines.push(`- Group: ${grp.name} (${grp.code ?? "—"})`);
          if (wh?.name) lines.push(`- Warehouse: ${wh.name} (${wh.code ?? "—"})`);
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
    "Query stock lists — warehouses and price levels (read-only)",
    {},
    async () => {
      try {
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
        const gql = `{ stockDocuments(${buildArgs(take, skip, where, order)}) {
        items {
          id documentNumber dateOfIssue
          totalPriceHcWithVat totalPriceHcWithoutVat
          partnerAddress {
            businessAddress { name street city zip }
            company { identificationNumber }
          }
          costCenter { code name }
          project { code name }
          activity { code name }
          warehouse { name code }
          items { description amount unitPriceHc vatRate serialNumber discount }
          text note
        }
        totalCount
      } }`;

        const data = await m3.query<{ stockDocuments: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const sd = data.stockDocuments;
        if (!sd?.items?.length) return textResult("No stock documents found.");

        const lines = [`# Stock Documents (${sd.items.length} of ${sd.totalCount})`, ""];
        for (const d of sd.items) {
          const partner = d.partnerAddress as Record<string, unknown> | undefined;
          const biz = partner?.businessAddress as Record<string, unknown> | undefined;
          const co = partner?.company as Record<string, unknown> | undefined;
          const cc = d.costCenter as Record<string, unknown> | undefined;
          const proj = d.project as Record<string, unknown> | undefined;
          const act = d.activity as Record<string, unknown> | undefined;
          const wh = d.warehouse as Record<string, unknown> | undefined;
          const items = d.items as Array<Record<string, unknown>> | undefined;

          lines.push(`## ${d.documentNumber ?? "—"} (${d.dateOfIssue ?? "—"})`);
          lines.push(`- Partner: ${biz?.name ?? "—"} (ICO: ${co?.identificationNumber ?? "—"})`);
          lines.push(`- Total: ${d.totalPriceHcWithVat ?? "?"} (without VAT: ${d.totalPriceHcWithoutVat ?? "?"})`);
          if (wh?.name) lines.push(`- Warehouse: ${wh.name} (${wh.code ?? "—"})`);

          const ctrl = [cc?.code && `CC:${cc.code}`, proj?.code && `Proj:${proj.code}`, act?.code && `Act:${act.code}`].filter(Boolean);
          if (ctrl.length > 0) lines.push(`- Controlling: ${ctrl.join(" ")}`);

          if (items && items.length > 0) {
            lines.push("- Items:");
            for (const it of items) {
              const disc = it.discount ? ` (-${it.discount}%)` : "";
              const sn = it.serialNumber ? ` SN:${it.serialNumber}` : "";
              lines.push(`  - ${it.description ?? "—"}: ${it.amount ?? 0} × ${it.unitPriceHc ?? 0}${disc}${sn}`);
            }
          }
          if (d.text) lines.push(`- Text: ${d.text}`);
          if (d.note) lines.push(`- Note: ${d.note}`);
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
          `catalogueNumber: "${escGql(params.catalogueNumber)}"`,
          `name: "${escGql(params.name)}"`,
          `unit: "${escGql(params.unit)}"`,
          params.sellingPriceHc != null ? `sellingPriceHc: ${params.sellingPriceHc}` : "",
          params.purchasePriceHc != null ? `purchasePriceHc: ${params.purchasePriceHc}` : "",
          params.ean ? `ean: "${escGql(params.ean)}"` : "",
          params.weight != null ? `weight: ${params.weight}` : "",
          params.minimumStock != null ? `minimumStock: ${params.minimumStock}` : "",
          params.maximumStock != null ? `maximumStock: ${params.maximumStock}` : "",
          params.warrantyMonths != null ? `warrantyMonths: ${params.warrantyMonths}` : "",
          params.categoryCode ? `category: { code: "${escGql(params.categoryCode)}" }` : "",
          params.groupCode ? `group: { code: "${escGql(params.groupCode)}" }` : "",
          params.warehouseCode ? `warehouse: { code: "${escGql(params.warehouseCode)}" }` : "",
        ].filter(Boolean).join(", ");

        const gql = `mutation {
  createStockCard(
    stockCard: { ${fields} }
    definitionXMLTransfer: { shortCut: "${escGql(params.definitionShortcut)}" }
  ) { guid isSuccess }
}`;

        const data = await m3.query<{ createStockCard: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.createStockCard;
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
          params.costCenterCode ? `costCenter: { code: "${escGql(params.costCenterCode)}" }` : "",
          params.projectCode ? `project: { code: "${escGql(params.projectCode)}" }` : "",
          params.activityCode ? `activity: { code: "${escGql(params.activityCode)}" }` : "",
          params.warehouseCode ? `warehouse: { code: "${escGql(params.warehouseCode)}" }` : "",
        ].filter(Boolean).join("\n      ");

        const gql = `mutation {
  createStockDocument(
    stockDocument: {
      dateOfIssue: "${escGql(params.dateOfIssue)}"
      ${extras}
      items: [${itemsGql}]
    }
    definitionXMLTransfer: { shortCut: "${escGql(params.definitionShortcut)}" }
  ) { guid isSuccess }
}`;

        const data = await m3.query<{ createStockDocument: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.createStockDocument;
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
          params.warehouseCode ? `warehouse: { code: "${escGql(params.warehouseCode)}" }` : "",
        ].filter(Boolean).join("\n      ");

        const gql = `mutation {
  createInventoryDocument(
    inventoryDocument: {
      dateOfIssue: "${escGql(params.dateOfIssue)}"
      ${extras}
    }
    definitionXMLTransfer: { shortCut: "${escGql(params.definitionShortcut)}" }
  ) { guid isSuccess }
}`;

        const data = await m3.query<{ createInventoryDocument: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.createInventoryDocument;
        return textResult(`Inventory document ${result.isSuccess ? "created" : "queued"}.\nGUID: \`${result.guid}\``);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
}
