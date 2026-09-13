import fs from "node:fs";
const sql = fs.readFileSync("supabase/migrations/202609120002_procurement_po_revision_stage_a_foundation.sql", "utf8");
for (const token of ["revision_family_id", "root_purchase_order_id", "previous_revision_id", "superseded_by_revision_id", "revision_diff_snapshot", "revision_line_key", "procurement_purchase_order_effective_revision", "procurement_purchase_order_received_by_lineage", "procurement_purchase_order_remaining_by_lineage", "status in ('approved','issued')", "grant execute", "revision_reason"]) {
  if (token === "revision_reason") { if (sql.toLowerCase().includes(token)) throw new Error("Revision reason must not exist"); }
  else if (!sql.includes(token)) throw new Error(`Missing Stage A contract: ${token}`);
}
if (sql.includes("create_procurement_purchase_order_revision")) throw new Error("Mutation revision RPC must not be created in Stage A");
if (!/where po\.id = coalesce\([\s\S]*?\)\s+and source\.id = p_purchase_order_id;/.test(sql)) throw new Error("Effective revision query must use one coherent WHERE clause");
for (const token of ["source.revision_family_id is null", "candidate.status in ('approved','issued')", "candidate.superseded_by_revision_id is null", "order by candidate.revision_no desc"]) {
  if (!sql.includes(token)) throw new Error(`Missing effective revision semantics: ${token}`);
}
for (const token of ["source.id=p_purchase_order_id", "po.id=source.id", "po.revision_family_id=source.revision_family_id", "g.status='finalized'"]) {
  if (!sql.includes(token)) throw new Error(`Missing family-scoped receipt semantics: ${token}`);
}
if (!/procurement_purchase_order_remaining_by_lineage[\s\S]*?procurement_purchase_order_received_by_lineage/.test(sql)) throw new Error("Remaining helper must delegate to received-by-lineage");
console.log("PO revision Stage A foundation rules: PASS");
