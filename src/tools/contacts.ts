import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { escGql, buildArgs, textResult, errorResult } from "./helpers.js";

const ADDRESS_FIELDS = `
  items {
    id guid code
    identificationNumber vatIdentificationNumber
    isPerson isVatPayer
    email phoneNumber mobileNumber www
    bankName accountNumber bankCode
    discount note message
    maturityReceivablesDays maturityLiabilitiesDays
    creditValue isCredit
    businessAddress { name street municipality countryName municipalityPostalCode { postalCode } }
    deliveryAddress { name street municipality countryName }
    addressGroup { name }
    bankAccounts { bankName accountNumber bankCode }
  }
  totalCount
`;

function formatContact(c: Record<string, unknown>): string {
  const biz = c.businessAddress as Record<string, unknown> | undefined;
  const bizPostal = biz?.municipalityPostalCode as Record<string, unknown> | undefined;
  const banks = c.bankAccounts as Array<Record<string, unknown>> | undefined;
  const grp = c.addressGroup as Record<string, unknown> | undefined;

  const lines = [
    `## ${biz?.name ?? "Unnamed"} (#${c.id ?? "?"})${c.code ? ` [${c.code}]` : ""}`,
    `- Address: ${[biz?.street, biz?.municipality, bizPostal?.postalCode, biz?.countryName].filter(Boolean).join(", ") || "—"}`,
    `- ICO: ${c.identificationNumber ?? "—"} | VAT: ${c.vatIdentificationNumber ?? "—"}`,
    `- VAT payer: ${c.isVatPayer ? "Yes" : "No"} | Person: ${c.isPerson ? "Yes" : "No"}`,
  ];

  const contactParts = [c.email, c.phoneNumber, c.mobileNumber, c.www].filter(Boolean);
  if (contactParts.length > 0) lines.push(`- Contact: ${contactParts.join(" | ")}`);

  if (c.accountNumber || c.bankCode) {
    lines.push(`- Bank: ${c.accountNumber ?? ""}/${c.bankCode ?? ""} (${c.bankName ?? "—"})`);
  }

  if (banks && banks.length > 0) {
    for (const b of banks) {
      lines.push(`- Bank account: ${b.accountNumber ?? ""}/${b.bankCode ?? ""} (${b.bankName ?? "—"})`);
    }
  }

  if (grp?.name) lines.push(`- Group: ${grp.name}`);
  if (c.discount) lines.push(`- Discount: ${c.discount}%`);
  if (c.isCredit) lines.push(`- Credit limit: ${c.creditValue ?? "—"}`);

  const matParts = [];
  if (c.maturityReceivablesDays) matParts.push(`receivable: ${c.maturityReceivablesDays}d`);
  if (c.maturityLiabilitiesDays) matParts.push(`payable: ${c.maturityLiabilitiesDays}d`);
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
        const gql = `{ companies(${buildArgs(take, skip, where, order)}) { ${ADDRESS_FIELDS} } }`;
        const data = await m3.query<{ companies: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const ab = data.companies;
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
          params.city ? `municipality: "${escGql(params.city)}"` : "",
          params.country ? `countryName: "${escGql(params.country)}"` : "",
        ].filter(Boolean).join(", ");

        const extras = [
          params.identificationNumber ? `identificationNumber: "${escGql(params.identificationNumber)}"` : "",
          params.vatNumber ? `vatIdentificationNumber: "${escGql(params.vatNumber)}"` : "",
          params.isVatPayer != null ? `isVatPayer: ${params.isVatPayer}` : "",
          params.isPhysicalPerson != null ? `isPerson: ${params.isPhysicalPerson}` : "",
          params.email ? `email: "${escGql(params.email)}"` : "",
          params.phone ? `phoneNumber: "${escGql(params.phone)}"` : "",
          params.mobile ? `mobileNumber: "${escGql(params.mobile)}"` : "",
          params.web ? `www: "${escGql(params.web)}"` : "",
          params.bankAccountNumber ? `accountNumber: "${escGql(params.bankAccountNumber)}"` : "",
          params.bankCode ? `bankCode: "${escGql(params.bankCode)}"` : "",
          params.discount != null ? `discount: ${params.discount}` : "",
          params.creditLimit != null ? `creditValue: ${params.creditLimit}` : "",
          params.creditLimit != null ? `isCredit: true` : "",
          params.maturityDaysReceivable != null ? `maturityReceivablesDays: ${params.maturityDaysReceivable}` : "",
          params.maturityDaysPayable != null ? `maturityLiabilitiesDays: ${params.maturityDaysPayable}` : "",
        ].filter(Boolean).join("\n      ");

        const gql = `mutation {
  createCompany(
    company: {
      businessAddress: { ${addr} }
      ${extras}
    }
    definitionXMLTransfer: { shortCut: "${escGql(params.definitionShortcut)}" }
  ) { guid isSuccess }
}`;

        const data = await m3.query<{ createCompany: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.createCompany;
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
        const gql = `mutation { deleteCompany(company: { id: ${id} }) { guid isSuccess } }`;
        const data = await m3.query<{ deleteCompany: { guid: string; isSuccess: boolean } }>(gql, true);
        const result = data.deleteCompany;
        return textResult(`Address #${id} ${result.isSuccess ? "deleted" : "deletion queued"}.\nGUID: \`${result.guid}\``);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
}
