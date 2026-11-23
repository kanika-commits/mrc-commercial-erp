import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/work-orders/page.tsx", "utf8");
const route = fs.readFileSync("app/api/work-orders/register/route.ts", "utf8");

assert.match(page, /type SortField = [^;]*"created_at"/);
assert.match(page, /useState<SortField>\("created_at"\)/);
assert.match(page, /useState<SortDirection>\("desc"\)/);
assert.match(page, /<option value="created_at">Created At<\/option>/);
assert.match(page, /sort_field: sortField/);
assert.match(route, /case "created_at":\s*return query\.order\("created_at", \{ ascending \}\)\.order\("id", \{ ascending \}\);/s);
assert.doesNotMatch(route, /case "created_at"[\s\S]{0,180}approval_status/);

console.log("Work Order Created At descending default sort contract passed.");
