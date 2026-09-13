import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/purchase/purchase-order-approvals/page.tsx", "utf8");
const api = fs.readFileSync("app/api/procurement/purchase-order-approvals/route.ts", "utf8");
assert.match(page, /isRevision/);
assert.match(page, /Revision: R-/);
assert.match(page, /Previous: \{row\.previous\.po_number\}/);
assert.match(page, /Review/);
assert.match(api, /revision_no/);
assert.match(api, /previous_revision_id/);
assert.doesNotMatch(api, /procurement_po_revision_previous_fk/);
assert.match(api, /previousIds/);
assert.match(api, /previousById/);
console.log("PO approval revision display rules: PASS");
