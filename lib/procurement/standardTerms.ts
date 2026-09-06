export type PurchaseOrderStandardTermClause = { heading: string; clause_body: string; sort_order: number };
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
