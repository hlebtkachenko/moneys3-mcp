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
  updateTool,
  type GqlInput,
} from "./helpers.js";

const ARTICLE_FIELDS = "id guid catalogue description barCode plu weight articleItemType";

const articleFields = {
  description: z.string().min(1).describe("Article name (popis zásoby)"),
  barCode: z.string().optional().describe("Barcode (EAN)"),
  plu: z.string().optional().describe("PLU"),
  weight: z.number().optional().describe("Weight per unit"),
};

// Received slip header, shared by create and update.
const slipFields = {
  dateOfIssue: dateParam("Issue date"),
  dateOfStockMovement: dateParam("Stock movement date").optional(),
  variableSymbol: z.string().optional(),
  partner: partnerSchema.optional(),
  ...controllingParams,
};

type Slip = {
  dateOfIssue: string;
  dateOfStockMovement?: string;
  documentNumber?: string;
  variableSymbol?: string;
  partner?: z.infer<typeof partnerSchema>;
  costCenterCode?: string;
  projectCode?: string;
  activityCode?: string;
};

const slipInput = (p: Slip) => ({
  dateOfIssue: isoDate(p.dateOfIssue),
  dateOfStockMovement: isoDate(p.dateOfStockMovement),
  documentNumber: p.documentNumber,
  variableSymbol: p.variableSymbol,
  partnerAddress: partnerInput(p.partner),
  ...controllingInput(p),
});

// StockTakingDocumentInput requires both IDs (docs/schema.graphql), although
// the official example in mutation_priklady.pdf leaves them out.
const stockTakingKey = {
  stockTakingId: z.number().int().positive().describe("ID of the stocktaking (inventura), see m3_stock_takings"),
  stockTakingDocumentId: z.number().int().positive().describe("Number of this document within the stocktaking (key)"),
};

const stockItemRef = {
  catalogue: z.string().min(1).describe("Article catalogue number"),
  warehouseCode: z.string().min(1).describe("Warehouse code (see m3_stock_lists)"),
};

const stockTakingFields = {
  description: z.string().optional(),
  note: z.string().optional(),
  checkedByEmployee: z.string().optional(),
  items: z.array(
    z.object({
      ...stockItemRef,
      inventoryAmount: z.number().min(0).describe("Counted quantity"),
    }),
  ),
};

type StockTaking = {
  stockTakingId: number;
  stockTakingDocumentId: number;
  description?: string;
  note?: string;
  checkedByEmployee?: string;
  items?: Array<{ catalogue: string; warehouseCode: string; inventoryAmount: number }>;
};

