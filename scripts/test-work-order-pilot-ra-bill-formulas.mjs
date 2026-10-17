import assert from "node:assert/strict";
import { calculatePilotRaBill, validatePilotRaBill } from "../lib/workOrderPilotRaBill.ts";
const result = calculatePilotRaBill({ gst_percent: 18, security_cumulative: 50, previous_basic: 100, previous_gst: 18, previous_security: 20, items: [{ serial: "1", description: "Parent", wo_qty: 10, unit: "sqm", rate: 100, breakdowns: [{ serial: "1.1", description: "A", cumulative_qty: 4, release_percent: 0.5 }, { serial: "1.2", description: "B", cumulative_qty: 6, release_percent: 1 }] }] });
assert.equal(result.items[0].cumulative_qty, 10); assert.equal(result.cumulative_basic, 800); assert.equal(result.cumulative_gst, 144); assert.equal(result.current_basic, 700); assert.equal(result.current_net_payable, 796); assert.ok(validatePilotRaBill(result, 100).length > 0);
console.log("Pilot RA Bill formula and breakdown regression passed.");
