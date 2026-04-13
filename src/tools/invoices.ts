import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import {
  escGql,
  DATE_RE,
  DATE_MSG,
  buildArgs,
  textResult,
  errorResult,
} from "./helpers.js";

const INVOICE_FIELDS = `
  items {
    id documentNumber dateOfIssue dateOfTaxing dateOfMaturity dateOfPayment
    variableSymbol specificSymbol pairingSymbol
    isCreditNote isBilled
    totalWithVatHc amountToPayHc remainingAmountToPayHc
    description year
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
  }
  totalCount
`;

function formatInvoice(inv: Record<string, unknown>): string {
  const partner = inv.partnerAddress as Record<string, unknown> | undefined;
  const biz = partner?.businessAddress as Record<string, unknown> | undefined;
  const items = inv.items as Array<Record<string, unknown>> | undefined;
  const cur = inv.currency as Record<string, unknown> | undefined;
  const vatSummary = inv.vatRateSummaryHc as
    | Array<Record<string, unknown>>
    | undefined;
  const cc = inv.centre as Record<string, unknown> | undefined;
  const proj = inv.jobOrder as Record<string, unknown> | undefined;
  const act = inv.operation as Record<string, unknown> | undefined;
  const aa = inv.accountAssignment as Record<string, unknown> | undefined;
  const aaAcc = aa?.accountAssignmentAcc as Record<string, unknown> | undefined;
  const ks = inv.constantSymbol as Record<string, unknown> | undefined;

  const lines = [
    `## ${inv.documentNumber ?? "—"}${inv.isCreditNote ? " [CREDIT NOTE]" : ""}`,
    `- Date: ${inv.dateOfIssue ?? "—"} | Taxing: ${inv.dateOfTaxing ?? "—"} | Maturity: ${inv.dateOfMaturity ?? "—"}`,
    `- Partner: ${biz?.name ?? "—"} (ICO: ${partner?.identificationNumber ?? "—"}, VAT: ${partner?.vatIdentificationNumber ?? "—"})`,
    `- Address: ${[biz?.street, biz?.municipality, biz?.postalCode, biz?.country].filter(Boolean).join(", ") || "—"}`,
    `- VS: ${inv.variableSymbol ?? "—"} | KS: ${ks?.code ?? "—"} | SS: ${inv.specificSymbol ?? "—"}`,
    `- Total: ${inv.totalWithVatHc ?? "?"} ${cur?.code ?? "CZK"}`,
    `- Paid: ${inv.isBilled ? `Yes (${inv.dateOfPayment ?? "—"})` : `No — remaining: ${inv.remainingAmountToPayHc ?? "?"}`}`,
  ];

  if (vatSummary && vatSummary.length > 0) {
    const vatParts = vatSummary.map(
      (v) => `${v.vatRate}%: base ${v.totalWithoutVat}, VAT ${v.totalVat}`,
    );
    lines.push(`- VAT: ${vatParts.join(" | ")}`);
  }

  const controlling = [cc?.shortCut, proj?.shortCut, act?.shortCut].filter(
    Boolean,
  );
  if (controlling.length > 0) {
    lines.push(
      `- Controlling: ${cc?.shortCut ? `CC:${cc.shortCut}` : ""} ${proj?.shortCut ? `Proj:${proj.shortCut}` : ""} ${act?.shortCut ? `Act:${act.shortCut}` : ""}`.trim(),
    );
  }

  if (aaAcc?.shortCut) lines.push(`- Account assignment: ${aaAcc.shortCut}`);

  if (items && items.length > 0) {
    lines.push("- Items:");
    for (const it of items) {
      const disc = it.discountPercentage ? ` (-${it.discountPercentage}%)` : "";
      lines.push(
        `  - ${it.description ?? "—"}: ${it.amount ?? 0} × ${it.unitPriceHc ?? 0} (VAT ${it.vatRate ?? "—"}%)${disc}`,
      );
    }
  }

  if (inv.description) lines.push(`- Description: ${inv.description}`);
  return lines.join("\n");
}

