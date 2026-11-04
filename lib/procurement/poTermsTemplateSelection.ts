function clauseSignature(clauses: any[]) {
  return clauses
    .map((clause) => `${String(clause.heading || "").trim().toLowerCase()}\u0000${String(clause.clause_body || "").trim()}`)
    .join("\u0001");
}

/** Finds the existing lookup template matching a saved PO snapshot without trusting its saved lookup label. */
export function findSavedPurchaseOrderTermsTemplate(snapshot: unknown, templates: any[]) {
  let parsed: any;
  try { parsed = JSON.parse(String(snapshot ?? "")); } catch { return null; }
  if (!parsed || !Array.isArray(parsed.clauses) || !parsed.clauses.length) return null;
  const savedSignature = clauseSignature(parsed.clauses);
  return templates.find((template) => {
    const sections = (template.sections || [])
      .filter((section: any) => section.status === undefined || section.status === "active")
      .sort((a: any, b: any) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    return clauseSignature(sections) === savedSignature;
  }) || null;
}
