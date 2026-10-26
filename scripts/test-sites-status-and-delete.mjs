import assert from "node:assert/strict";
import fs from "node:fs";

const api = fs.readFileSync("app/api/sites/[id]/route.ts", "utf8");
const page = fs.readFileSync("app/sites/page.tsx", "utf8");
const lookup = fs.readFileSync("app/api/procurement/purchase-orders/lookups/route.ts", "utf8");
const workOrderLookup = fs.readFileSync("app/api/work-orders/create-lookups/route.ts", "utf8");

assert.match(api, /assertSitePermission\(request, "delete"\)/);
assert.match(api, /error\?\.code === "23503"/);
assert.match(api, /status: 409/);
assert.match(api, /Deactivate it instead to preserve history and assignments/);
assert.doesNotMatch(api, /user_access_assignments[\s\S]+\.delete\(\)/);
assert.match(api, /export async function PATCH/);
assert.match(api, /assertSitePermission\(request, "edit"\)/);
assert.match(api, /status !== "active" && status !== "inactive"/);
assert.match(api, /\.update\(\{ status \}\)/);
assert.match(api, /Linked history and assignments were preserved/);

assert.match(page, /window\.confirm/);
assert.match(page, /Linked history and assignments will be preserved/);
assert.match(page, /method: "PATCH"/);
assert.match(page, /Deactivate/);
assert.match(page, /Reactivate/);
assert.match(page, /canEditSites/);

assert.match(lookup, /from\("sites"\)[\s\S]+\.eq\("status", "active"\)/);
assert.match(workOrderLookup, /from\("sites"\)[\s\S]+\.eq\("status", "active"\)/);

console.log("Site status and deletion contract checks passed.");
