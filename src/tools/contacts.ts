import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { escGql } from "./helpers.js";

const ADDRESS_FIELDS = `
  items {
    id
    businessAddress { name street city zip country }
    company { identificationNumber vatNumber taxNumber }
    contact { phone fax email web }
    bankAccounts { bankCode accountNumber iban swift }
    note
  }
  totalCount
`;

function formatContact(c: Record<string, unknown>): string {
  const biz = c.businessAddress as Record<string, unknown> | undefined;
  const co = c.company as Record<string, unknown> | undefined;
  const ct = c.contact as Record<string, unknown> | undefined;
  const banks = c.bankAccounts as Array<Record<string, unknown>> | undefined;

  const lines = [
    `## ${biz?.name ?? "Unnamed"} (#${c.id ?? "?"})`,
    `- Address: ${[biz?.street, biz?.city, biz?.zip, biz?.country].filter(Boolean).join(", ") || "—"}`,
    `- ICO: ${co?.identificationNumber ?? "—"} | VAT: ${co?.vatNumber ?? "—"} | Tax: ${co?.taxNumber ?? "—"}`,
  ];

  if (ct) {
    const contactParts = [ct.email, ct.phone, ct.web].filter(Boolean);
    if (contactParts.length > 0) lines.push(`- Contact: ${contactParts.join(" | ")}`);
  }

  if (banks && banks.length > 0) {
    for (const b of banks) {
      lines.push(`- Bank: ${b.accountNumber ?? ""}/${b.bankCode ?? ""} (IBAN: ${b.iban ?? "—"})`);
    }
  }

  if (c.note) lines.push(`- Note: ${c.note}`);
  return lines.join("\n");
}

export function registerContactTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_address_book",
    "Query the address book (contacts/partners) with optional filtering and pagination",
    {
      take: z.number().min(1).max(100).default(20).describe("Number of records"),
      skip: z.number().min(0).default(0).describe("Records to skip"),
      where: z.string().optional().describe("GraphQL where filter"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      const parts: string[] = [`take: ${take}`, `skip: ${skip}`];
      if (where) parts.push(`where: ${where}`);
      if (order) parts.push(`order: ${order}`);
      const gql = `{ addressBook(${parts.join(", ")}) { ${ADDRESS_FIELDS} } }`;
      const data = await m3.query<{ addressBook: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
      const ab = data.addressBook;

      if (!ab?.items?.length) {
        return { content: [{ type: "text", text: "No contacts found." }] };
      }

      const header = `# Address Book (${ab.items.length} of ${ab.totalCount})\n`;
      const body = ab.items.map(formatContact).join("\n\n");
      return { content: [{ type: "text", text: header + body }] };
    },
  );

  server.tool(
    "m3_create_address",
    "Create a new entry in the address book (contact/partner). Async import queue.",
    {
      name: z.string().min(1).describe("Company or person name"),
      street: z.string().optional(),
      city: z.string().optional(),
      zip: z.string().optional(),
      country: z.string().optional(),
      identificationNumber: z.string().optional().describe("ICO / Company ID"),
      vatNumber: z.string().optional().describe("VAT number (DIC)"),
      email: z.string().optional(),
      phone: z.string().optional(),
      web: z.string().optional(),
      definitionShortcut: z.string().default("_AD").describe("XML transfer definition shortcut"),
    },
    async (params) => {
      const addr = [
        params.name ? `name: "${escGql(params.name!)}"` : "",
        params.street ? `street: "${escGql(params.street!)}"` : "",
        params.city ? `city: "${escGql(params.city!)}"` : "",
        params.zip ? `zip: "${escGql(params.zip!)}"` : "",
        params.country ? `country: "${escGql(params.country!)}"` : "",
      ].filter(Boolean).join(", ");

      const co = [
        params.identificationNumber ? `identificationNumber: "${escGql(params.identificationNumber!)}"` : "",
        params.vatNumber ? `vatNumber: "${escGql(params.vatNumber!)}"` : "",
      ].filter(Boolean).join(", ");

      const ct = [
        params.email ? `email: "${escGql(params.email!)}"` : "",
        params.phone ? `phone: "${escGql(params.phone!)}"` : "",
        params.web ? `web: "${escGql(params.web!)}"` : "",
      ].filter(Boolean).join(", ");

      const gql = `mutation {
  createAddress(
    address: {
      businessAddress: { ${addr} }
      ${co ? `company: { ${co} }` : ""}
      ${ct ? `contact: { ${ct} }` : ""}
    }
    definitionXMLTransfer: { shortCut: "${escGql(params.definitionShortcut)}" }
  ) { guid isSuccess }
}`;

      const data = await m3.query<{ createAddress: { guid: string; isSuccess: boolean } }>(gql, true);
      const result = data.createAddress;
      return { content: [{ type: "text", text: `Contact "${params.name}" ${result.isSuccess ? "created" : "queued"}.\nGUID: \`${result.guid}\`` }] };
    },
  );

  server.tool(
    "m3_delete_address",
    "Delete an address book entry by ID",
    {
      id: z.number().int().positive().describe("Address record ID"),
    },
    async ({ id }) => {
      const gql = `mutation { deleteAddress(address: { id: ${id} }) { guid isSuccess } }`;
      const data = await m3.query<{ deleteAddress: { guid: string; isSuccess: boolean } }>(gql, true);
      const result = data.deleteAddress;
      return { content: [{ type: "text", text: `Address #${id} ${result.isSuccess ? "deleted" : "deletion queued"}.\nGUID: \`${result.guid}\`` }] };
    },
  );
}
