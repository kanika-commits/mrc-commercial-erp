import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/purchase/purchase-orders/new/page.tsx", "utf8");

assert.match(page, /FIXED_KEY_TERM_HEADINGS = \["Price Validity", "Freight", "Delivery Timeline", "Payment Terms"\]/);
assert.match(page, /function normalizeSavedKeyTerms\(savedTerms: any\[\]\)/);
assert.match(page, /term\.description\.trim\(\)\.toLowerCase\(\) === heading\.toLowerCase\(\)/);
assert.match(page, /index === headingIndex && !term\.description\.trim\(\)/);
assert.match(page, /return \[\.\.\.fixed, \.\.\.saved\.filter\(\(_, index\) => !used\.has\(index\)\)\]/);
assert.match(page, /setKeyTerms\(normalizeSavedKeyTerms\(po\.commercial_snapshot\?\.key_terms \|\| \[\]\)\)/);
assert.match(page, /keyTerms\.map\(normalizeKeyTerm\)/);
assert.match(page, /useState<KeyTerm\[\]>\(FIXED_KEY_TERM_HEADINGS\.map/);

for (const heading of ["Price Validity", "Freight", "Delivery Timeline", "Payment Terms"]) {
  assert.match(page, new RegExp(`\\\"${heading}\\\"`));
}
assert.match(page, /index < 4 \? <span[^>]*>\{term\.description\}<\/span> : <input/);
assert.match(page, /<textarea value=\{term\.terms\}/);
assert.match(page, /setKeyTerms\(\(current\) => \[\.\.\.current, \{ description: "", terms: "" \}\]\)/);
assert.match(page, /index >= 4 &&/);
assert.match(page, /key_terms: keyTerms\.map\(normalizeKeyTerm\)/);

console.log("PO Key Terms form rules: PASS");
