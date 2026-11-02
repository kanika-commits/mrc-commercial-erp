import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/work-orders/page.tsx", "utf8");
const reviewedRoute = fs.readFileSync("app/api/work-orders/[id]/generated-pdf/route.ts", "utf8");

assert.match(page, /function loadDraftPackage\(workOrder: WorkOrder\)/);
assert.match(page, /\/api\/work-orders\/drafts\/\$\{encodeURIComponent\(workOrder\.id\)\}\/preview/);
assert.match(page, /isDraft = String\(wo\.approval_status \|\| ""\)\.toLowerCase\(\) === "draft"/);
assert.match(page, /isDraft \? loadDraftPackage\(wo\) : loadReviewedPackage\(wo\)/);
assert.match(page, /No supporting documents/);
assert.match(reviewedRoute, /pilot-reviewed-pdf/);

console.log("Work Order draft register documents check passed");
