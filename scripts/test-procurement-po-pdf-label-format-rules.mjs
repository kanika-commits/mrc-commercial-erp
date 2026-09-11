import fs from "node:fs";
import assert from "node:assert/strict";

const pdf = fs.readFileSync("app/api/procurement/purchase-orders/[id]/pdf/route.ts", "utf8");

assert.match(pdf, /const labeledTable = \(cells: string\[\], widths: number\[\], size = 9\)/);
assert.match(pdf, /const match = logicalLine\.match\(\/\^\(\[\^:\]\+:\\s\*\)\(\.\*\)\$\/\)/);
assert.match(pdf, /draw\(lineData\.label, .* size, true\)/);
assert.match(pdf, /draw\(lineData\.value, .* size, false\)/);
assert.match(pdf, /const labelValueGap = 4/);
assert.match(pdf, /labelWidth \+ \(lineData\.label \? labelValueGap : 0\)/);
assert.match(pdf, /labeledTable\(\[/);
assert.match(pdf, /addressTable\(\[/);
assert.match(pdf, /Vendor Name:/);
assert.match(pdf, /Purchase Order No:/);
assert.match(pdf, /Site \/ Location:/);
assert.doesNotMatch(pdf, /company-specific|GLC|MRC Infracon|Pushpa Infracon/);

console.log("PO PDF label formatting rules passed.");
