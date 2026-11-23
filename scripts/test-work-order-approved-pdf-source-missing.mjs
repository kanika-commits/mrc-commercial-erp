import assert from "node:assert/strict";
import fs from "node:fs";

const renderer = fs.readFileSync("lib/workOrderApprovedPdf.server.ts", "utf8");
const route = fs.readFileSync("app/api/work-orders/[id]/generated-pdf/route.ts", "utf8");
const forms = fs.readFileSync("app/work-orders/page.tsx", "utf8");

assert.doesNotMatch(renderer, /refusing to regenerate a different package/);
assert.match(renderer, /drive_sync_key === "pilot-reviewed-pdf"/);
assert.match(renderer, /!\["approved", "issued"\]\.includes\(String\(order\?\.approval_status/);
assert.match(route, /String\(order\.approval_status \|\| ""\)\.toLowerCase\(\) !== "approved"/);
assert.match(route, /renderApprovedWorkOrderPdfById\(admin, id\)/);
assert.match(forms, /isApprovedWorkOrder\(wo\)/);
assert.match(forms, /Official approved PDF/);
assert.match(forms, /\/api\/work-orders\/\$\{workOrder\.id\}\/generated-pdf/);
assert.match(forms, /Source attachments/);

console.log("Approved PDF source-missing regression passed");
