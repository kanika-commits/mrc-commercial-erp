import assert from "node:assert/strict";
import fs from "node:fs";

const shell = fs.readFileSync("components/AppShell.tsx", "utf8");
const clientAudit = fs.readFileSync("lib/clientAudit.ts", "utf8");
const clientRoute = fs.readFileSync("app/api/audit/client-event/route.ts", "utf8");
const pilotCreate = fs.readFileSync("app/api/work-orders/pilot-ra-bills/route.ts", "utf8");
const pilotMutation = fs.readFileSync("app/api/work-orders/pilot-ra-bills/[id]/route.ts", "utf8");
const activityRoute = fs.readFileSync("app/api/admin/activity/route.ts", "utf8");

for (const key of ["pilot_work_orders_register", "pilot_ra_bills_register", "pilot_ra_bill_create", "pilot_ra_bill_detail", "work_order_detail", "ra_bill_detail"]) {
  assert.match(shell, new RegExp(key), `${key} must be emitted by navigation`);
  assert.match(clientRoute, new RegExp(key), `${key} must be authorized by the audit API`);
}
assert.match(clientAudit, /recentEvents/);
assert.match(shell, /recordClientAuditEvent\(\{ eventType: "view_page"/);
assert.match(pilotCreate, /Saved Pilot RA Bill Draft/);
assert.match(pilotCreate, /action: "create"/);
assert.match(pilotMutation, /Submitted Pilot RA Bill/);
assert.match(pilotMutation, /action: "submit"/);
assert.match(pilotMutation, /Deleted Pilot RA Bill/);
assert.match(pilotMutation, /action: "delete"/);
for (const action of ["approved", "sent_back", "reject"]) {
  assert.match(activityRoute, new RegExp(action), `${action} must be mapped into System Activity`);
}
assert.match(activityRoute, /work_order_pilot_ra_bill_review_audit/);
assert.match(activityRoute, /pilot-review-/);
assert.match(activityRoute, /pilotReviewResult\.error \? \[\]/);
for (const source of [pilotCreate, pilotMutation]) {
  assert.match(source, /organizationId:/, "Pilot audit must carry tenant scope");
  assert.match(source, /recordAuditEvent/);
}
assert.match(clientRoute, /loadPermissionContext/);
assert.match(clientRoute, /allowedInScope/);
assert.match(clientRoute, /organizationId: context\.organizations\?\.length === 1/);
assert.doesNotMatch(clientRoute, /old_values|new_values.*body|document_contents/i);
console.log("System Activity page and Pilot workflow audit coverage contract passed.");
