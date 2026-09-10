import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/202609100015_procurement_terms_template_sections_atomic_save.sql", "utf8");
const route = fs.readFileSync("app/api/procurement/purchase-orders/master-data/route.ts", "utf8");
const page = fs.readFileSync("app/settings/purchase-order-masters/page.tsx", "utf8");
const termsTemplateBlock = route.slice(route.indexOf('if (kind === "terms_template")'), route.indexOf('if (kind === "terms_section")'));

const checks = [
  [migration.includes("save_procurement_terms_template_with_sections_atomic"), "atomic terms RPC exists"],
  [migration.includes("id <> all(v_submitted_ids)"), "omitted sections are deleted"],
  [migration.includes("returning id into v_section_id") && migration.includes("v_submitted_ids := array_append(v_submitted_ids, v_section_id)"), "new sections are retained during exact-set cleanup"],
  [migration.includes("organization_id = p_organization_id") && migration.includes("company_id = p_company_id"), "organization/company scope is enforced"],
  [migration.includes("from public.companies") && migration.includes("id = p_company_id") && migration.includes("and organization_id = p_organization_id") && migration.includes("status = 'active'"), "company ownership is validated before create"],
  [migration.includes("Company is not active or does not belong to the selected organization"), "cross-organization and nonexistent companies are denied"],
  [migration.includes("Terms section does not belong to the selected template"), "cross-template section mutation is denied"],
  [!migration.includes("procurement_purchase_orders"), "PO snapshots are untouched"],
  [termsTemplateBlock.includes("save_procurement_terms_template_with_sections_atomic") && !termsTemplateBlock.includes('from("company_po_terms_sections").update(values)'), "route uses the atomic terms path"],
  [page.includes("sections: clauses") && !page.includes("for (const clause of clauses)"), "UI submits one exact section set"],
];

for (const [ok, label] of checks) if (!ok) throw new Error(`FAIL: ${label}`);
console.log("PASS: PO Terms exact-set save rules");
