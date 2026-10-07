import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { CREATE, DELETE, READ, addressInput, definitionParam, listParams, listTool, runMutation } from "./helpers.js";

const ADDRESS_FIELDS = `
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
    "Query the address book (contacts/partners) with addresses, bank accounts, credit limits, discount and maturity terms. Read-only.",
    listParams(),
    READ,
    async (args) => listTool(m3, "companies", ADDRESS_FIELDS, "Address Book", args, formatContact),
  );

  server.tool(
    "m3_create_address",
    "Create an address book entry with business address, banking, credit limit and maturity terms. Written to the Money S3 import queue; check the result with m3_import_status.",
    {
      name: z.string().min(1).describe("Company or person name"),
      street: z.string().optional(),
      city: z.string().optional(),
      zip: z.string().optional().describe("Postal code"),
      country: z.string().optional().describe("Country name"),
      countryCode: z.string().regex(/^[A-Z]{2}$/, "Two-letter ISO code").optional().describe("ISO country code (CZ, SK, ...)"),
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
      discount: z.number().min(0).max(100).optional().describe("Default discount percentage"),
      creditLimit: z.number().optional().describe("Credit limit amount"),
      maturityDaysReceivable: z.number().int().optional().describe("Default maturity in days for receivables"),
      maturityDaysPayable: z.number().int().optional().describe("Default maturity in days for payables"),
      definitionShortcut: definitionParam("_AD"),
    },
    CREATE,
    async (p) =>
      runMutation(m3, {
        mutation: "createCompany",
        arg: "company",
        label: `Contact "${p.name}"`,
        verifyWith: "m3_address_book",
        definitionShortcut: p.definitionShortcut,
        input: {
          // Address shape from the official examples (mutation_priklady.pdf).
          businessAddress: addressInput({ ...p, postalCode: p.zip, countryName: p.country }),
          identificationNumber: p.identificationNumber,
          vatIdentificationNumber: p.vatNumber,
          isVatPayer: p.isVatPayer,
          isPerson: p.isPhysicalPerson,
          email: p.email,
          phoneNumber: p.phone,
          mobileNumber: p.mobile,
          www: p.web,
          accountNumber: p.bankAccountNumber,
          bankCode: p.bankCode,
          discount: p.discount,
          isDiscount: p.discount != null ? true : undefined,
          creditValue: p.creditLimit,
          isCredit: p.creditLimit != null ? true : undefined,
          maturityReceivablesDays: p.maturityDaysReceivable,
          isMaturityReceivables: p.maturityDaysReceivable != null ? true : undefined,
          maturityLiabilitiesDays: p.maturityDaysPayable,
          isMaturityLiabilities: p.maturityDaysPayable != null ? true : undefined,
        },
      }),
  );

  server.tool(
    "m3_delete_address",
    "Delete an address book entry by ID.",
    { id: z.number().int().positive().describe("Address record ID") },
    DELETE,
    async ({ id }) =>
      runMutation(m3, {
        mutation: "deleteCompany",
        arg: "company",
        label: `Delete address #${id}`,
        verifyWith: "m3_address_book",
        input: { id },
      }),
  );
}
