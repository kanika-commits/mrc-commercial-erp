import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/forms/pilot/ra-bills/new/page.tsx", "utf8");
const formulas = fs.readFileSync("lib/workOrderPilotRaBill.ts", "utf8");

assert.match(page, /remarks: r\.breakdowns\.length \? undefined : r\.remarks/);
assert.match(page, /row\.breakdowns\.length \? "—" : <input/);
assert.match(page, /child\.remarks/);
assert.match(page, /releaseDisplay\(result\.release_percent\)/);
assert.match(formulas, /const weighted = children\.length/);
assert.match(page, /hydratedSavedId/);
assert.match(page, /await attachmentRef\.current\?\.flush\(d\.bill\.id\)/);
assert.match(page, /setRows\(\[\]\)/);
assert.match(page, /action === "submit"/);

console.log("Pilot RA Bill remarks, weighted release display, preview preservation, and submission reset contract passed");
