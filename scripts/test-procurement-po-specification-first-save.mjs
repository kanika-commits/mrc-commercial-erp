import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizePurchaseOrderItemSpecification } from "../lib/procurement/poItemSpecification.ts";

const createPage = fs.readFileSync("app/purchase/purchase-orders/new/page.tsx", "utf8");
const createRpc = fs.readFileSync("supabase/migrations/202609060002_procurement_purchase_orders_non_rfq_create_rpcs.sql", "utf8");
const detail = fs.readFileSync("app/purchase/purchase-orders/[id]/page.tsx", "utf8");
const pdfRenderer = fs.readFileSync("lib/procurement/poPdfRenderer.server.ts", "utf8");

const custom = normalizePurchaseOrderItemSpecification({ item_name: "Waterproofing", description: "Custom waterproofing specification" });
assert.equal(custom.specification, "Custom waterproofing specification");

const materialMasterOverride = normalizePurchaseOrderItemSpecification({
  item_name: "Cement",
  description: "Project-specific specification",
  specification: "Old master specification",
});
assert.equal(materialMasterOverride.specification, "Project-specific specification");

const indent = normalizePurchaseOrderItemSpecification({ item_name: "Indent material", description: "Approved indent specification" });
assert.equal(indent.specification, "Approved indent specification");

const cleared = normalizePurchaseOrderItemSpecification({ item_name: "Cement", description: "", specification: "ABC specification" });
assert.equal(cleared.specification, "", "Clearing the combined field must not resurrect the old specification");
assert.match(createRpc, /nullif\(v_item->>'specification',''\)/, "An empty canonical value follows the existing RPC convention and persists as NULL");

const untouchedMaster = normalizePurchaseOrderItemSpecification({ item_name: "Steel", specification: "Master specification" });
assert.equal(untouchedMaster.specification, "Master specification");

assert.match(createPage, /visiblePurchaseOrderItemSpecification\(item\)/, "The input must render the same value that normalization treats as authoritative");
assert.match(createPage, /normalizePurchaseOrderItemSpecification\(item\)/, "The same canonical mapping must be applied before create and edit requests");
assert.match(createRpc, /specification_snapshot[\s\S]*?nullif\(v_item->>'specification',''\)/);

assert.match(detail, /item\.specification_snapshot/);
assert.match(pdfRenderer, /item\.specification_snapshot/);

const finalSelectionFiles = [
  "supabase/migrations/202608130014_procurement_purchase_orders.sql",
  "supabase/migrations/202609020009_procurement_po_master_snapshot_integration.sql",
  "app/api/procurement/rfqs/[id]/final-selection/route.ts",
].filter((path) => fs.existsSync(path));
if (finalSelectionFiles.length) {
  const finalSelectionSources = finalSelectionFiles.map((path) => fs.readFileSync(path, "utf8")).join("\n");
  assert.match(finalSelectionSources, /specification_snapshot|v_rfq_item\.specification/);
}

console.log(`PO specification first-save regression passed; Final Selection ${finalSelectionFiles.length ? "snapshot path verified" : "is absent from origin/main and untouched"}`);
