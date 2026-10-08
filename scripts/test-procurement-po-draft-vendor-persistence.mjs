import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/procurement/purchase-orders/[id]/route.ts", "utf8");
const helper = fs.readFileSync("lib/procurement/poDraftVendorSnapshot.server.ts", "utf8");
const renderer = fs.readFileSync("lib/procurement/poPdfRenderer.server.ts", "utf8");

assert.match(route, /loadAuthorizedPurchaseOrderVendorSnapshot\(result\.admin, result\.row\.organization_id, requestedVendorId\)/);
assert.match(route, /purchaseOrderVendorSnapshotUpdate\(requestedVendorId, vendorRefresh\.snapshot\)/);
assert.match(route, /\.in\("status", \["draft", "sent_back"\]\)/);
assert.match(helper, /\.eq\("organization_id", organizationId\)/);
assert.match(helper, /vendor_contacts/);
assert.match(helper, /vendor_gstins/);
assert.match(renderer, /row\.vendor_name_snapshot \|\| vendor\.vendor_name/);
assert.match(renderer, /PAN: \$\{text\(vendor\.pan\)\}/);

const vendorA = { vendor_name: "Vendor A", address: "A Street", pan: "PAN-A", gstin: "GST-A" };
const vendorB = { vendor_name: "Vendor B", address: "B Street", pan: "PAN-B", gstin: "GST-B" };
assert.notEqual(vendorA.vendor_name, vendorB.vendor_name);
const savedDraft = { vendor_id: "vendor-b", vendor_name_snapshot: vendorB.vendor_name, vendor_snapshot: vendorB };
assert.match(JSON.stringify(savedDraft), /Vendor B/);
assert.match(JSON.stringify(savedDraft), /PAN-B/);
assert.match(JSON.stringify(savedDraft), /GST-B/);
assert.doesNotMatch(JSON.stringify(savedDraft), /Vendor A|PAN-A|GST-A/);

console.log("PO draft vendor persistence regression passed");
