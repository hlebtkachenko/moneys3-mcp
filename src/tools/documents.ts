import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import {
  CREATE,
  READ,
  controllingInput,
  controllingParams,
  controllingText,
  dateParam,
  definitionParam,
  isoDate,
  listParams,
  listTool,
  partnerInput,
  partnerSchema,
  runMutation,
  str,
  vatText,
} from "./helpers.js";

// Field sets follow the IInternalDocument / ILiability / IReceivable entries of
// docs/schema-summary.json. Sub-types (partnerAddress, normalItems) are not in
// the summary: their selections are kept minimal and are unverified.
const COMMON_FIELDS = `
  id year isDeleted documentNumber dateOfAccountingEvent dateOfTaxing
  description variableSymbol pairingSymbol note
  totalWithVatHc currency { code }
  vatRateSummaryHc { vatRate totalWithoutVat totalVat }
  partnerAddress { identificationNumber vatIdentificationNumber }
  centre { shortCut name } jobOrder { shortCut name } operation { shortCut name }
  accountAssignment { accountAssignmentAcc { shortCut } }
  normalItems { description }
`;

const INTERNAL_FIELDS = COMMON_FIELDS;

const RECEIVABLE_LIABILITY_FIELDS = `${COMMON_FIELDS}
  dateOfIssue dateOfMaturity dateOfPayment isCreditNote
  constantSymbol specificSymbol remainingAmountToPayHc
`;

function formatDoc(d: Record<string, unknown>): string {
  const partner = d.partnerAddress as Record<string, unknown> | undefined;
  const cur = d.currency as Record<string, unknown> | undefined;
  const aa = (d.accountAssignment as Record<string, unknown> | undefined)?.accountAssignmentAcc as Record<string, unknown> | undefined;
  const items = d.normalItems as Array<Record<string, unknown>> | undefined;

  const lines = [
    `## ${str(d.documentNumber)}${d.isCreditNote ? " [CREDIT NOTE]" : ""} (id ${str(d.id)}, year ${str(d.year)})`,
    `- Dates: issue ${str(d.dateOfIssue)} | accounting ${str(d.dateOfAccountingEvent)} | taxing ${str(d.dateOfTaxing)}${d.dateOfMaturity ? ` | maturity ${d.dateOfMaturity}` : ""}`,
    `- Partner ICO: ${str(partner?.identificationNumber)} | DIC: ${str(partner?.vatIdentificationNumber)}`,
    `- VS: ${str(d.variableSymbol)}${"constantSymbol" in d ? ` | KS: ${str(d.constantSymbol)} | SS: ${str(d.specificSymbol)}` : ""}`,
    `- Total: ${str(d.totalWithVatHc, "?")} ${str(cur?.code, "CZK")}`,
  ];
  if ("remainingAmountToPayHc" in d) {
    lines.push(`- Remaining to pay: ${str(d.remainingAmountToPayHc, "?")}${d.dateOfPayment ? ` (last payment ${d.dateOfPayment})` : ""}`);
  }
  for (const line of [vatText(d), controllingText(d)]) if (line) lines.push(line);
  if (aa?.shortCut) lines.push(`- Account assignment: ${aa.shortCut}`);
  if (items?.length) lines.push(`- Items: ${items.map((it) => str(it.description)).join("; ")}`);
  if (d.description) lines.push(`- Description: ${d.description}`);
  if (d.note) lines.push(`- Note: ${d.note}`);
  return lines.join("\n");
}

function formatStockTaking(d: Record<string, unknown>): string {
  const lines = [`## Stocktaking document id ${str(d.id)}${d.description ? `: ${d.description}` : ""}`];
  for (const it of (d.items as Array<Record<string, unknown>> | undefined) ?? []) {
    const art = it.article as Record<string, unknown> | undefined;
    const wh = it.warehouse as Record<string, unknown> | undefined;
    lines.push(`- ${str(art?.description)} [${str(art?.catalogue)}] in ${str(wh?.code)}: counted ${str(it.inventoryAmount, "?")}`);
  }
  if (d.note) lines.push(`- Note: ${d.note}`);
  return lines.join("\n");
}

const documentParams = {
  documentNumber: z.string().optional(),
  description: z.string().optional().describe("Document description"),
  variableSymbol: z.string().optional(),
  partner: partnerSchema.optional(),
  ...controllingParams,
};

const receivableLiabilityParams = {
  dateOfIssue: dateParam("Issue date"),
  dateOfAccountingEvent: dateParam("Accounting event date").optional(),
  dateOfMaturity: dateParam("Maturity date").optional(),
  constantSymbol: z.string().optional(),
  specificSymbol: z.string().optional(),
  ...documentParams,
};

