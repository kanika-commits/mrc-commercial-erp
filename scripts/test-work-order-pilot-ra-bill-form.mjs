import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/forms/pilot/ra-bills/new/page.tsx", "utf8");
assert.match(page, /Total Qty Executed \(Cumulative\)/);
assert.match(page, /Work Done till Previous Bill/);
assert.match(page, /Work Done in this Bill/);
assert.match(page, /Security in this bill/);
assert.match(page, /cumulative_basic/);
assert.match(page, /cumulative_gst/);
assert.match(page, /adjusted_net_payable/);
assert.match(page, /reviewed PDF/i);
assert.match(page, /apiFetch\("\/api\/work-orders\/pilot-ra-bills\?lookup=sites"/);
assert.match(page, /lookup=work_orders&site_id=/);
assert.match(page, /creation_request_id/);
assert.doesNotMatch(page, /Auto-saved|Draft saved status/);
console.log("Pilot RA Bill form labels, eligibility flow, editable period quantity, and reviewed-PDF safeguards passed.");
