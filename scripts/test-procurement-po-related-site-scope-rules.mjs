import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => fs.readFileSync(`${root}${path}`, "utf8");
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

const approvals = read("app/api/procurement/purchase-order-approvals/route.ts");
const pdf = read("app/api/procurement/purchase-orders/[id]/pdf/route.ts");
const detail = read("app/api/procurement/purchase-orders/[id]/route.ts");
const masterData = read("app/api/procurement/purchase-orders/master-data/route.ts");
const tracking = read("app/api/procurement/goods-receipts/purchase-orders/[id]/route.ts");

for (const [name, source] of [
  ["approvals", approvals],
  ["PDF", pdf],
  ["detail revision history", detail],
  ["master-data dependency checks", masterData],
]) {
  expect(source.includes("applyCompanySiteAccess"), `${name} must use company/site scope.`);
  expect(source.includes("applyOrganizationAccess"), `${name} must retain organization scope.`);
}

expect(approvals.includes("previousQuery = previousQuery && applyCompanySiteAccess(previousQuery, auth)"), "Approval previous revisions must be site-scoped.");
expect(pdf.includes("previousQuery = previousQuery && applyCompanySiteAccess(previousQuery, auth)"), "PDF previous revisions must be site-scoped.");
expect(detail.includes("familyQuery = familyQuery && applyCompanySiteAccess(familyQuery, auth)"), "Detail revision history must be site-scoped.");
expect(tracking.includes("applyCompanySiteAccess"), "Purchase Order Tracking must retain server-side site scope.");
expect(tracking.includes("loadFamilyReceiptTotals"), "Purchase Order Tracking must use its PO-specific revision runtime.");

console.log("PO related revision/site-scope rules passed");
