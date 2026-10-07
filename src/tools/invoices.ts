import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import {
  CREATE,
  DELETE,
  READ,
  controllingInput,
  controllingParams,
  controllingText,
  dateParam,
  definitionParam,
  gqlEnum,
  isoDate,
  listParams,
  listTool,
  partnerInput,
  partnerSchema,
  runMutation,
  str,
  vatText,
} from "./helpers.js";

const INVOICE_FIELDS = `
  id year isDeleted documentNumber dateOfIssue dateOfTaxing dateOfMaturity dateOfPayment
  variableSymbol specificSymbol pairingSymbol
  isCreditNote isBilled
  totalWithVatHc amountToPayHc remainingAmountToPayHc
  description
  currency { code }
  vatRateSummaryHc { vatRate totalWithoutVat totalVat }
  partnerAddress {
    businessAddress { name street municipality postalCode country }
    identificationNumber vatIdentificationNumber
  }
  items { description amount unitPriceHc vatRate discountPercentage plu }
  centre { shortCut name }
  jobOrder { shortCut name }
  operation { shortCut name }
  accountAssignment { accountAssignmentAcc { shortCut } }
  constantSymbol { code }
`;

function formatInvoice(inv: Record<string, unknown>): string {
  const partner = inv.partnerAddress as Record<string, unknown> | undefined;
  const biz = partner?.businessAddress as Record<string, unknown> | undefined;
  const items = inv.items as Array<Record<string, unknown>> | undefined;
  const cur = inv.currency as Record<string, unknown> | undefined;
  const aa = (inv.accountAssignment as Record<string, unknown> | undefined)?.accountAssignmentAcc as Record<string, unknown> | undefined;
  const ks = inv.constantSymbol as Record<string, unknown> | undefined;

  const lines = [
    `## ${str(inv.documentNumber)}${inv.isCreditNote ? " [CREDIT NOTE]" : ""} (id ${str(inv.id)}, year ${str(inv.year)})`,
    `- Date: ${str(inv.dateOfIssue)} | Taxing: ${str(inv.dateOfTaxing)} | Maturity: ${str(inv.dateOfMaturity)}`,
    `- Partner: ${str(biz?.name)} (ICO: ${str(partner?.identificationNumber)}, VAT: ${str(partner?.vatIdentificationNumber)})`,
    `- Address: ${[biz?.street, biz?.municipality, biz?.postalCode, biz?.country].filter(Boolean).join(", ") || "—"}`,
    `- VS: ${str(inv.variableSymbol)} | KS: ${str(ks?.code)} | SS: ${str(inv.specificSymbol)}`,
    `- Total: ${str(inv.totalWithVatHc, "?")} ${str(cur?.code, "CZK")}`,
    `- Paid: ${inv.isBilled ? `Yes (${str(inv.dateOfPayment)})` : `No — remaining: ${str(inv.remainingAmountToPayHc, "?")}`}`,
  ];
  for (const line of [vatText(inv), controllingText(inv)]) if (line) lines.push(line);
  if (aa?.shortCut) lines.push(`- Account assignment: ${aa.shortCut}`);
  if (items?.length) {
    lines.push("- Items:");
    for (const it of items) {
      const disc = it.discountPercentage ? ` (-${it.discountPercentage}%)` : "";
      lines.push(`  - ${str(it.description)}: ${it.amount ?? 0} × ${it.unitPriceHc ?? 0} (VAT ${str(it.vatRate)}%)${disc}`);
    }
  }
  if (inv.description) lines.push(`- Description: ${inv.description}`);
  return lines.join("\n");
}

// Item shape from the official non-stock item example (mutation_priklady.pdf):
// description, amount, unitPriceHc, numeric vatRate, priceType WITHOUT_VAT.
const itemSchema = z.object({
  description: z.string(),
  amount: z.number().min(0),
  unitPriceHc: z.number().describe("Unit price without VAT in home currency"),
  vatRate: z.number().min(0).max(100).default(0).describe("VAT rate in percent, e.g. 21"),
});

const createParams = {
  dateOfIssue: dateParam("Issue date"),
  dateOfTaxing: dateParam("VAT date (DUZP)"),
  dateOfMaturity: dateParam("Maturity date"),
  dateOfAccountingEvent: dateParam("Accounting event date").optional(),
  documentNumber: z.string().optional().describe("Document number (numbered by the series if omitted)"),
  numericalSeriePrefix: z.string().optional().describe("Numerical series prefix"),
  variableSymbol: z.string().optional(),
  description: z.string().optional(),
  partner: partnerSchema.optional(),
  ...controllingParams,
  items: z.array(itemSchema).min(1).describe("Invoice line items (non-stock)"),
};

