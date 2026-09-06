import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/202609020008_procurement_company_gst_and_site_contacts.sql", "utf8");
const gstRoute = fs.readFileSync("app/api/procurement/purchase-orders/gst-registrations/route.ts", "utf8");
const contactRoute = fs.readFileSync("app/api/procurement/purchase-orders/site-contacts/route.ts", "utf8");
const masterRoute = fs.readFileSync("app/api/procurement/purchase-orders/master-data/route.ts", "utf8");

for (const text of [gstRoute, contactRoute]) if (!text.includes("procurement_purchase_orders")) throw new Error("Expected procurement permission guard is missing.");
for (const required of [
  "company_gst_registrations",
  "upper(btrim(gstin))",
  "company_gst_registrations_one_default_idx",
  "Inactive GST registrations cannot be default.",
  "Choose another default GST registration before deactivating this one.",
  "save_company_gst_registration_atomic",
  "site_contacts_one_active_default_idx",
  "Inactive site contacts cannot be default.",
  "Choose another default site contact before deactivating this one.",
  "save_site_contact_atomic",
  "save_procurement_billing_address_with_gst_atomic",
  "gst_registration_id",
  "coalesce(v_gst.gstin",
  "company_id=(p_parent->>'company_id')::uuid",
  "status='active'",
]) if (!migration.includes(required)) throw new Error(`Missing rule: ${required}`);
if (!migration.includes("where id=(p_parent->>'gst_registration_id')::uuid") || !migration.includes("organization_id=p_organization_id") || !migration.includes("company_id=(p_parent->>'company_id')::uuid")) throw new Error("Billing GST organization/company validation is missing.");
if (!migration.includes("gstin=coalesce(v_gst.gstin")) throw new Error("Billing GSTIN must be sourced from the GST master.");
if (!migration.includes("Company cannot be changed for an existing GST registration.") || !migration.includes("Company cannot be changed for an existing billing address.")) throw new Error("Existing company reassignment guards are missing.");
if (!migration.includes("if v_existing_company <> p_company_id") || !migration.includes("if v_existing_company <> (p_parent->>'company_id')::uuid")) throw new Error("Existing company identity checks are missing.");
if (!migration.includes("v_gst.id") || !migration.includes("gst_registration_id")) throw new Error("Billing GST relationship persistence is missing.");
if (!migration.includes("nullif(p_parent->>'gst_registration_id','') is not null")) throw new Error("Nullable legacy GST linkage is missing.");
if (masterRoute.includes("company_gst_registrations")) throw new Error("Shared PO master-data route must remain migration-compatible.");
if (!contactRoute.includes("access.companies.includes(row.company_id)")) throw new Error("Site contact company scope is missing.");
console.log("GST/site-contact master rules passed.");
