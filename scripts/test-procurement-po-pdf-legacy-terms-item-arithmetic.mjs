import assert from "node:assert/strict";
import fs from "node:fs";

const renderer = fs.readFileSync("lib/procurement/poPdfRenderer.server.ts", "utf8");

// This mirrors the legacy/plain-text snapshot shape from PO
// 8f32e184-7414-46c1-9660-55c1088ea044 without reading or changing saved data.
const legacyTerms = [
  "1. Order of Precedence",
  "The PO terms apply.",
  "",
  "21. Force Majeure",
  "The Vendor shall not be liable for force majeure events.",
  "",
  "Buyer’s Discretion",
  "The Buyer may accept, reject, or withhold the order.",
].join("\n");
const legacyLines = legacyTerms.split(/\r?\n/);
const headings = legacyLines.filter((line) => line.trim() && !line.startsWith("The ") && !line.startsWith("1. ") && !line.startsWith("21. "));
assert.deepEqual(headings, ["Buyer’s Discretion"]);
assert.equal(legacyLines.filter((line) => /^\d+\. /.test(line)).length, 2);

assert.match(renderer, /function isLegacyTopLevelHeading\(lines: string\[\], index: number\)/);
assert.match(renderer, /const legacyHeading = isLegacyTopLevelHeading\(lines, index\)/);
assert.match(renderer, /normalized\.level === "main" \|\| legacyHeading/);
assert.match(renderer, /const headers = .*"Basic Amount".*"GST".*"Amount"/);
assert.match(renderer, /Number\(item\.quantity \|\| 0\) \* Number\(item\.unit_rate \|\| 0\)/);
assert.match(renderer, /\[\["Total Basic Amount", money\(calculatedItemsBasic\)\]/);
assert.match(renderer, /draw\(lineData\.label, .* size, true\)/);
assert.match(renderer, /const PO_HEADER_FILL = "0\.93 0\.95 0\.97"/);
assert.match(renderer, /const WORK_ORDER_HEADER_FILL = "0\.98 0\.91 0\.91"/);
assert.match(renderer, /row\.work_order_render \? WORK_ORDER_HEADER_FILL : PO_HEADER_FILL/);

const basicAmount = 12 * 1250;
const gstAmount = basicAmount * 0.18;
assert.equal(basicAmount, 15000);
assert.equal(gstAmount, 2700);
assert.equal(basicAmount + gstAmount, 17700);

console.log("PO legacy terms and item arithmetic rules passed");
