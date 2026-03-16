import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { textResult, errorResult } from "./helpers.js";

export function registerDeleteTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_delete_internal_document",
    "Delete an internal document by ID and year.",
    {
      id: z.number().int().positive().describe("Internal document record ID"),
      year: z.number().int().min(2000).max(2100).describe("Accounting year"),
    },
    async ({ id, year }) => {
      try {
        const gql = `mutation { deleteInternalDocument(internalDocument: { id: ${id}, year: ${year} }) { guid isSuccess } }`;
        const data = await m3.query<{ deleteInternalDocument: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.deleteInternalDocument;
        return textResult(`Internal document #${id} (${year}) ${result.isSuccess ? "deleted" : "deletion queued"}.\nGUID: \`${result.guid}\``);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_delete_liability",
    "Delete a liability by ID and year.",
    {
      id: z.number().int().positive().describe("Liability record ID"),
      year: z.number().int().min(2000).max(2100).describe("Accounting year"),
    },
    async ({ id, year }) => {
      try {
        const gql = `mutation { deleteLiability(liability: { id: ${id}, year: ${year} }) { guid isSuccess } }`;
        const data = await m3.query<{ deleteLiability: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.deleteLiability;
        return textResult(`Liability #${id} (${year}) ${result.isSuccess ? "deleted" : "deletion queued"}.\nGUID: \`${result.guid}\``);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_delete_receivable",
    "Delete a receivable by ID and year.",
    {
      id: z.number().int().positive().describe("Receivable record ID"),
      year: z.number().int().min(2000).max(2100).describe("Accounting year"),
    },
    async ({ id, year }) => {
      try {
        const gql = `mutation { deleteReceivable(receivable: { id: ${id}, year: ${year} }) { guid isSuccess } }`;
        const data = await m3.query<{ deleteReceivable: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.deleteReceivable;
        return textResult(`Receivable #${id} (${year}) ${result.isSuccess ? "deleted" : "deletion queued"}.\nGUID: \`${result.guid}\``);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_delete_bank_document",
    "Delete a bank statement by ID and year.",
    {
      id: z.number().int().positive().describe("Bank statement record ID"),
      year: z.number().int().min(2000).max(2100).describe("Accounting year"),
    },
    async ({ id, year }) => {
      try {
        const gql = `mutation { deleteBankStatement(bankStatement: { id: ${id}, year: ${year} }) { guid isSuccess } }`;
        const data = await m3.query<{ deleteBankStatement: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.deleteBankStatement;
        return textResult(`Bank statement #${id} (${year}) ${result.isSuccess ? "deleted" : "deletion queued"}.\nGUID: \`${result.guid}\``);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_delete_cash_desk_document",
    "Delete a cash voucher by ID and year.",
    {
      id: z.number().int().positive().describe("Cash voucher record ID"),
      year: z.number().int().min(2000).max(2100).describe("Accounting year"),
    },
    async ({ id, year }) => {
      try {
        const gql = `mutation { deleteCashVoucher(cashVoucher: { id: ${id}, year: ${year} }) { guid isSuccess } }`;
        const data = await m3.query<{ deleteCashVoucher: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.deleteCashVoucher;
        return textResult(`Cash voucher #${id} (${year}) ${result.isSuccess ? "deleted" : "deletion queued"}.\nGUID: \`${result.guid}\``);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_delete_stock_card",
    "Delete a stock card (article) by ID.",
    {
      id: z.number().int().positive().describe("Stock card record ID"),
    },
    async ({ id }) => {
      try {
        const gql = `mutation { deleteArticle(article: { id: ${id} }) { guid isSuccess } }`;
        const data = await m3.query<{ deleteArticle: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.deleteArticle;
        return textResult(`Stock card #${id} ${result.isSuccess ? "deleted" : "deletion queued"}.\nGUID: \`${result.guid}\``);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_delete_stock_document",
    "Delete a stock document (received slip) by ID and year.",
    {
      id: z.number().int().positive().describe("Stock document record ID"),
      year: z.number().int().min(2000).max(2100).describe("Accounting year"),
    },
    async ({ id, year }) => {
      try {
        const gql = `mutation { deleteReceivedSlip(receivedSlip: { id: ${id}, year: ${year} }) { guid isSuccess } }`;
        const data = await m3.query<{ deleteReceivedSlip: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.deleteReceivedSlip;
        return textResult(`Stock document #${id} (${year}) ${result.isSuccess ? "deleted" : "deletion queued"}.\nGUID: \`${result.guid}\``);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_delete_inventory_document",
    "Delete a stocktaking document by ID.",
    {
      id: z.number().int().positive().describe("Inventory document record ID"),
    },
    async ({ id }) => {
      try {
        const gql = `mutation { deleteStockTakingDocument(stockTakingDocument: { id: ${id} }) { guid isSuccess } }`;
        const data = await m3.query<{ deleteStockTakingDocument: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.deleteStockTakingDocument;
        return textResult(`Inventory document #${id} ${result.isSuccess ? "deleted" : "deletion queued"}.\nGUID: \`${result.guid}\``);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
}
