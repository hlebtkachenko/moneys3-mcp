import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";
import { buildArgs, textResult, errorResult } from "./helpers.js";

export function registerPayrollTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_employees",
    "Query employees with full detail: address, contact, employment dates, cost center, employment type. Read-only.",
    {
      take: z.number().min(1).max(100).default(50),
      skip: z.number().min(0).default(0),
      where: z.string().optional().describe("GraphQL where filter"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      try {
        const gql = `{ employees(${buildArgs(take, skip, where, order)}) {
        items {
          id personalNumber firstName lastName
          dateOfBirth dateOfEntry dateOfDeparture
          address { street city zip country }
          contact { email phone mobile }
          position department
          costCenter { code name }
          employmentType
          note
        }
        totalCount
      } }`;

        const data = await m3.query<{ employees: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const emp = data.employees;
        if (!emp?.items?.length) return textResult("No employees found.");

        const lines = [`# Employees (${emp.items.length} of ${emp.totalCount})`, ""];
        for (const e of emp.items) {
          const addr = e.address as Record<string, unknown> | undefined;
          const ct = e.contact as Record<string, unknown> | undefined;
          const cc = e.costCenter as Record<string, unknown> | undefined;

          lines.push(`## ${e.firstName ?? ""} ${e.lastName ?? ""} (#${e.personalNumber ?? e.id ?? "?"})`);
          lines.push(`- Position: ${e.position ?? "—"} | Department: ${e.department ?? "—"} | Type: ${e.employmentType ?? "—"}`);
          lines.push(`- Entry: ${e.dateOfEntry ?? "—"}${e.dateOfDeparture ? ` | Departure: ${e.dateOfDeparture}` : ""}`);
          if (cc?.code) lines.push(`- Cost center: ${cc.code} (${cc.name ?? "—"})`);
          if (addr) lines.push(`- Address: ${[addr.street, addr.city, addr.zip, addr.country].filter(Boolean).join(", ") || "—"}`);
          if (ct) {
            const parts = [ct.email, ct.phone, ct.mobile].filter(Boolean);
            if (parts.length > 0) lines.push(`- Contact: ${parts.join(" | ")}`);
          }
          if (e.note) lines.push(`- Note: ${e.note}`);
          lines.push("");
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  // Note: payroll query does not exist in the API schema. Use createWage mutation for wages.

  server.tool(
    "m3_service_repairs",
    "Query service and repair records. Read-only.",
    {
      take: z.number().min(1).max(100).default(20),
      skip: z.number().min(0).default(0),
      where: z.string().optional().describe("GraphQL where filter"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      try {
        const gql = `{ services(${buildArgs(take, skip, where, order)}) {
        items {
          id documentNumber dateOfIssue
          description
          centre { shortCut name }
        }
        totalCount
      } }`;

        const data = await m3.query<{ services: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
        const sr = data.services;
        if (!sr?.items?.length) return textResult("No service/repair records found.");

        const lines = [`# Service & Repairs (${sr.items.length} of ${sr.totalCount})`, ""];
        for (const r of sr.items) {
          const cc = r.centre as Record<string, unknown> | undefined;

          lines.push(`## ${r.documentNumber ?? "—"} (${r.dateOfIssue ?? "—"})`);
          if (cc?.shortCut) lines.push(`- Cost center: ${cc.shortCut} (${cc.name ?? "—"})`);
          if (r.description) lines.push(`- ${r.description}`);
          lines.push("");
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
}
