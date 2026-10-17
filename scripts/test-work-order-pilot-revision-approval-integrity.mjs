import fs from "node:fs";
import assert from "node:assert/strict";

const queue = fs.readFileSync("app/api/approvals/work-order-pilot-revisions/route.ts", "utf8");
const page = fs.readFileSync("app/approvals/work-orders/page.tsx", "utf8");
const action = fs.readFileSync("app/api/work-orders/[id]/revisions/[revisionId]/route.ts", "utf8");
const preview = fs.readFileSync("app/api/work-orders/[id]/revisions/[revisionId]/preview/route.ts", "utf8");

assert.match(queue, /eq\("status", "submitted"\)/);
assert.match(queue, /not\("work_orders\.creation_request_id", "is", null\)/);
assert.match(queue, /work_order_pilot_revisions/);
assert.match(page, /Review revised PDF/);
assert.match(page, /loadPilotRevision/);
assert.match(page, /revisions\/\$\{revision\.id\}\/preview/);
assert.match(page, /Approve revision/);
assert.match(page, /Send back/);
assert.match(page, /Send-back comment/);
assert.doesNotMatch(queue, /created_by_name|created_by_email/);
assert.match(action, /sha256\(bytes\)/);
assert.match(action, /bytes\.length !== Number\(artifact\.byte_length\)/);
assert.match(action, /A different reviewed PDF already exists/);
assert.match(preview, /sha256\(bytes\)/);
assert.match(preview, /Return to edit and generate a fresh review/);
assert.match(preview, /Content-Length/);
console.log("Pilot revision approval queue and exact PDF integrity contract passed");
