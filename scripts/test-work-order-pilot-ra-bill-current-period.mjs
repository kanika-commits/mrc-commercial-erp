import assert from "node:assert/strict";
import fs from "node:fs";
import { calculatePilotRaBill } from "../lib/workOrderPilotRaBill.ts";

const result = calculatePilotRaBill({
  items: [{ serial: "1", description: "Concrete", wo_qty: 100, unit: "m3", rate: 10, breakdowns: [{ id: "child-1", serial: "1.1", description: "Concrete Part 1", prior_cumulative_qty: 10, cumulative_qty: 15, current_qty: 5, release_percent: 1, previous_amount: 100 }] }],
  gst_percent: 0,
  security_cumulative: 0,
  previous_basic: 100,
});
assert.equal(result.items[0].cumulative_qty, 15);
assert.equal(result.items[0].breakdowns[0].cumulative_amount, 150);
assert.equal(result.items[0].breakdowns[0].current_amount, 50);
assert.equal(result.current_basic, 50);

const route = fs.readFileSync(new URL("../app/api/work-orders/pilot-ra-bills/route.ts", import.meta.url), "utf8");
assert.match(route, /child\.current_qty === undefined/);
assert.match(route, /priorQty \+ currentQty/);
assert.match(route, /current_qty: currentQty/);
console.log("Pilot RA Bill current-period breakdown separation passed.");
