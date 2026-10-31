import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/settings/purchase-order-masters/page.tsx", "utf8");
const modulePage = fs.readFileSync("components/ModulePage.tsx", "utf8");
const visibility = fs.readFileSync("lib/permissionVisibility.ts", "utf8");
assert.ok(page.includes("PO & WO Terms & Conditions"));
assert.ok(page.includes("Purchase Orders and Work Orders"));
assert.ok(modulePage.includes("Masters - PO & WO Terms & Conditions"));
assert.match(visibility, /procurement_po_terms_master: \{ visible_group: "Settings", visible_name: "Masters - PO & WO Terms & Conditions"/);
for (const marker of ["groupedTerms", "active sets are shown first", "Active", "Inactive", "Updated", "sections.length", "Edit", "Inactivate", "+ Add Clause"]) {
  assert.match(page, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `Missing PO terms UI marker: ${marker}`);
}
assert.match(page, /row\.status === "active"/);
assert.match(page, /Number\(b\.status === "active"\) - Number\(a\.status === "active"\)/);
assert.match(page, /row\.sections \|\| \[\]/);
assert.match(page, /template_name \|\| "Standard PO Terms"/);
assert.match(page, /expanded = expandedTemplateId === row\.id/);
assert.doesNotMatch(page, /expanded = isActive \|\| expandedTemplateId/);
console.log("PO Terms & Conditions grouped UI contract passed.");
