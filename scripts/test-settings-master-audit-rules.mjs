import assert from "node:assert/strict";
import fs from "node:fs";

const audit = fs.readFileSync("lib/auditEvent.ts", "utf8");
const serverAudit = fs.readFileSync("lib/serverAudit.ts", "utf8");
const activity = fs.readFileSync("app/api/admin/activity/route.ts", "utf8");
const siteContacts = fs.readFileSync("app/api/procurement/purchase-orders/site-contacts/route.ts", "utf8");
const sources = Object.fromEntries([
  ["companies", "app/api/companies/route.ts"],
  ["sites", "app/api/sites/route.ts"],
  ["vendors", "app/api/vendors/route.ts"],
  ["departments", "app/api/hr/departments/route.ts"],
  ["designations", "app/api/hr/designations/route.ts"],
  ["trades", "app/api/labour/trades/route.ts"],
  ["bank_accounts", "app/api/company-bank-accounts/route.ts"],
  ["items", "app/api/procurement/items/route.ts"],
  ["gst", "app/api/procurement/purchase-orders/gst-registrations/route.ts"],
  ["master_data", "app/api/procurement/purchase-orders/master-data/route.ts"],
  ["letterheads", "app/api/procurement/purchase-orders/letterheads/route.ts"],
].map(([name, path]) => [name, fs.readFileSync(path, "utf8")]));

assert.match(audit, /recordAuditEvent/);
assert.match(audit, /insertErpAuditLog/);
assert.match(serverAudit, /organization_id: input\.organizationId/);
assert.match(serverAudit, /created_by: actor\.userId/);
assert.match(serverAudit, /created_by_name: actor\.userName/);
assert.match(serverAudit, /created_by_email: actor\.userEmail/);
assert.match(activity, /from\("erp_audit_logs"\)/);
assert.match(activity, /auditQuery\.in\("organization_id", account\.organizations\)/);
assert.match(activity, /function summaryBucket/);
assert.match(activity, /action === "create" \|\| action === "add"/);
assert.match(activity, /action === "update" \|\| action === "edit"/);
assert.match(activity, /action === "delete"/);

for (const [name, source] of Object.entries(sources)) {
  if (name === "departments" || name === "designations" || name === "gst" || name === "master_data" || name === "letterheads") {
    assert.match(source, /recordAuditEvent|auditMasterMutation/, `${name} writes the canonical ERP audit event`);
  }
}

assert.match(sources.companies, /recordAuditEvent/);
assert.match(sources.sites, /recordAuditEvent/);
assert.match(sources.vendors, /recordAuditEvent/);
assert.match(sources.trades, /audit\(access, request/);
assert.match(sources.bank_accounts, /recordAuditEvent/);
assert.match(sources.items, /recordAuditEvent/);
assert.match(sources.gst, /procurement_gst_billing_delivery_master/);
assert.match(sources.master_data, /procurement_po_terms_master/);
assert.match(sources.letterheads, /procurement_letterhead_master/);
assert.match(sources.master_data, /410/);
assert.match(sources.master_data, /Standalone Site Contacts are retired/);
assert.doesNotMatch(sources.master_data, /from\("erp_audit_logs"\).*delete/);
console.log("Settings master audit rules passed.");