type CreateParams = {
  dateOfIssue: string;
  dateOfTaxing: string;
  dateOfMaturity: string;
  dateOfAccountingEvent?: string;
  documentNumber?: string;
  numericalSeriePrefix?: string;
  variableSymbol?: string;
  description?: string;
  partner?: z.infer<typeof partnerSchema>;
  costCenterCode?: string;
  projectCode?: string;
  activityCode?: string;
  items: z.infer<typeof itemSchema>[];
};

function invoiceInput(p: CreateParams) {
  return {
    dateOfIssue: isoDate(p.dateOfIssue),
    dateOfTaxing: isoDate(p.dateOfTaxing),
    dateOfMaturity: isoDate(p.dateOfMaturity),
    dateOfAccountingEvent: isoDate(p.dateOfAccountingEvent),
    documentNumber: p.documentNumber,
    numericalSerie: p.numericalSeriePrefix ? { prefix: p.numericalSeriePrefix } : undefined,
    variableSymbol: p.variableSymbol,
    description: p.description,
    partnerAddress: partnerInput(p.partner),
    ...controllingInput(p),
    items: p.items.map((it) => ({ ...it, priceType: gqlEnum("WITHOUT_VAT") })),
  };
}

export function registerInvoiceTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_issued_invoices",
    "Query issued (outgoing) invoices with VAT summary, payment status and controlling variables. Read-only.",
    listParams(),
    READ,
    async (args) => listTool(m3, "issuedInvoices", INVOICE_FIELDS, "Issued Invoices", args, formatInvoice),
  );

  server.tool(
    "m3_received_invoices",
    "Query received (incoming) invoices with VAT summary, payment status and controlling variables. Read-only.",
    listParams(),
    READ,
    async (args) => listTool(m3, "receivedInvoices", INVOICE_FIELDS, "Received Invoices", args, formatInvoice),
  );

  server.tool(
    "m3_create_issued_invoice",
    "Create an issued invoice with partner and line items. Written to the Money S3 import queue; check the result with m3_import_status.",
    {
      ...createParams,
      isCreditNote: z.boolean().optional().describe("Credit note (dobropis)"),
      definitionShortcut: definitionParam("_FP+FV"),
    },
    CREATE,
    async (p) =>
      runMutation(m3, {
        mutation: "createIssuedInvoice",
        arg: "issuedInvoice",
        label: "Issued invoice",
        verifyWith: "m3_issued_invoices",
        definitionShortcut: p.definitionShortcut,
        input: { ...invoiceInput(p), isCreditNote: p.isCreditNote },
      }),
  );

  server.tool(
    "m3_create_received_invoice",
    "Create a received invoice with partner (supplier) and line items. Written to the Money S3 import queue; check the result with m3_import_status.",
    // Default from the official received invoice example (mutation_priklady.pdf).
    { ...createParams, definitionShortcut: definitionParam("_FP+FV") },
    CREATE,
    async (p) =>
      runMutation(m3, {
        mutation: "createReceivedInvoice",
        arg: "receivedInvoice",
        label: "Received invoice",
        verifyWith: "m3_received_invoices",
        definitionShortcut: p.definitionShortcut,
        input: invoiceInput(p),
      }),
  );

  server.tool(
    "m3_delete_invoice",
    "Delete an invoice by ID and year. Fails if the invoice has dependent records (e.g. stock movements).",
    {
      type: z.enum(["issued", "received"]).describe("Invoice type"),
      id: z.number().int().positive().describe("Invoice record ID"),
      year: z.number().int().min(2000).max(2100).describe("Accounting year"),
    },
    DELETE,
    async ({ type, id, year }) =>
      runMutation(m3, {
        mutation: type === "issued" ? "deleteIssuedInvoice" : "deleteReceivedInvoice",
        arg: type === "issued" ? "issuedInvoice" : "receivedInvoice",
        label: `Delete ${type} invoice #${id} (${year})`,
        verifyWith: type === "issued" ? "m3_issued_invoices" : "m3_received_invoices",
        input: { id, year },
      }),
  );
}
