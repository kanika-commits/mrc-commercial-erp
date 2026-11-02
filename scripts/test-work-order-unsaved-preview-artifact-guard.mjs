import assert from "node:assert/strict";
import fs from "node:fs";

const create = fs.readFileSync("app/api/work-orders/create/route.ts", "utf8");
const preview = fs.readFileSync("app/api/work-orders/preview/route.ts", "utf8");

assert.match(create, /const draftOnly = body\.draft_only === true/);
assert.match(create, /if \(!draftOnly && request\.headers\.get\("content-type"\).*reviewedPdfBase64/);
assert.match(create, /if \(!draftOnly && !reviewedDocument\)/);
assert.match(preview, /persisted: false/);
assert.doesNotMatch(preview, /reviewed_pdf_base64/);

console.log("Unsaved Work Order preview does not require a reviewed artifact; reviewed guard retained.");
