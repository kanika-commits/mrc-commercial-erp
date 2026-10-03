import assert from "node:assert/strict";
import fs from "node:fs";

const lookup = fs.readFileSync("app/api/work-orders/create-lookups/route.ts", "utf8");
const suggest = fs.readFileSync("app/api/work-orders/suggest-number/route.ts", "utf8");
const create = fs.readFileSync("app/api/work-orders/create/route.ts", "utf8");
const preview = fs.readFileSync("app/api/work-orders/preview/route.ts", "utf8");

for (const source of [lookup, suggest, create, preview]) {
  assert.match(source, /organization_id/);
  assert.match(source, /(?:auth|access)\.sites/);
  assert.doesNotMatch(source, /site\.company_id\s*(?:!==|===|&&)/);
}

assert.match(lookup, /sites = sites\.in\("id", auth\.sites\)/);
assert.match(suggest, /company\.organization_id !== site\.organization_id/);
assert.match(create, /company\.organization_id !== site\.organization_id/);
assert.match(preview, /company\.organization_id !== site\.organization_id/);

const mrcTech = { company: "MRC Tech Solutions Pvt. Ltd.", site: "Railway Station, Jammu" };
assert.equal(mrcTech.site, "Railway Station, Jammu");

console.log("Work Order Pilot company-neutral site contract passed.");
