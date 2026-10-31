import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/work-orders/pilot-ra-bills/route.ts", "utf8");
const form = fs.readFileSync("app/forms/pilot/ra-bills/new/page.tsx", "utf8");
assert.match(route, /release percentage.*executed quantity is 0/i);
assert.match(route, /child\.cumulative_qty <= 0 && child\.release_percent > 0/);
assert.match(form, /release percentage must be 0 when current executed quantity is 0/i);
assert.match(form, /suggestedPart\(r\.description/);
assert.match(form, /isSuggestedPart/);
assert.match(form, /field === "cumulative_qty" && num\(value\) <= c\.prior_cumulative_qty/);
console.log("Pilot RA Bill breakdown guard contract passed.");
