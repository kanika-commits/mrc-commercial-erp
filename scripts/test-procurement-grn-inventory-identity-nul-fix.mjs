import assert from "node:assert/strict";
import fs from "node:fs";

const identitySource = fs.readFileSync("supabase/migrations/202611180002_procurement_inventory_identity_key_nul_fix.sql", "utf8");
const inventorySource = fs.readFileSync("supabase/migrations/202609070003_store_inventory_material_issue_baseline.sql", "utf8");

assert.match(inventorySource, /post_procurement_inventory_receipt/);
assert.match(identitySource, /procurement_inventory_identity_key/);
assert.match(identitySource, /chr\(31\)/);
assert.doesNotMatch(identitySource, /chr\(0\)/);

const key = ({ materialItemId, poItemId, uom, make, specification }) => {
  const prefix = materialItemId ? `master:${materialItemId}` : `po_item:${poItemId}`;
  const separator = String.fromCharCode(31);
  const input = [uom, make, specification].map((value) => String(value ?? "").trim().toLowerCase()).join(separator);
  return `${prefix}:md5(${input})`;
};
const fixture = key({ materialItemId: "material-1", poItemId: "po-item-1", uom: "Nos", make: "Precision", specification: "Panel" });
assert.equal(fixture.includes("\u0000"), false, "inventory identity key must never contain a NUL separator");
assert.equal(fixture.includes(String.fromCharCode(31)), true, "synthetic key should retain deterministic field separation");
assert.equal(key({ materialItemId: "material-1", poItemId: "po-item-1", uom: "Nos", make: "Precision", specification: "Panel" }), fixture);

console.log("GRN inventory identity NUL regression passed");
