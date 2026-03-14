import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { escGql, buildArgs, textResult, errorResult } from "./helpers.js";

const ADDRESS_FIELDS = `
  items {
    id shortcut
    businessAddress { name street city zip country countryCode }
    invoiceAddress { name street city zip country }
    company { identificationNumber vatNumber taxNumber }
    contact { phone mobile fax email web }
    bankAccounts { bankCode accountNumber iban swift currency { code } }
    group { name code }
    discount defaultMaturityDaysReceivable defaultMaturityDaysPayable
    creditLimit creditLimitCurrency { code }
    isVatPayer isPhysicalPerson
    note
  }
  totalCount
`;

function formatContact(c: Record<string, unknown>): string {
  const biz = c.businessAddress as Record<string, unknown> | undefined;
  const inv = c.invoiceAddress as Record<string, unknown> | undefined;
  const co = c.company as Record<string, unknown> | undefined;
  const ct = c.contact as Record<string, unknown> | undefined;
  const banks = c.bankAccounts as Array<Record<string, unknown>> | undefined;
  const grp = c.group as Record<string, unknown> | undefined;

  const lines = [
    `## ${biz?.name ?? "Unnamed"} (#${c.id ?? "?"})${c.shortcut ? ` [${c.shortcut}]` : ""}`,
    `- Address: ${[biz?.street, biz?.city, biz?.zip, biz?.country].filter(Boolean).join(", ") || "—"}`,
    `- ICO: ${co?.identificationNumber ?? "—"} | VAT: ${co?.vatNumber ?? "—"} | Tax: ${co?.taxNumber ?? "—"}`,
    `- VAT payer: ${c.isVatPayer ? "Yes" : "No"} | Physical person: ${c.isPhysicalPerson ? "Yes" : "No"}`,
  ];

  if (inv?.name && inv.name !== biz?.name) {
    lines.push(`- Invoice address: ${[inv.name, inv.street, inv.city, inv.zip].filter(Boolean).join(", ")}`);
  }

  if (ct) {
    const parts = [ct.email, ct.phone, ct.mobile, ct.web].filter(Boolean);
    if (parts.length > 0) lines.push(`- Contact: ${parts.join(" | ")}`);
  }

  if (banks && banks.length > 0) {
    for (const b of banks) {
      const cur = b.currency as Record<string, unknown> | undefined;
      lines.push(`- Bank: ${b.accountNumber ?? ""}/${b.bankCode ?? ""} (IBAN: ${b.iban ?? "—"}, ${cur?.code ?? "CZK"})`);
    }
  }

  if (grp?.name) lines.push(`- Group: ${grp.name} (${grp.code ?? "—"})`);
  if (c.discount) lines.push(`- Discount: ${c.discount}%`);
  if (c.creditLimit) {
    const clCur = c.creditLimitCurrency as Record<string, unknown> | undefined;
    lines.push(`- Credit limit: ${c.creditLimit} ${clCur?.code ?? "CZK"}`);
  }

  const matParts = [];
  if (c.defaultMaturityDaysReceivable) matParts.push(`receivable: ${c.defaultMaturityDaysReceivable}d`);
  if (c.defaultMaturityDaysPayable) matParts.push(`payable: ${c.defaultMaturityDaysPayable}d`);
  if (matParts.length > 0) lines.push(`- Maturity: ${matParts.join(" | ")}`);

  if (c.note) lines.push(`- Note: ${c.note}`);
  return lines.join("\n");
}