type ReceivableLiability = {
  dateOfIssue: string;
  dateOfAccountingEvent?: string;
  dateOfMaturity?: string;
  documentNumber?: string;
  description?: string;
  variableSymbol?: string;
  constantSymbol?: string;
  specificSymbol?: string;
  partner?: z.infer<typeof partnerSchema>;
  costCenterCode?: string;
  projectCode?: string;
  activityCode?: string;
};

function receivableLiabilityInput(p: ReceivableLiability) {
  return {
    dateOfIssue: isoDate(p.dateOfIssue),
    dateOfAccountingEvent: isoDate(p.dateOfAccountingEvent),
    dateOfMaturity: isoDate(p.dateOfMaturity),
    documentNumber: p.documentNumber,
    description: p.description,
    variableSymbol: p.variableSymbol,
    constantSymbol: p.constantSymbol,
    specificSymbol: p.specificSymbol,
    partnerAddress: partnerInput(p.partner),
    ...controllingInput(p),
  };
}

export function registerDocumentTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_internal_documents",
    "Query internal documents (interní doklady) with VAT summary and controlling variables. Read-only.",
    listParams(),
    READ,
    async (args) => listTool(m3, "internalDocuments", INTERNAL_FIELDS, "Internal Documents", args, formatDoc),
  );

  server.tool(
    "m3_liabilities",
    "Query liabilities (ostatní závazky) with maturity, remaining amount, VAT summary and controlling variables. Read-only.",
    listParams(),
    READ,
    async (args) => listTool(m3, "liabilities", RECEIVABLE_LIABILITY_FIELDS, "Liabilities", args, formatDoc),
  );

  server.tool(
    "m3_receivables",
    "Query receivables (ostatní pohledávky) with maturity, remaining amount, VAT summary and controlling variables. Read-only.",
    listParams(),
    READ,
    async (args) => listTool(m3, "receivables", RECEIVABLE_LIABILITY_FIELDS, "Receivables", args, formatDoc),
  );

  server.tool(
    "m3_inventory_documents",
    "Query stocktaking documents (inventurní doklady) with counted amounts per article and warehouse. Read-only.",
    listParams(),
    READ,
    // Root name from 950ac9a's collection list; item field names mirror the
    // createStockTakingDocument example in mutation_priklady.pdf (unverified for reads).
    async (args) =>
      listTool(
        m3,
        "stockTakingDocuments",
        "id isDeleted description note items { article { catalogue description } inventoryAmount warehouse { code name } }",
        "Stocktaking Documents",
        args,
        formatStockTaking,
      ),
  );

  server.tool(
    "m3_create_internal_document",
    "Create an internal document. Written to the Money S3 import queue; check the result with m3_import_status.",
    {
      dateOfAccountingEvent: dateParam("Date of accounting event"),
      dateOfTaxing: dateParam("VAT date").optional(),
      ...documentParams,
      definitionShortcut: definitionParam("_ID"),
    },
    CREATE,
    async (p) =>
      runMutation(m3, {
        mutation: "createInternalDocument",
        arg: "internalDocument",
        label: "Internal document",
        verifyWith: "m3_internal_documents",
        definitionShortcut: p.definitionShortcut,
        input: {
          dateOfAccountingEvent: isoDate(p.dateOfAccountingEvent),
          dateOfTaxing: isoDate(p.dateOfTaxing),
          documentNumber: p.documentNumber,
          description: p.description,
          variableSymbol: p.variableSymbol,
          partnerAddress: partnerInput(p.partner),
          ...controllingInput(p),
        },
      }),
  );

  server.tool(
    "m3_create_liability",
    "Create a liability (závazek). Written to the Money S3 import queue; check the result with m3_import_status.",
    { ...receivableLiabilityParams, definitionShortcut: definitionParam("_ZV") },
    CREATE,
    async (p) =>
      runMutation(m3, {
        mutation: "createLiability",
        arg: "liability",
        label: "Liability",
        verifyWith: "m3_liabilities",
        definitionShortcut: p.definitionShortcut,
        input: receivableLiabilityInput(p),
      }),
  );

  server.tool(
    "m3_create_receivable",
    "Create a receivable (pohledávka). Written to the Money S3 import queue; check the result with m3_import_status.",
    { ...receivableLiabilityParams, definitionShortcut: definitionParam("_PH") },
    CREATE,
    async (p) =>
      runMutation(m3, {
        mutation: "createReceivable",
        arg: "receivable",
        label: "Receivable",
        verifyWith: "m3_receivables",
        definitionShortcut: p.definitionShortcut,
        input: receivableLiabilityInput(p),
      }),
  );
}
