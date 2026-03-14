import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

function required(name: string): string {
  const val = process.env[name];
  if (!val) {
    process.stderr.write(`Missing required env var: ${name}\n`);
    process.exit(1);
  }
  return val;
}

function optInt(name: string, fallback: number): number {
  const val = process.env[name];
  if (!val) return fallback;
  const n = parseInt(val, 10);
  return Number.isNaN(n) ? fallback : n;
}

const client = new MoneyS3Client({
  domain: required("MONEYS3_DOMAIN"),
  appId: required("MONEYS3_APP_ID"),
  clientId: required("MONEYS3_CLIENT_ID"),
  clientSecret: required("MONEYS3_CLIENT_SECRET"),
  agendaGuid: process.env["MONEYS3_AGENDA_GUID"] || undefined,
  cacheTtl: optInt("MONEYS3_CACHE_TTL", 120),
  maxRetries: optInt("MONEYS3_MAX_RETRIES", 3),
});

const server = new McpServer({ name: "moneys3", version: "1.0.0" });

registerAgendaTools(server, client);
registerInvoiceTools(server, client);
registerContactTools(server, client);
registerStockTools(server, client);
registerBankingTools(server, client);
registerDocumentTools(server, client);
registerAccountingTools(server, client);
registerPayrollTools(server, client);
registerControllingTools(server, client);
registerGraphQLTools(server, client);

await server.connect(new StdioServerTransport());