export function registerContactTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_address_book",
    "Query the address book (contacts/partners) with full detail: addresses, bank accounts, credit limits, discount, maturity terms",
    {
      take: z.number().min(1).max(100).default(20).describe("Number of records"),
      skip: z.number().min(0).default(0).describe("Records to skip"),
      where: z.string().optional().describe("GraphQL where filter"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      try {
        const gql = `{ addressBook(${buildArgs(take, skip, where, order)}) { ${ADDRESS_FIELDS} } }`;
        const data = await m3.query<{ addressBook: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const ab = data.addressBook;
        if (!ab?.items?.length) return textResult("No contacts found.");
        const header = `# Address Book (${ab.items.length} of ${ab.totalCount})\n`;
        return textResult(header + ab.items.map(formatContact).join("\n\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_create_address",
    "Create a new entry in the address book with business/invoice addresses, banking, credit limits, and maturity terms. Async import queue.",
    {
      name: z.string().min(1).describe("Company or person name"),
      street: z.string().optional(),
      city: z.string().optional(),
      zip: z.string().optional(),
      country: z.string().optional(),
      countryCode: z.string().optional().describe("ISO country code (CZ, SK, etc.)"),
      identificationNumber: z.string().optional().describe("ICO / Company ID"),
      vatNumber: z.string().optional().describe("VAT number (DIC)"),
      isVatPayer: z.boolean().optional().describe("Whether partner is VAT payer"),
      isPhysicalPerson: z.boolean().optional().describe("Physical person (true) or legal entity (false)"),
      email: z.string().optional(),
      phone: z.string().optional(),
      mobile: z.string().optional(),
      web: z.string().optional(),
      bankAccountNumber: z.string().optional().describe("Bank account number"),
      bankCode: z.string().optional().describe("Bank code"),
      iban: z.string().optional(),
      discount: z.number().min(0).max(100).optional().describe("Default discount percentage"),
      creditLimit: z.number().optional().describe("Credit limit amount"),
      maturityDaysReceivable: z.number().int().optional().describe("Default maturity in days for receivables"),
      maturityDaysPayable: z.number().int().optional().describe("Default maturity in days for payables"),
      groupCode: z.string().optional().describe("Partner group code"),
      definitionShortcut: z.string().default("_AD").describe("XML transfer definition shortcut"),
    },
    async (params) => {
      try {
        const addr = [
          `name: "${escGql(params.name)}"`,
          params.street ? `street: "${escGql(params.street)}"` : "",
          params.city ? `city: "${escGql(params.city)}"` : "",
          params.zip ? `zip: "${escGql(params.zip)}"` : "",
          params.country ? `country: "${escGql(params.country)}"` : "",
          params.countryCode ? `countryCode: "${escGql(params.countryCode)}"` : "",
        ].filter(Boolean).join(", ");

        const co = [
          params.identificationNumber ? `identificationNumber: "${escGql(params.identificationNumber)}"` : "",
          params.vatNumber ? `vatNumber: "${escGql(params.vatNumber)}"` : "",
        ].filter(Boolean).join(", ");

        const ct = [
          params.email ? `email: "${escGql(params.email)}"` : "",
          params.phone ? `phone: "${escGql(params.phone)}"` : "",
          params.mobile ? `mobile: "${escGql(params.mobile)}"` : "",
          params.web ? `web: "${escGql(params.web)}"` : "",
        ].filter(Boolean).join(", ");

        const bankParts = [
          params.bankAccountNumber ? `accountNumber: "${escGql(params.bankAccountNumber)}"` : "",
          params.bankCode ? `bankCode: "${escGql(params.bankCode)}"` : "",
          params.iban ? `iban: "${escGql(params.iban)}"` : "",
        ].filter(Boolean);

        const extras = [
          params.isVatPayer != null ? `isVatPayer: ${params.isVatPayer}` : "",
          params.isPhysicalPerson != null ? `isPhysicalPerson: ${params.isPhysicalPerson}` : "",
          params.discount != null ? `discount: ${params.discount}` : "",
          params.creditLimit != null ? `creditLimit: ${params.creditLimit}` : "",
          params.maturityDaysReceivable != null ? `defaultMaturityDaysReceivable: ${params.maturityDaysReceivable}` : "",
          params.maturityDaysPayable != null ? `defaultMaturityDaysPayable: ${params.maturityDaysPayable}` : "",
          params.groupCode ? `group: { code: "${escGql(params.groupCode)}" }` : "",
          bankParts.length > 0 ? `bankAccounts: [{ ${bankParts.join(", ")} }]` : "",
        ].filter(Boolean).join("\n      ");

        const gql = `mutation {
  createAddress(
    address: {
      businessAddress: { ${addr} }
      ${co ? `company: { ${co} }` : ""}
      ${ct ? `contact: { ${ct} }` : ""}
      ${extras}
    }
    definitionXMLTransfer: { shortCut: "${escGql(params.definitionShortcut)}" }
  ) { guid isSuccess }
}`;

        const data = await m3.query<{ createAddress: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.createAddress;
        return textResult(`Contact "${params.name}" ${result.isSuccess ? "created" : "queued"}.\nGUID: \`${result.guid}\``);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_delete_address",
    "Delete an address book entry by ID",
    {
      id: z.number().int().positive().describe("Address record ID"),
    },
    async ({ id }) => {
      try {
        const gql = `mutation { deleteAddress(address: { id: ${id} }) { guid isSuccess } }`;
        const data = await m3.query<{ deleteAddress: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.deleteAddress;
        return textResult(`Address #${id} ${result.isSuccess ? "deleted" : "deletion queued"}.\nGUID: \`${result.guid}\``);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
}