const stockTakingInput = (p: StockTaking) => ({
  stockTakingId: p.stockTakingId,
  stockTakingDocumentId: p.stockTakingDocumentId,
  description: p.description,
  note: p.note,
  checkedByEmployee: p.checkedByEmployee,
  items: p.items?.map((it) => ({ article: { catalogue: it.catalogue }, inventoryAmount: it.inventoryAmount, warehouse: { code: it.warehouseCode } })),
});

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
          m3.query<{ priceLevels: { items: Record<string, unknown>[] } }>(`{ priceLevels(take: 100) { items { shortCut name } totalCount } }`),
        ]);
        const lines = ["# Stock Lists", "", "## Warehouses"];
        for (const w of wh.warehouses?.items ?? []) lines.push(`- ${str(w.name)} (code: ${str(w.code)}, id: ${str(w.id, "?")})`);
        lines.push("", "## Price Levels");
        for (const p of pl.priceLevels?.items ?? []) lines.push(`- ${str(p.name)} (shortCut: ${str(p.shortCut)})`);
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
        `id year documentNumber dateOfIssue totalWithVatHc description
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
    { catalogue: z.string().min(1).describe("Catalogue number (katalog)"), ...articleFields, definitionShortcut: definitionParam("_zSK") },
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

  // Stock cards are matched on catalogue, barcode, GUID or PLU, as set in the definition.
  updateTool(server, m3, {
    name: "m3_update_stock_card",
    what: "a stock card (article)",
    match: {
      catalogue: z.string().min(1).describe("Catalogue number of the card to update (key)"),
      guid: z.guid().optional().describe("Article GUID (key, when the definition matches on GUID)"),
    },
    fields: { ...articleFields, description: z.string().min(1).describe("Article name (popis zásoby)") },
    definition: "_KK",
    lookup: {
      root: "articles",
      where: (p) => ({ catalogue: { eq: p.catalogue as string }, guid: p.guid ? { eq: p.guid as string } : undefined }),
      unique: true,
    },
    mutation: "updateArticle",
    arg: "article",
    verifyWith: "m3_stock_cards",
    label: (p) => `Update stock card "${p.catalogue}"`,
    input: (p) => ({ catalogue: p.catalogue, guid: p.guid, description: p.description, barCode: p.barCode, plu: p.plu, weight: p.weight }) as GqlInput,
  });

  server.tool(
    "m3_create_stock_document",
    "Create a received stock slip (příjemka) with stock items. Written to the Money S3 import queue; check the result with m3_import_status.",
    {
      ...slipFields,
      documentNumber: z.string().optional(),
      items: z
        .array(
          z.object({
            ...stockItemRef,
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
          ...slipInput(p),
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

  updateTool(server, m3, {
    name: "m3_update_stock_document",
    what: "a received stock slip's description, title, note and texts (Money S3 updates only these header fields on stock documents)",
    match: { documentNumber: z.string().min(1).describe("Document number of the stock slip to update (key)") },
    fields: {
      description: z.string().describe("Description (popis dokladu)"),
      documentTitle: z.string().describe("Document title (nadpis dokladu)"),
      note: z.string().describe("Note"),
      textBeforePrices: z.string().describe("Text before prices"),
      textBehindPrices: z.string().describe("Text after prices"),
    },
    definition: "_S",
    lookup: { root: "receivedSlips", where: (p) => ({ documentNumber: { eq: p.documentNumber as string } }), unique: true },
    mutation: "updateReceivedSlip",
    arg: "receivedSlip",
    verifyWith: "m3_stock_documents",
    label: (p) => `Update stock document "${p.documentNumber}"`,
    // UpdateInStoreDocument requires items; stock documents ignore item changes on update
    // ("Opravy – na skladových dokladech vždy dojde k aktualizaci pouze vybraných údajů na hlavičce", xml_prenosy.pdf).
    input: (p) => {
      const { definitionShortcut: _, ...fields } = p;
      return { ...(fields as Record<string, GqlInput>), items: [] };
    },
  });

  server.tool(
    "m3_create_inventory_document",
    "Create a stocktaking document (inventurní doklad) with counted amounts. Written to the Money S3 import queue; check the result with m3_import_status.",
    {
      ...stockTakingKey,
      ...stockTakingFields,
      items: stockTakingFields.items.min(1),
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
        input: stockTakingInput(p),
      }),
  );

  updateTool(server, m3, {
    name: "m3_update_inventory_document",
    what: "a stocktaking document; items given are sent as counted amounts",
    match: stockTakingKey,
    fields: stockTakingFields,
    definition: "_INVD",
    lookup: {
      root: "stockTakingDocuments",
      where: (p) => ({ stockTakingId: { eq: p.stockTakingId as number }, stockTakingDocumentId: { eq: p.stockTakingDocumentId as number } }),
      unique: true,
    },
    mutation: "updateStockTakingDocument",
    arg: "stockTakingDocument",
    verifyWith: "m3_inventory_documents",
    label: (p) => `Update stocktaking document ${p.stockTakingDocumentId} of stocktaking ${p.stockTakingId}`,
    input: (p) => stockTakingInput(p as StockTaking),
  });

  server.tool(
    "m3_stock_takings",
    "Query stocktakings (inventury) with state, dates and type; their IDs are the stockTakingId of inventory documents. Read-only.",
    listParams(),
    READ,
    async (args) =>
      listTool(
        m3,
        "stockTakings",
        "id year stockTakingNumber description state dateOfStockTaking dateOfClosed note stockTakingType { shortCut name }",
        "Stocktakings",
        args,
        (t) =>
          [
            `## ${str(t.stockTakingNumber)} (id ${str(t.id)}, year ${str(t.year)})${t.description ? `: ${t.description}` : ""}`,
            `- State: ${str(t.state)} | Date: ${str(t.dateOfStockTaking)} | Closed: ${str(t.dateOfClosed)} | Type: ${str((t.stockTakingType as Record<string, unknown> | undefined)?.name)}`,
            ...(t.note ? [`- Note: ${t.note}`] : []),
          ].join("\n"),
      ),
  );
}