export function registerInvoiceTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_issued_invoices",
    "Query issued (outgoing) invoices with VAT breakdown, payment status, controlling variables, filtering and pagination",
    {
      take: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("Number of records to return"),
      skip: z.number().min(0).default(0).describe("Number of records to skip"),
      where: z
        .string()
        .optional()
        .describe(
          'GraphQL where filter, e.g. { dateOfIssue: { gt: "2024-01-01" } }',
        ),
      order: z
        .string()
        .optional()
        .describe("GraphQL order clause, e.g. { dateOfIssue: DESC }"),
    },
    async ({ take, skip, where, order }) => {
      try {
        const params = buildArgs(take, skip, where, order, true);
        const gql = `{ issuedInvoices(${params}) { ${INVOICE_FIELDS} } }`;
        const data = await m3.query<{
          issuedInvoices: {
            items: Record<string, unknown>[];
            totalCount: number;
          };
        }>(gql);
        const inv = data.issuedInvoices;

        if (!inv?.items?.length) {
          return textResult("No issued invoices found.");
        }

        const header = `# Issued Invoices (${inv.items.length} of ${inv.totalCount})\n`;
        const body = inv.items.map(formatInvoice).join("\n\n");
        return textResult(header + body);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_received_invoices",
    "Query received (incoming) invoices with VAT breakdown, payment status, controlling variables, filtering and pagination",
    {
      take: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("Number of records to return"),
      skip: z.number().min(0).default(0).describe("Number of records to skip"),
      where: z.string().optional().describe("GraphQL where filter"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      try {
        const params = buildArgs(take, skip, where, order, true);
        const gql = `{ receivedInvoices(${params}) { ${INVOICE_FIELDS} } }`;
        const data = await m3.query<{
          receivedInvoices: {
            items: Record<string, unknown>[];
            totalCount: number;
          };
        }>(gql);
        const inv = data.receivedInvoices;

        if (!inv?.items?.length) {
          return textResult("No received invoices found.");
        }

        const header = `# Received Invoices (${inv.items.length} of ${inv.totalCount})\n`;
        const body = inv.items.map(formatInvoice).join("\n\n");
        return textResult(header + body);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_create_issued_invoice",
    "Create a new issued (outgoing) invoice in Money S3. Written to async import queue.",
    {
      dateOfIssue: z
        .string()
        .regex(DATE_RE, DATE_MSG)
        .describe("Issue date (DD.MM.YYYY)"),
      dateOfTaxing: z
        .string()
        .regex(DATE_RE, DATE_MSG)
        .describe("Tax date (DD.MM.YYYY)"),
      dateOfMaturity: z
        .string()
        .regex(DATE_RE, DATE_MSG)
        .describe("Maturity date (DD.MM.YYYY)"),
      documentNumber: z
        .string()
        .optional()
        .describe("Document number (auto-generated if omitted)"),
      numericalSeriePrefix: z
        .string()
        .default("")
        .describe("Numerical series prefix"),
      isCreditNote: z
        .boolean()
        .default(false)
        .describe("Mark as credit note (dobropis)"),
      costCenterCode: z
        .string()
        .optional()
        .describe("Cost center code (středisko)"),
      projectCode: z.string().optional().describe("Project code (zakázka)"),
      activityCode: z.string().optional().describe("Activity code (činnost)"),
      items: z
        .array(
          z.object({
            description: z.string(),
            amount: z.number().min(0),
            unitPriceHc: z.number(),
            vatRate: z.string().optional().describe("VAT rate identifier"),
            discount: z
              .number()
              .min(0)
              .max(100)
              .optional()
              .describe("Discount percentage"),
          }),
        )
        .min(1)
        .describe("Invoice line items"),
      definitionShortcut: z
        .string()
        .default("_FP+FV")
        .describe("XML transfer definition shortcut"),
    },
    async ({
      dateOfIssue,
      dateOfTaxing,
      dateOfMaturity,
      documentNumber,
      numericalSeriePrefix,
      isCreditNote,
      costCenterCode,
      projectCode,
      activityCode,
      items,
      definitionShortcut,
    }) => {
      try {
        const itemsGql = items
          .map((it) => {
            const parts = [
              `description: "${escGql(it.description)}"`,
              `amount: ${it.amount}`,
              `unitPriceHc: ${it.unitPriceHc}`,
              it.vatRate ? `vatRate: "${escGql(it.vatRate)}"` : "",
              it.discount ? `discount: ${it.discount}` : "",
              `warrantyType: CONSTANT`,
              `isInverse: false`,
            ].filter(Boolean);
            return `{ ${parts.join(", ")} }`;
          })
          .join(", ");

        const extras = [
          documentNumber ? `documentNumber: "${escGql(documentNumber)}"` : "",
          isCreditNote ? `isCreditNote: true` : "",
          costCenterCode
            ? `centre: { shortCut: "${escGql(costCenterCode)}" }`
            : "",
          projectCode ? `jobOrder: { shortCut: "${escGql(projectCode)}" }` : "",
          activityCode
            ? `operation: { shortCut: "${escGql(activityCode)}" }`
            : "",
        ]
          .filter(Boolean)
          .join("\n      ");

        const gql = `mutation {
  createIssuedInvoice(
    issuedInvoice: {
      dateOfIssue: "${escGql(dateOfIssue)}"
      dateOfTaxing: "${escGql(dateOfTaxing)}"
      dateOfMaturity: "${escGql(dateOfMaturity)}"
      numericalSerie: { prefix: "${escGql(numericalSeriePrefix)}" }
      ${extras}
      items: [${itemsGql}]
    }
    definitionXMLTransfer: { shortCut: "${escGql(definitionShortcut)}" }
  ) { guid isSuccess }
}`;

        const data = await m3.query<{
          createIssuedInvoice: { guid: string; isSuccess: boolean };
        }>(gql, true);
        const result = data.createIssuedInvoice;
        const status = result.isSuccess
          ? "queued successfully"
          : "queued (check import queue for status)";
        return textResult(
          `Issued invoice ${status}.\nGUID: \`${result.guid}\``,
        );
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_create_received_invoice",
    "Create a new received (incoming) invoice in Money S3. Written to async import queue.",
    {
      dateOfIssue: z
        .string()
        .regex(DATE_RE, DATE_MSG)
        .describe("Issue date (DD.MM.YYYY)"),
      dateOfTaxing: z
        .string()
        .regex(DATE_RE, DATE_MSG)
        .describe("Tax date (DD.MM.YYYY)"),
      dateOfMaturity: z
        .string()
        .regex(DATE_RE, DATE_MSG)
        .describe("Maturity date (DD.MM.YYYY)"),
      documentNumber: z.string().optional().describe("Document number"),
      numericalSeriePrefix: z
        .string()
        .default("")
        .describe("Numerical series prefix"),
      costCenterCode: z.string().optional().describe("Cost center code"),
      projectCode: z.string().optional().describe("Project code"),
      activityCode: z.string().optional().describe("Activity code"),
      items: z
        .array(
          z.object({
            description: z.string(),
            amount: z.number().min(0),
            unitPriceHc: z.number(),
            vatRate: z.string().optional(),
            discount: z.number().min(0).max(100).optional(),
          }),
        )
        .min(1)
        .describe("Invoice line items"),
      definitionShortcut: z
        .string()
        .default("_FP+PF")
        .describe("XML transfer definition shortcut"),
    },
    async ({
      dateOfIssue,
      dateOfTaxing,
      dateOfMaturity,
      documentNumber,
      numericalSeriePrefix,
      costCenterCode,
      projectCode,
      activityCode,
      items,
      definitionShortcut,
    }) => {
      try {
        const itemsGql = items
          .map((it) => {
            const parts = [
              `description: "${escGql(it.description)}"`,
              `amount: ${it.amount}`,
              `unitPriceHc: ${it.unitPriceHc}`,
              it.vatRate ? `vatRate: "${escGql(it.vatRate)}"` : "",
              it.discount ? `discount: ${it.discount}` : "",
              `warrantyType: CONSTANT`,
              `isInverse: false`,
            ].filter(Boolean);
            return `{ ${parts.join(", ")} }`;
          })
          .join(", ");

        const extras = [
          documentNumber ? `documentNumber: "${escGql(documentNumber)}"` : "",
          costCenterCode
            ? `centre: { shortCut: "${escGql(costCenterCode)}" }`
            : "",
          projectCode ? `jobOrder: { shortCut: "${escGql(projectCode)}" }` : "",
          activityCode
            ? `operation: { shortCut: "${escGql(activityCode)}" }`
            : "",
        ]
          .filter(Boolean)
          .join("\n      ");

        const gql = `mutation {
  createReceivedInvoice(
    receivedInvoice: {
      dateOfIssue: "${escGql(dateOfIssue)}"
      dateOfTaxing: "${escGql(dateOfTaxing)}"
      dateOfMaturity: "${escGql(dateOfMaturity)}"
      numericalSerie: { prefix: "${escGql(numericalSeriePrefix)}" }
      ${extras}
      items: [${itemsGql}]
    }
    definitionXMLTransfer: { shortCut: "${escGql(definitionShortcut)}" }
  ) { guid isSuccess }
}`;

        const data = await m3.query<{
          createReceivedInvoice: { guid: string; isSuccess: boolean };
        }>(gql, true);
        const result = data.createReceivedInvoice;
        const status = result.isSuccess
          ? "queued successfully"
          : "queued (check import queue for status)";
        return textResult(
          `Received invoice ${status}.\nGUID: \`${result.guid}\``,
        );
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.tool(
    "m3_delete_invoice",
    "Delete an invoice by ID and year. Fails if the invoice has dependent records (e.g. stock movements).",
    {
      type: z.enum(["issued", "received"]).describe("Invoice type"),
      id: z.number().int().positive().describe("Invoice record ID"),
      year: z.number().int().min(2000).max(2100).describe("Accounting year"),
    },
    async ({ type, id, year }) => {
      try {
        const mutationName =
          type === "issued" ? "deleteIssuedInvoice" : "deleteReceivedInvoice";
        const inputName =
          type === "issued" ? "issuedInvoice" : "receivedInvoice";
        const gql = `mutation { ${mutationName}(${inputName}: { id: ${id}, year: ${year} }) { guid isSuccess } }`;
        const data = await m3.query<
          Record<string, { guid: string; isSuccess: boolean }>
        >(gql, true);
        const result = data[mutationName];
        const status = result.isSuccess
          ? "deleted"
          : "deletion queued (check import queue)";
        return textResult(
          `Invoice ${type} #${id} (${year}): ${status}.\nGUID: \`${result.guid}\``,
        );
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
}
