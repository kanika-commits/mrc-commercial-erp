import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/notifications/route.ts", "utf8");
const center = fs.readFileSync("components/NotificationCenter.tsx", "utf8");

for (const type of ["work_order_submitted_for_approval", "contractor_recovery_debit_note", "pilot_ra_bill_over_quantity_exception", "labour_attendance_sent_back"]) {
  assert.match(route, new RegExp(type), `lifecycle query missing ${type}`);
}
for (const table of ["work_orders", "debit_notes", "ra_bills", "labour_attendance_periods"]) {
  assert.match(route, new RegExp(`from\\(\\\"${table}\\\"\\)`), `lifecycle query missing ${table}`);
}
assert.match(route, /if \(!state\.resolved && !state\.deleted\) notifications\.push\(notification\)/);
assert.match(route, /const scanLimit = Math\.min\(200, Math\.max\(limit, limit \* 4\)\)/);
assert.match(route, /notifications\.slice\(0, limit\)/);
assert.match(route, /eq\("recipient_user_id", auth\.user\.id\)/g);
assert.match(route, /payment decision finalized\|payment requisition rejected/);
assert.doesNotMatch(route, /delete\(\)/, "lifecycle must preserve notification audit rows");
assert.match(center, /const unread = notifications\.filter\(\(item\) => !item\.is_read\)\.length/);
assert.match(center, /const total = workflowTotal \+ unread/);
assert.match(center, /fetch\("\/api\/notifications\?limit=20"/);

console.log("Notification lifecycle filtering and recipient-scope contract passed");
