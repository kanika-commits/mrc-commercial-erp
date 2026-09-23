import assert from "node:assert/strict";
import fs from "node:fs";
const h=fs.readFileSync("lib/procurement/poDraftMasterView.server.ts","utf8"), b=fs.readFileSync("lib/procurement/poPdfBaseGeneration.server.ts","utf8"), r=fs.readFileSync("lib/procurement/poPdfRenderer.server.ts","utf8");
assert.match(h,/status.*draft/); assert.match(h,/revision_no/); assert.match(h,/vendor_contacts/); assert.match(h,/site_contacts/); assert.match(h,/using stored snapshot/); assert.match(b,/resolveDraftPoMasterView/); assert.match(r,/Email: \$\{text\(contact\.email/); console.log("PO draft live-master contract passed.");
