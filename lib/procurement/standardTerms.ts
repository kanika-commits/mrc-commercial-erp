export type PurchaseOrderStandardTermClause = { heading: string; clause_body: string; sort_order: number };
export type PurchaseOrderStandardTermsTemplate = {
  id: string;
  template_name: string;
  sections?: Array<{ id?: string; heading?: string; clause_body?: string; sort_order?: number; status?: string }>;
};
export type ParsedPurchaseOrderStandardTerms =
  | { kind: "structured"; clauses: PurchaseOrderStandardTermClause[] }
  | { kind: "text"; text: string }
  | null;

export function parsePurchaseOrderStandardTerms(snapshot: unknown): ParsedPurchaseOrderStandardTerms {
  const text = String(snapshot ?? "");
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.clauses)) {
      const clauses = parsed.clauses
        .filter((clause: any) => clause && (String(clause.heading || "").trim() || String(clause.clause_body || "").trim()))
        .map((clause: any, index: number) => ({ heading: String(clause.heading || "").trim(), clause_body: String(clause.clause_body || ""), sort_order: Number.isFinite(Number(clause.sort_order)) ? Number(clause.sort_order) : index }))
        .sort((a: PurchaseOrderStandardTermClause, b: PurchaseOrderStandardTermClause) => a.sort_order - b.sort_order);
      return { kind: "structured", clauses };
    }
  } catch {
    // Historical plain text and malformed values remain readable as text.
  }
  return { kind: "text", text };
}

export function buildPurchaseOrderStandardTermsSnapshot(template: PurchaseOrderStandardTermsTemplate | null | undefined): string {
  if (!template?.id) return "";
  const clauses = (template.sections || [])
    .filter((section) => section.status === undefined || section.status === "active")
    .map((section, index) => ({
      ...(section.id ? { id: section.id } : {}),
      heading: String(section.heading || "").trim(),
      clause_body: String(section.clause_body || ""),
      sort_order: Number.isFinite(Number(section.sort_order)) ? Number(section.sort_order) : index,
    }))
    .filter((section) => section.heading || section.clause_body.trim())
    .sort((a, b) => a.sort_order - b.sort_order);
  return JSON.stringify({ template_id: template.id, template_name: template.template_name, clauses });
}
