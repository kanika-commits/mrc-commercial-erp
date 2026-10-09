import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const route = fs.readFileSync(path.resolve("app/api/work-orders/[id]/revisions/[revisionId]/preview/route.ts"), "utf8");

assert.match(route, /revisionFields\.gst_registration_id/);
assert.match(route, /revisionFields\.billing_address_id/);
assert.match(route, /revisionFields\.delivery_location_id/);
assert.match(route, /revisionFields\.billing_contact_id/);
assert.match(route, /revisionFields\.delivery_contact_id/);
assert.match(route, /canonicalDeliverySnapshot/);
assert.match(route, /revisionDeliverySnapshot/);
assert.match(route, /\.eq\("organization_id", revision\.work_orders\.organization_id\)/);
assert.match(route, /\.eq\("company_id", revision\.work_orders\.company_id\)/);
assert.match(route, /\.eq\("site_id", revision\.work_orders\.site_id\)/);
assert.match(route, /Selected GST\/Billing Master is missing/);
assert.match(route, /Selected Billing Address is missing/);
assert.match(route, /Selected Delivery Location is missing/);
assert.match(route, /Selected Billing Contact is missing/);
assert.match(route, /Selected Delivery Contact is missing/);
assert.match(route, /delivery_snapshot: deliverySnapshot/);

const auditedShape = {
  fields: {
    gst_registration_id: "gst-audited",
    billing_address_id: "billing-audited",
    delivery_location_id: "delivery-audited",
    billing_contact_id: "contact-audited",
    delivery_contact_id: "contact-audited",
    delivery_snapshot: { id: "delivery-audited", location_name: "partial only" },
  },
};
assert.equal(auditedShape.fields.delivery_snapshot.master_selection, undefined);
for (const key of ["gst_registration_id", "billing_address_id", "delivery_location_id", "billing_contact_id", "delivery_contact_id"]) {
  assert.match(route, new RegExp(`revisionFields\\.${key}`));
}

console.log("Pilot revision delivery snapshot regression passed (audited top-level IDs, partial snapshot, scoped rejection guards).");
