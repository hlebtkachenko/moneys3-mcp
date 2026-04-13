export function escGql(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

export const DATE_RE = /^\d{2}\.\d{2}\.\d{4}$/;
export const DATE_MSG = "Expected DD.MM.YYYY format";

export function buildArgs(
  take: number,
  skip: number,
  where?: string,
  order?: string,
  excludeDeleted = false,
): string {
  const parts: string[] = [`take: ${take}`, `skip: ${skip}`];
  if (excludeDeleted) {
    const deletedFilter = "isDeleted: { eq: false }";
    if (where) {
      const trimmed = where.trim();
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        parts.push(`where: { ${deletedFilter}, ${trimmed.slice(1)}`);
      } else {
        parts.push(`where: { ${deletedFilter}, ${trimmed} }`);
      }
    } else {
      parts.push(`where: { ${deletedFilter} }`);
    }
  } else if (where) {
    parts.push(`where: ${where}`);
  }
  if (order) parts.push(`order: ${order}`);
  return parts.join(", ");
}

export function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const };
}
