import assert from "node:assert/strict";
import fs from "node:fs";

const editor = fs.readFileSync("app/purchase/purchase-orders/new/page.tsx", "utf8");
assert.match(editor, /revisionNo/);
assert.match(editor, /revisionIdentityRef/);
assert.match(editor, /identity\?\.source/);
assert.match(editor, /identity\?\.companyId/);
assert.match(editor, /identity\?\.siteId/);
assert.match(editor, /identity\?\.vendorId/);
assert.match(editor, /identity\?\.requisitionId/);
assert.match(editor, /Revision identity/);
assert.match(editor, /control\.disabled = true/);
assert.match(editor, /aria-readonly/);
assert.match(editor, /vendorIndex/);
assert.match(editor, /item\.quantity/);
assert.match(editor, /item\.unit_rate/);
console.log("PO revision UI field-lock rules: PASS");
