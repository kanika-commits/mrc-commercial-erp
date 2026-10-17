import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/purchase/purchase-orders/new/page.tsx", "utf8");
const fixed = ["Price Validity", "Freight", "Delivery Timeline", "Payment Terms"];
for (const heading of fixed) assert.match(page, new RegExp(`description: "${heading}"`), `missing ${heading} form term`);
assert.match(page, /keyTerms\.map\(\(term, index\)/);
assert.match(page, /key_terms: keyTerms\.map\(normalizeKeyTerm\)/);
assert.match(page, /normalizeSavedKeyTerms\(po\.commercial_snapshot\?\.key_terms\)/);
assert.match(page, /setAdditionalCharges\(Array\.isArray\(po\.commercial_snapshot\?\.additional_charges\)/);
console.log("PO key-term form regression passed.");
