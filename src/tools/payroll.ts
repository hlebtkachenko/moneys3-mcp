import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MoneyS3Client } from "../moneys3-client.js";

export function registerPayrollTools(server: McpServer, m3: MoneyS3Client) {
  server.tool(
    "m3_employees",
    "Query employees from Money S3. Read-only.",
    {
      take: z.number().min(1).max(100).default(50),
      skip: z.number().min(0).default(0),
      where: z.string().optional().describe("GraphQL where filter"),
    },
    async ({ take, skip, where }) => {
      const parts: string[] = [`take: ${take}`, `skip: ${skip}`];
      if (where) parts.push(`where: ${where}`);

      const gql = `{ employees(${parts.join(", ")}) {
        items {
          id personalNumber firstName lastName
          dateOfBirth
          address { street city zip }
          contact { email phone }
          position department
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
        lines.push(`## ${e.firstName ?? ""} ${e.lastName ?? ""} (#${e.personalNumber ?? e.id ?? "?"})`);
        lines.push(`- Position: ${e.position ?? "—"} | Department: ${e.department ?? "—"}`);
        if (addr) lines.push(`- Address: ${[addr.street, addr.city, addr.zip].filter(Boolean).join(", ")}`);
        if (ct?.email || ct?.phone) lines.push(`- Contact: ${[ct.email, ct.phone].filter(Boolean).join(" | ")}`);
        lines.push("");
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  server.tool(
    "m3_payroll",
    "Query payroll records from Money S3. Read-only.",
    {
      take: z.number().min(1).max(100).default(20),
      skip: z.number().min(0).default(0),
      where: z.string().optional().describe("GraphQL where filter, e.g. filter by period"),
    },
    async ({ take, skip, where }) => {
      const parts: string[] = [`take: ${take}`, `skip: ${skip}`];
      if (where) parts.push(`where: ${where}`);

      const gql = `{ payroll(${parts.join(", ")}) {
        items {
          id employee { firstName lastName personalNumber }
          period grossSalary netSalary
          socialInsurance healthInsurance incomeTax
        }
        totalCount
      } }`;

      const data = await m3.query<{ payroll: { items: Record<string, unknown>[]; totalCount: number } }>(gql);
      const pr = data.payroll;

      if (!pr?.items?.length) return { content: [{ type: "text", text: "No payroll records found." }] };

      const lines = [`# Payroll (${pr.items.length} of ${pr.totalCount})`, ""];
      for (const r of pr.items) {
        const emp = r.employee as Record<string, unknown> | undefined;
        lines.push(`- **${emp?.firstName ?? ""} ${emp?.lastName ?? ""}** (${emp?.personalNumber ?? "?"})`);
        lines.push(`  Period: ${r.period ?? "—"} | Gross: ${r.grossSalary ?? "?"} | Net: ${r.netSalary ?? "?"}`);
        lines.push(`  Social: ${r.socialInsurance ?? "?"} | Health: ${r.healthInsurance ?? "?"} | Tax: ${r.incomeTax ?? "?"}`);
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
    },
    async ({ take, skip }) => {
      const gql = `{ serviceRepairs(take: ${take}, skip: ${skip}) {
        items {
          id documentNumber dateOfIssue
          description status
          partnerAddress { businessAddress { name } }
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
        lines.push(`- **${r.documentNumber ?? "—"}** (${r.dateOfIssue ?? "—"}) — ${biz?.name ?? "—"} — Status: ${r.status ?? "—"}`);
        if (r.description) lines.push(`  ${r.description}`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
