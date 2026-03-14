import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";

function buildArgs(take: number, skip: number, where?: string, order?: string): string {
  const parts: string[] = [`take: ${take}`, `skip: ${skip}`];
  if (where) parts.push(`where: ${where}`);
  if (order) parts.push(`order: ${order}`);
  return parts.join(", ");
}

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
      if (!emp?.items?.length) return { content: [{ type: "text", text: "No employees found." }] };

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
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  server.tool(
    "m3_payroll",
    "Query payroll records with detailed breakdown. Read-only.",
    {
      take: z.number().min(1).max(100).default(20),
      skip: z.number().min(0).default(0),
      where: z.string().optional().describe("GraphQL where filter, e.g. filter by period"),
      order: z.string().optional().describe("GraphQL order clause"),
    },
    async ({ take, skip, where, order }) => {
      const gql = `{ payroll(${buildArgs(take, skip, where, order)}) {
        items {
          id employee { firstName lastName personalNumber }
          period year month
          grossSalary netSalary
          socialInsurance healthInsurance incomeTax
          employerSocialInsurance employerHealthInsurance
          costCenter { code name }
        }
        totalCount
      } }`;

      const data = await m3.query<{ payroll: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
      const pr = data.payroll;
      if (!pr?.items?.length) return { content: [{ type: "text", text: "No payroll records found." }] };

      const lines = [`# Payroll (${pr.items.length} of ${pr.totalCount})`, ""];
      for (const r of pr.items) {
        const emp = r.employee as Record<string, unknown> | undefined;
        const cc = r.costCenter as Record<string, unknown> | undefined;
        lines.push(`## ${emp?.firstName ?? ""} ${emp?.lastName ?? ""} (${emp?.personalNumber ?? "?"})`);
        lines.push(`- Period: ${r.period ?? `${r.year ?? "?"}/${r.month ?? "?"}`}`);
        lines.push(`- Gross: ${r.grossSalary ?? "?"} | Net: ${r.netSalary ?? "?"}`);
        lines.push(`- Employee: social ${r.socialInsurance ?? "?"} | health ${r.healthInsurance ?? "?"} | tax ${r.incomeTax ?? "?"}`);
        if (r.employerSocialInsurance || r.employerHealthInsurance) {
          lines.push(`- Employer: social ${r.employerSocialInsurance ?? "?"} | health ${r.employerHealthInsurance ?? "?"}`);
        }
        if (cc?.code) lines.push(`- Cost center: ${cc.code} (${cc.name ?? "—"})`);
        lines.push("");
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

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
      const gql = `{ serviceRepairs(${buildArgs(take, skip, where, order)}) {
        items {
          id documentNumber dateOfIssue
          description status
          partnerAddress { businessAddress { name } company { identificationNumber } }
          costCenter { code name }
          items { description amount unitPriceHc }
        }
        totalCount
      } }`;

      const data = await m3.query<{ serviceRepairs: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
      const sr = data.serviceRepairs;
      if (!sr?.items?.length) return { content: [{ type: "text", text: "No service/repair records found." }] };

      const lines = [`# Service & Repairs (${sr.items.length} of ${sr.totalCount})`, ""];
      for (const r of sr.items) {
        const partner = r.partnerAddress as Record<string, unknown> | undefined;
        const biz = partner?.businessAddress as Record<string, unknown> | undefined;
        const co = partner?.company as Record<string, unknown> | undefined;
        const cc = r.costCenter as Record<string, unknown> | undefined;
        const items = r.items as Array<Record<string, unknown>> | undefined;

        lines.push(`## ${r.documentNumber ?? "—"} (${r.dateOfIssue ?? "—"}) — Status: ${r.status ?? "—"}`);
        lines.push(`- Partner: ${biz?.name ?? "—"} (ICO: ${co?.identificationNumber ?? "—"})`);
        if (cc?.code) lines.push(`- Cost center: ${cc.code} (${cc.name ?? "—"})`);
        if (r.description) lines.push(`- ${r.description}`);
        if (items && items.length > 0) {
          lines.push("- Items:");
          for (const it of items) {
            lines.push(`  - ${it.description ?? "—"}: ${it.amount ?? 0} × ${it.unitPriceHc ?? 0}`);
          }
        }
        lines.push("");
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
