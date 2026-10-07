import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { DELETE, runMutation } from "./helpers.js";

// [tool, label, mutation, argument, read tool to verify with, needs year]
const DELETES: Array<[string, string, string, string, string, boolean]> = [
  ["m3_delete_internal_document", "internal document", "deleteInternalDocument", "internalDocument", "m3_internal_documents", true],
  ["m3_delete_liability", "liability", "deleteLiability", "liability", "m3_liabilities", true],
  ["m3_delete_receivable", "receivable", "deleteReceivable", "receivable", "m3_receivables", true],
  ["m3_delete_bank_document", "bank document", "deleteBankStatement", "bankStatement", "m3_bank_documents", true],
  ["m3_delete_cash_desk_document", "cash desk document", "deleteCashVoucher", "cashVoucher", "m3_cash_desk_documents", true],
  ["m3_delete_stock_card", "stock card", "deleteArticle", "article", "m3_stock_cards", false],
  ["m3_delete_stock_document", "received stock slip", "deleteReceivedSlip", "receivedSlip", "m3_stock_documents", true],
  ["m3_delete_inventory_document", "stocktaking document", "deleteStockTakingDocument", "stockTakingDocument", "m3_inventory_documents", false],
];

export function registerDeleteTools(server: McpServer, m3: MoneyS3Client) {
  for (const [name, label, mutation, arg, verifyWith, withYear] of DELETES) {
    const id = z.number().int().positive().describe(`ID of the ${label} (see ${verifyWith})`);
    const year = z.number().int().min(2000).max(2100).describe("Accounting year");
    server.tool(
      name,
      `Delete ${/^[aeiou]/.test(label) ? "an" : "a"} ${label} by ID${withYear ? " and year" : ""}. Fails if the record has dependent records.`,
      withYear ? { id, year } : { id },
      DELETE,
      async (args) => {
        const p = args as { id: number; year?: number };
        return runMutation(m3, {
          mutation,
          arg,
          label: `Delete ${label} #${p.id}${p.year ? ` (${p.year})` : ""}`,
          verifyWith,
          input: { id: p.id, year: p.year },
        });
      },
    );
  }
}
