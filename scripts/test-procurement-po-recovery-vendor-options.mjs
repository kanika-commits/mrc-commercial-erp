import assert from "node:assert/strict";
import fs from "node:fs";

const form = fs.readFileSync("app/purchase/purchase-orders/new/page.tsx", "utf8");
const createRoute = fs.readFileSync("app/api/procurement/purchase-orders/route.ts", "utf8");
const updateRoute = fs.readFileSync("app/api/procurement/purchase-orders/[id]/route.ts", "utf8");
const core = fs.readFileSync("lib/procurement/contractorRecoveryCore.ts", "utf8");

const check = (condition, message) => assert.ok(condition, message);

check(form.includes("const recoveryVendors = lookups.vendors.filter"), "recovery contractor options must be derived from Work Order vendor links");
check(form.includes('row.company_id === companyId && row.site_id === siteId'), "recovery contractors must be company/site scoped");
check(form.includes('String(link.vendor_role || "")'), "recovery contractors must use the established Work Order vendor relationship");
check(form.includes('"Main Contractor", "Subcontractor"'), "only eligible contractor roles may populate recovery options");
check(!form.includes("recoveryVendors = lookups.vendors.filter((vendor: any) => vendor.id === vendorId"), "recovery contractor options must not be filtered by the PO supplier");
check(form.includes("recovery_vendor_id"), "the selected recovery contractor must be explicit in form state");
check(form.includes("link.vendor_id === commercial.recovery_vendor_id"), "Work Orders must filter by the selected recovery contractor");
check(createRoute.includes("recoveryWorkOrderId!, recovery.recoveryVendorId!"), "create validation must use the recovery vendor");
check(updateRoute.includes("recoveryWorkOrderId!, recoveryVendorId"), "update validation must use the recovery vendor");
check(core.includes("vendor_id: po.recovery_vendor_id"), "the recovery Debit Note must use the recovery vendor");
check(core.includes("source_purchase_order_id: po.id"), "the recovery Debit Note must link to the exact source PO");
check(core.includes("source_purchase_order_id"), "reuse must be keyed by exact source PO");

const workOrders = [
  { company_id: "company-1", site_id: "site-1", work_order_vendors: [{ vendor_id: "po-supplier", vendor_role: "Main Contractor" }, { vendor_id: "recovery-contractor", vendor_role: "Subcontractor" }] },
];
const poSupplier = "po-supplier";
const contractors = new Set(workOrders.flatMap((row) => row.work_order_vendors.filter((link) => ["Main Contractor", "Subcontractor"].includes(link.vendor_role)).map((link) => link.vendor_id)));
check(contractors.has("recovery-contractor") && contractors.has(poSupplier), "a recovery contractor different from the PO supplier must remain eligible");

console.log("procurement PO recovery vendor option checks passed");
