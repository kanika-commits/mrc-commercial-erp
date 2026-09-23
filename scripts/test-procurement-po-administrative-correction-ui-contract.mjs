import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/purchase/purchase-orders/[id]/page.tsx", "utf8");

assert.match(page, /ADMINISTRATIVE_CORRECTION_PO_ID = "a2bff8a1-0dc0-4a33-a3e4-65c034ddc8ac"/);
assert.match(page, /row\.po_number !== "GLC\/SEP\/2026\/0020\/R-0"/);
assert.match(page, /hasGlobalAccess\(access\) \|\| access\?\.roleCodes\.includes\("super_admin"\)/);
assert.match(page, /supabase\.auth\.getSession\(\)/);
assert.match(page, /Authorization: `Bearer \$\{session\.access_token\}`/);
assert.doesNotMatch(page, /console\.(log|info|debug).*access_token/);
assert.match(page, /method: "POST"/);
assert.match(page, /\/administrative-correction/);
assert.match(page, /"B\.K JHA"/);
assert.match(page, /"9311088865"/);
assert.match(page, /"becin@becconduits\.in"/);
assert.match(page, /"Sales Manager"/);
assert.match(page, /ADMINISTRATIVE_CORRECTION_IDEMPOTENCY_KEY/);
assert.match(page, /2c713c13-3e99-4413-9b16-9ca8daae2f3a/);
assert.match(page, /if \(!response\.ok\) throw new Error\(result\.error/);
assert.doesNotMatch(page, /setTimeout\(.*administrative|retry.*administrative/i);
assert.match(page, /Apply Vendor Contact Correction/);
console.log("PASS: targeted administrative correction UI contract");
