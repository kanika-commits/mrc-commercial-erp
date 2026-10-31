import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile("app/forms/pilot/ra-bills/new/page.tsx", "utf8");
const formulas = await readFile("lib/workOrderPilotRaBill.ts", "utf8");
const persistence = await readFile("app/api/work-orders/pilot-ra-bills/route.ts", "utf8");

assert.match(page, /row\.breakdowns\.length \? \(result\?\.cumulative_qty/);
assert.match(page, /aria-label=\{`\$\{row\.serial\} cumulative quantity`\}/);
assert.match(page, /aria-label=\{`\$\{row\.serial\} release percent`\}/);
assert.match(page, /cumulative_qty: r\.breakdowns\.length \? undefined : r\.prior_cumulative_qty \+ currentQty/);
assert.match(page, /release_percent: r\.breakdowns\.length \? undefined : r\.release_percent/);
assert.match(page, /const children = remaining\.map/);
assert.match(page, /const target = r\.breakdowns\.find/);
assert.match(formulas, /const children = item\.breakdowns \|\| \[\]/);
assert.match(persistence, /submitted\?\.breakdowns/);
console.log("Pilot RA Bill direct parent entry and breakdown transition contract passed");
