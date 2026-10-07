// Fake Money S3 transport for tests and the contract check: replaces global
// fetch, answers the OAuth token and GraphQL endpoints with synthetic data and
// records every GraphQL request. Tools are the real handlers from dist/,
// connected to an MCP client in memory.
import fs from "node:fs";
import { parse } from "graphql";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const AGENDA = "00000000-0000-4000-8000-0000000000aa";

/** Default answer: every root field gets an empty page or a successful mutation result. */
export function defaultData(query) {
  const op = parse(query).definitions[0];
  const data = {};
  for (const root of op.selectionSet.selections) {
    const name = root.name.value;
    if (op.operation === "mutation") data[name] = { guid: "00000000-0000-4000-8000-0000000000bb", isSuccess: true };
    else if (name === "importStatus") data[name] = { guid: "00000000-0000-4000-8000-0000000000bb", state: "IMPORTED", stateInfo: "Synthetic" };
    else if (name === "agendas") data[name] = { items: [{ guid: AGENDA, name: "Synthetic agenda" }] };
    else data[name] = { items: [], totalCount: 0 };
  }
  return data;
}

export async function startFake({ dist = new URL("../dist/", import.meta.url), clientConfig = {} } = {}) {
  const requests = [];
  const fake = { requests, respond: (query) => Response.json({ data: defaultData(query) }) };
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/connect/token")) return Response.json({ access_token: "synthetic", token_type: "Bearer", expires_in: 3600 });
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), method: init.method, headers: init.headers, bodyKeys: Object.keys(body), query: body.query });
    return fake.respond(body.query);
  };

  const { MoneyS3Client } = await import(new URL("moneys3-client.js", dist));
  const m3 = new MoneyS3Client({
    domain: "example",
    appId: "app",
    clientId: "client",
    clientSecret: "secret",
    agendaGuid: AGENDA,
    maxRetries: 1,
    ...clientConfig,
  });
  // Register every tool module the build exposes (works for any version of dist/).
  const server = new McpServer({ name: "moneys3-test", version: "0" });
  const toolsDir = new URL("tools/", dist);
  for (const file of fs.readdirSync(toolsDir).filter((f) => f.endsWith(".js"))) {
    const mod = await import(new URL(file, toolsDir));
    for (const [name, fn] of Object.entries(mod)) if (name.startsWith("register")) fn(server, m3);
  }
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);

  fake.client = client;
  fake.m3 = m3;
  fake.call = (name, args = {}) => client.callTool({ name, arguments: args });
  fake.close = () => client.close();
  return fake;
}
