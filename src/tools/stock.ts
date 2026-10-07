import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import {
  CREATE,
  READ,
  controllingInput,
  controllingParams,
  controllingText,
  dateParam,
  definitionParam,
  errorResult,
  isoDate,
  listParams,
  listTool,
  partnerInput,
  partnerSchema,
  runMutation,
  str,
  textResult,
} from "./helpers.js";

// Article fields mirror the warehouseStocks.article example in query_priklady.pdf;
// the `articles` root itself is not in the schema summary (unverified).
const ARTICLE_FIELDS = "id guid catalogue description barCode plu weight articleItemType";

export function registerStockTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_stock_cards",
    "Query stock cards (articles): catalogue number, description, barcode, PLU, weight. Read-only.",
    listParams(),
    READ,
    async (args) =>
      listTool(m3, "articles", ARTICLE_FIELDS, "Stock Cards", args, (c) =>
        [
          `## ${str(c.description)} [${str(c.catalogue)}] (id ${str(c.id)})`,
          `- Barcode: ${str(c.barCode)} | PLU: ${str(c.plu)} | Weight: ${str(c.weight)} | Type: ${str(c.articleItemType)}`,
        ].join("\n"),
      ),
  );

  server.tool(
    "m3_stock_lists",
    "List warehouses and price levels. Read-only.",
    {},
    READ,
    async () => {
      try {
        const [wh, pl] = await Promise.all([
          m3.query<{ warehouses: { items: Record<string, unknown>[] } }>(`{ warehouses(take: 100) { items { id code name } totalCount } }`),
          m3.query<{ priceLevels: { items: Record<string, unknown>[] } }>(`{ priceLevels(take: 100) { items { id shortCut name } totalCount } }`),
        ]);
        const lines = ["# Stock Lists", "", "## Warehouses"];
        for (const w of wh.warehouses?.items ?? []) lines.push(`- ${str(w.name)} (code: ${str(w.code)}, id: ${str(w.id, "?")})`);
        lines.push("", "## Price Levels");
        for (const p of pl.priceLevels?.items ?? []) lines.push(`- ${str(p.name)} (shortCut: ${str(p.shortCut)}, id: ${str(p.id, "?")})`);
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_stock_documents",
    "Query received stock slips (příjemky) with partner and controlling variables. Read-only.",
    listParams(),
    READ,
    async (args) =>
      listTool(
        m3,
        "receivedSlips",
        `id year isDeleted documentNumber dateOfIssue totalWithVatHc description
         partnerAddress { businessAddress { name } identificationNumber }
         centre { shortCut name } jobOrder { shortCut name } operation { shortCut name }`,
        "Stock Documents",
        args,
        (d) => {
          const partner = d.partnerAddress as Record<string, unknown> | undefined;
          const biz = partner?.businessAddress as Record<string, unknown> | undefined;
          const lines = [
            `## ${str(d.documentNumber)} (${str(d.dateOfIssue)}; id ${str(d.id)}, year ${str(d.year)})`,
            `- Partner: ${str(biz?.name)} (ICO: ${str(partner?.identificationNumber)})`,
            `- Total: ${str(d.totalWithVatHc, "?")}`,
          ];
          const ctrl = controllingText(d);
          if (ctrl) lines.push(ctrl);
          if (d.description) lines.push(`- Description: ${d.description}`);
          return lines.join("\n");
        },
      ),
  );

  server.tool(
    "m3_create_stock_card",
    "Create a stock card (article). Written to the Money S3 import queue; check the result with m3_import_status.",
    {
      catalogue: z.string().min(1).describe("Catalogue number (katalog)"),
      description: z.string().min(1).describe("Article name (popis zásoby)"),
      barCode: z.string().optional().describe("Barcode (EAN)"),
      plu: z.string().optional().describe("PLU"),
      weight: z.number().optional().describe("Weight per unit"),
      definitionShortcut: definitionParam("_zSK"),
    },
    CREATE,
    // Field names from the article examples in mutation_priklady.pdf and query_priklady.pdf.
    async ({ definitionShortcut, ...article }) =>
      runMutation(m3, {
        mutation: "createArticle",
        arg: "article",
        label: `Stock card "${article.catalogue}"`,
        verifyWith: "m3_stock_cards",
        definitionShortcut,
        input: article,
      }),
  );

  server.tool(
    "m3_create_stock_document",
    "Create a received stock slip (příjemka) with stock items. Written to the Money S3 import queue; check the result with m3_import_status.",
    {
      dateOfIssue: dateParam("Issue date"),
      dateOfStockMovement: dateParam("Stock movement date").optional(),
      documentNumber: z.string().optional(),
      variableSymbol: z.string().optional(),
      partner: partnerSchema.optional(),
      ...controllingParams,
      items: z
        .array(
          z.object({
            catalogue: z.string().min(1).describe("Article catalogue number"),
            warehouseCode: z.string().min(1).describe("Warehouse code (see m3_stock_lists)"),
            quantity: z.number().min(0).describe("Quantity"),
            unitPrice: z.number().describe("Unit price"),
          }),
        )
        .min(1),
      // Default from the official stock slip example (mutation_priklady.pdf).
      definitionShortcut: definitionParam("_S"),
    },
    CREATE,
    async (p) =>
      runMutation(m3, {
        mutation: "createReceivedSlip",
        arg: "receivedSlip",
        label: "Stock document",
        verifyWith: "m3_stock_documents",
        definitionShortcut: p.definitionShortcut,
        input: {
          dateOfIssue: isoDate(p.dateOfIssue),
          dateOfStockMovement: isoDate(p.dateOfStockMovement),
          documentNumber: p.documentNumber,
          variableSymbol: p.variableSymbol,
          partnerAddress: partnerInput(p.partner),
          ...controllingInput(p),
          // The official example sends the quantity as unitOfMeasure ("počet kusů").
          items: p.items.map((it) => ({
            article: { catalogue: it.catalogue },
            warehouse: { code: it.warehouseCode },
            unitOfMeasure: it.quantity,
            unitPrice: it.unitPrice,
          })),
        },
      }),
  );

  server.tool(
    "m3_create_inventory_document",
    "Create a stocktaking document (inventurní doklad) with counted amounts. Written to the Money S3 import queue; check the result with m3_import_status.",
    {
      description: z.string().optional(),
      note: z.string().optional(),
      stockTakingId: z.number().int().positive().optional().describe("ID of the stocktaking (inventura) to attach to"),
      checkedByEmployee: z.string().optional(),
      items: z
        .array(
          z.object({
            catalogue: z.string().min(1).describe("Article catalogue number"),
            warehouseCode: z.string().min(1).describe("Warehouse code (see m3_stock_lists)"),
            inventoryAmount: z.number().min(0).describe("Counted quantity"),
          }),
        )
        .min(1),
      // Default from the official stocktaking example (mutation_priklady.pdf).
      definitionShortcut: definitionParam("_INVD"),
    },
    CREATE,
    async (p) =>
      runMutation(m3, {
        mutation: "createStockTakingDocument",
        arg: "stockTakingDocument",
        label: "Stocktaking document",
        verifyWith: "m3_inventory_documents",
        definitionShortcut: p.definitionShortcut,
        input: {
          description: p.description,
          note: p.note,
          stockTakingId: p.stockTakingId,
          checkedByEmployee: p.checkedByEmployee,
          items: p.items.map((it) => ({
            article: { catalogue: it.catalogue },
            inventoryAmount: it.inventoryAmount,
            warehouse: { code: it.warehouseCode },
          })),
        },
      }),
  );
}
