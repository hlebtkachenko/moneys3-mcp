import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MoneyS3Client } from "./moneys3-client.js";
import { registerAgendaTools } from "./tools/agendas.js";
import { registerInvoiceTools } from "./tools/invoices.js";
import { registerContactTools } from "./tools/contacts.js";
import { registerStockTools } from "./tools/stock.js";
import { registerBankingTools } from "./tools/banking.js";
import { registerDocumentTools } from "./tools/documents.js";
import { registerAccountingTools } from "./tools/accounting.js";
import { registerPayrollTools } from "./tools/payroll.js";
import { registerControllingTools } from "./tools/controlling.js";
import { registerGraphQLTools } from "./tools/graphql.js";
import { registerLookupTools } from "./tools/lookups.js";
import { registerAccountingMutationTools } from "./tools/mutations-accounting.js";
import { registerDeleteTools } from "./tools/mutations-delete.js";
import { registerWageTools } from "./tools/wages.js";

export function createServer(client: MoneyS3Client, version: string): McpServer {
  const server = new McpServer({ name: "moneys3", version });
  for (const register of [
    registerAgendaTools,
    registerInvoiceTools,
    registerContactTools,
    registerStockTools,
    registerBankingTools,
    registerDocumentTools,
    registerAccountingTools,
    registerPayrollTools,
    registerControllingTools,
    registerGraphQLTools,
    registerLookupTools,
    registerAccountingMutationTools,
    registerDeleteTools,
    registerWageTools,
  ]) {
    register(server, client);
  }
  return server;
}
