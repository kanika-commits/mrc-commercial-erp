import assert from "node:assert/strict";
import fs from "node:fs";

const renderer = fs.readFileSync("lib/workOrderPdfRenderer.server.ts", "utf8");
assert.match(renderer, /const formatPdfTimestamp =/);
assert.match(renderer, /timeZone: "Asia\/Kolkata"/);
assert.match(renderer, /hour12: false/);
assert.match(renderer, /formatPdfTimestamp\(row\.created_at\)/);
assert.match(renderer, /formatPdfTimestamp\(row\.approved_at\)/);

const utc = new Date("2026-11-02T14:37:25.000Z");
const india = utc.toLocaleString("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
assert.equal(india, "02 Nov 2026, 20:07");

console.log("Work Order PDF UTC-to-India timestamp formatting passed.");
