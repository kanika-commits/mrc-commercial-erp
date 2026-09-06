import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const queueApi = read("app/api/procurement/purchase-queue/route.ts");
const queuePage = read("app/purchase/queue/page.tsx");
const requisitionsApi = read("app/api/procurement/requisitions/route.ts");
const appShell = read("components/AppShell.tsx");
const modulePage = read("components/ModulePage.tsx");
const navigation = read("lib/defaultModuleNavigation.ts");
const startQuotation = read("app/api/procurement/requisitions/[id]/start-quotation/route.ts");

for (const source of [queueApi, requisitionsApi]) {
  assert.doesNotMatch(source, /procurement_rfqs|procurement_rfq_|final_selection|negotiation|start-quotation/);
}
assert.match(queueApi, /moduleCode: QUEUE, actionCode: "view"/);
assert.match(queueApi, /purchase_requisition_line_approval_state/);
assert.match(queueApi, /procurement_purchase_order_items/);
assert.doesNotMatch(queueApi, /moduleCode: RFQ|const RFQ/);
assert.match(queuePage, /Create Purchase Order/);
assert.match(queuePage, /source=indent&requisition_id=/);
assert.doesNotMatch(queuePage, /Start Quotation|Final Selection|Under Negotiation|procurement_rfqs/);
assert.match(appShell, /Purchase Queue/);
assert.match(appShell, /Material Indent|Indent Approval/);
assert.doesNotMatch(appShell, /Request for Quotation|procurement_rfqs|\/purchase\/rfqs/);
assert.doesNotMatch(modulePage, /procurement_rfqs|Request for Quotation/);
assert.match(navigation, /purchase_requisitions/);
assert.match(navigation, /purchase_requisition_approval/);
assert.match(navigation, /procurement_purchase_queue/);
assert.match(navigation, /procurement_items/);
assert.doesNotMatch(navigation, /procurement_rfqs|Request for Quotation|\/purchase\/rfqs/);
assert.match(startQuotation, /start_procurement_rfq_from_requisition_atomic/);

console.log("Non-RFQ Material Indent and Purchase Queue rules passed");
