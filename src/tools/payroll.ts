import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { READ, listParams, listTool, str } from "./helpers.js";

// Personal data history lives in employeeTimePeriods; the open period
// (dateTo empty or 0001-01-01) is the current one. Birth numbers are not read.
const EMPLOYEE_FIELDS = `
  id personalNumber titleBefore firstName lastName titleAfter note
  employmentRelationships { id description dateOfStart dateOfEnd employmentType { name } centre { shortCut name } }
  employeeTimePeriods { dateFrom dateTo phone mobile email residenceAddress { street buildingNumber municipality municipalityPostCode { postalCode } } }
`;

type Rec = Record<string, unknown>;
const day = (v: unknown) => (typeof v === "string" && !v.startsWith("0001-") ? v.slice(0, 10) : undefined);

function formatEmployee(e: Rec): string {
  const periods = (e.employeeTimePeriods as Rec[] | undefined) ?? [];
  const current = periods.find((p) => !day(p.dateTo)) ?? periods.at(-1);
  const addr = current?.residenceAddress as Rec | undefined;
  const postal = (addr?.municipalityPostCode as Rec | undefined)?.postalCode;
  const name = [e.titleBefore, e.firstName, e.lastName, e.titleAfter].filter(Boolean).join(" ");
  const lines = [`## ${name || "Unnamed"} (#${str(e.personalNumber, str(e.id, "?"))}, id ${str(e.id)})`];
  const street = [addr?.street, addr?.buildingNumber].filter(Boolean).join(" ");
  const address = [street, addr?.municipality, postal].filter(Boolean).join(", ");
  if (address) lines.push(`- Address: ${address}`);
  const contact = [current?.email, current?.phone, current?.mobile].filter(Boolean);
  if (contact.length) lines.push(`- Contact: ${contact.join(" | ")}`);
  for (const r of (e.employmentRelationships as Rec[] | undefined) ?? []) {
    const cc = r.centre as Rec | undefined;
    const end = day(r.dateOfEnd);
    lines.push(
      `- Employment ${str(r.id)}: ${str((r.employmentType as Rec | undefined)?.name ?? r.description)}, from ${str(day(r.dateOfStart))}${end ? ` to ${end}` : ""}${cc?.shortCut ? ` (CC ${cc.shortCut})` : ""}`,
    );
  }
  if (e.note) lines.push(`- Note: ${e.note}`);
  return lines.join("\n");
}

export function registerPayrollTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_employees",
    "Query employees with employment relationships (type, dates, cost center) and the current address and contact. Read-only.",
    listParams(100, 50),
    READ,
    async (args) => listTool(m3, "employees", EMPLOYEE_FIELDS, "Employees", args, formatEmployee),
  );

  server.tool(
    "m3_service_repairs",
    "Query service or repair documents (servis, opravy) with dates, partner contact and cost center. Read-only.",
    { type: z.enum(["services", "repairs"]).default("services").describe("Service or repair documents"), ...listParams() },
    READ,
    async ({ type, ...args }) =>
      listTool(
        m3,
        type,
        "id documentNumber dateOfIssue dateOfSettleBy description phoneNumber email centre { shortCut name }",
        type === "services" ? "Service Documents" : "Repair Documents",
        args,
        (r) => {
          const cc = r.centre as Record<string, unknown> | undefined;
          const lines = [`## ${str(r.documentNumber)} (${str(r.dateOfIssue)}; id ${str(r.id)})`];
          if (cc?.shortCut) lines.push(`- Cost center: ${cc.shortCut} (${str(cc.name)})`);
          const contact = [r.email, r.phoneNumber].filter(Boolean);
          if (contact.length) lines.push(`- Contact: ${contact.join(" | ")}`);
          if (r.description) lines.push(`- ${r.description}`);
          return lines.join("\n");
        },
      ),
  );
}
