import assert from "node:assert/strict";
import fs from "node:fs";

const form = fs.readFileSync("app/work-orders/new/structured/page.tsx", "utf8");
const preview = fs.readFileSync("app/work-orders/new/structured/preview/page.tsx", "utf8");
const route = fs.readFileSync("app/api/work-orders/preview/route.ts", "utf8");

assert.match(form, /useEffect\(\(\) => \{\s*if \(!explicitlyResuming\) clearWorkOrderPilotDraft\(\);/);
assert.doesNotMatch(form, /if \(!explicitlyResuming\) clearWorkOrderPilotDraft\(\);\s*const preservedPreviewDraft/);
assert.match(form, /const pdfBase64 = typeof result\.pdf_base64 === "string"/);
assert.match(form, /preview response did not contain a PDF/);
assert.match(form, /setWorkOrderPilotDraft\(\{ form, keyTerms, lines, supportingDocuments, payload, previewUrl:/);
assert.match(form, /router\.push\("\/work-orders\/new\/structured\/preview"\)/);
assert.match(preview, /getWorkOrderPilotDraft/);
assert.match(preview, /src=\{revisionPreviewUrl \|\| draft\?\.previewUrl/);
assert.match(preview, /from=preview/);
assert.match(route, /return NextResponse\.json\(\{ pdf_base64:/);
assert.match(route, /persisted: false/);
console.log("Pilot Work Order preview flow contract: PASS");
