import assert from "node:assert/strict";
import fs from "node:fs";

const form = fs.readFileSync("app/work-orders/new/structured/page.tsx", "utf8");
const preview = fs.readFileSync("app/work-orders/new/structured/preview/page.tsx", "utf8");
const previewRoute = fs.readFileSync("app/api/work-orders/preview/route.ts", "utf8");
const createRoute = fs.readFileSync("app/api/work-orders/create/route.ts", "utf8");
const renderer = fs.readFileSync("lib/workOrderPdfRenderer.server.ts", "utf8");

// Draft clearing must happen after the initial route render, so the preview
// transition cannot clear the values just before the preview page reads them.
assert.match(form, /useEffect\(\(\) => \{\s*if \(!explicitlyResuming\) clearWorkOrderPilotDraft\(\);/);
assert.doesNotMatch(form, /if \(!explicitlyResuming\) clearWorkOrderPilotDraft\(\);\s*const preservedPreviewDraft/);
assert.match(form, /const pdfBase64 = typeof result\.pdf_base64 === "string"/);
assert.match(form, /preview response did not contain a PDF\. Your form values were kept/);
assert.match(form, /setMessage\(e\.message\)/);
assert.match(form, /setWorkOrderPilotDraft\(\{ form, keyTerms, lines, supportingDocuments, payload, previewUrl:/);
assert.match(form, /router\.push\("\/work-orders\/new\/structured\/preview"\)/);

// Daily Wage has its people-based table and optional key-term controls. Other
// types retain the same controls with required Inclusions/Exclusions.
assert.match(form, /form\.wo_type === "Daily Wage"[\s\S]+data-testid="daily-wage-items"/);
assert.match(form, /<section className="rounded-2xl border bg-white p-5">[\s\S]+Inclusions\{form\.wo_type !== "Daily Wage" \? " \*" : ""\}/);
assert.match(form, /required=\{form\.wo_type !== "Daily Wage"\}/);
assert.match(form, /form\.wo_type !== "Daily Wage" && \(!keyTerms\.inclusions\[0\]\.trim\(\) \|\| !keyTerms\.exclusions\[0\]\.trim\(\)\)/);

// Preview/create accept both blank and entered optional Daily Wage terms.
assert.match(previewRoute, /const keyTerms = \[/);
assert.match(createRoute, /if \(woType !== "Daily Wage" && \(inclusions\.length < 1 \|\| exclusions\.length < 1\)\)/);
assert.match(renderer, /const keyTermRowsForPdf = normalizeKeyTerms\(row\.work_order_key_terms\)/);
assert.match(renderer, /if \(!isDailyWage \|\| keyTermRowsForPdf\.length\)/);
assert.match(preview, /from=preview/);

console.log("Work Order Pilot form state and Daily Wage UI contract passed");
