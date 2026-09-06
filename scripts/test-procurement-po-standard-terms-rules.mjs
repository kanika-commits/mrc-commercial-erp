import assert from "node:assert/strict";
import fs from "node:fs";

const helper = fs.readFileSync("lib/procurement/standardTerms.ts", "utf8");
const detail = fs.readFileSync("app/purchase/purchase-orders/[id]/page.tsx", "utf8");
const pdf = fs.readFileSync("app/api/procurement/purchase-orders/[id]/pdf/route.ts", "utf8");

assert.match(helper, /JSON\.parse\(text\)/);
assert.match(helper, /Array\.isArray\(parsed\.clauses\)/);
assert.match(helper, /sort_order/);
assert.match(helper, /return \{ kind: "text", text \}/);
assert.match(detail, /parsePurchaseOrderStandardTerms/);
assert.match(detail, /standardTerms\.kind === "structured"/);
assert.match(pdf, /parsePurchaseOrderStandardTerms/);
assert.match(pdf, /parsedTerms\.kind === "structured"/);
console.log("PO standard terms rules passed");
