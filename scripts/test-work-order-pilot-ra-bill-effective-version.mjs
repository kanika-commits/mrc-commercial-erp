import fs from "node:fs";
import assert from "node:assert/strict";

const route = fs.readFileSync("app/api/work-orders/pilot-ra-bills/route.ts", "utf8");
const page = fs.readFileSync("app/forms/pilot/ra-bills/new/page.tsx", "utf8");

assert.match(route, /eq\("approval_status", "approved"\)/);
assert.match(route, /not\("creation_request_id", "is", null\)/);
assert.match(route, /in\("status", \["approved", "issued"\]\)/);
assert.match(route, /order\("revision_number", \{ ascending: false \}\)/);
assert.match(route, /effective_revision\?\.snapshot\?\.items \|\| data\.work_order_items/);
assert.match(route, /effective_revision_label: effective_revision \? `Revision/);
assert.match(route, /"Original approved Work Order"/);
assert.match(route, /const effectiveItems = order\.effective_items \|\| \[\]/);
assert.match(route, /revision_snapshot: order\.effective_revision \|\| \{ source: "original_approved_work_order"/);
const preview = fs.readFileSync("app/api/work-orders/pilot-ra-bills/[id]/preview/route.ts", "utf8");
assert.match(preview, /storedRevision\.id/);
assert.match(preview, /approved Pilot Work Order revision changed/);
assert.match(preview, /storedRevision\.id/);
assert.match(page, /order\.effective_items \|\| \[\]/);
assert.match(page, /Effective approved version/);
assert.match(page, /order\.effective_revision_label/);
assert.doesNotMatch(page, /Effective revision<\/small>.*Unavailable/);
console.log("Pilot RA Bill effective approved Work Order version contract passed");
