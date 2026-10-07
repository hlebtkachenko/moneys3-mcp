import { readFileSync } from "fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MoneyS3Client } from "./moneys3-client.js";
import { createServer } from "./server.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));

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

if (!client.getAgendaGuid()) {
  process.stderr.write("[moneys3] No MONEYS3_AGENDA_GUID set; select an agenda with m3_set_agenda\n");
}

await createServer(client, pkg.version).connect(new StdioServerTransport());
