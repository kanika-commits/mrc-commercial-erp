import assert from "node:assert/strict";
import fs from "node:fs";

const pageSource = fs.readFileSync(new URL("../app/labour/workers/import/page.tsx", import.meta.url), "utf8");

assert.match(pageSource, /Import Completed ✓/, "completed import view must show one clear completion banner");
assert.match(pageSource, /Imported With Document Warnings/, "final row status must support document warning outcomes");
assert.match(pageSource, /Download Failed/, "failed document badges must show a safe user-facing failure message");
assert.match(pageSource, /entry\?\.original_file_name/, "document display must show original filename when available");
assert.match(pageSource, /rowMessage \? rowMessage\.replace/, "unmatched document badges must display the exact matching reason");
assert.match(pageSource, /documentSummary\(n, row, documentAccessChecked\)/, "results table must use a readable document summary");
assert.match(pageSource, /Worker Preview/, "page must show a worker preview before document access");
assert.match(pageSource, /Allow ConstructIQ to access and import the available worker documents from Google Drive\?/, "review page must use the shared direct document-access confirmation wording");
assert.match(pageSource, />Continue<\/button>/, "review page must expose the concise confirmation action");
assert.match(pageSource, /Checking worker documents\.\.\./, "document access must run behind a single checking state");
assert.match(pageSource, /Final Review/, "document-checked batches must show a final review");
assert.match(pageSource, /Import Results/, "completed batch must rename the table to Import Results");
assert.match(pageSource, /!importCompleted && <section className="grid gap-3 rounded-lg border bg-white p-4 shadow-sm/, "upload section must be hidden after import completes");
assert.match(pageSource, /hasMasterValues && !importCompleted && step === "mapping"/, "master mapping section must be hidden after import completes and outside mapping state");
assert.doesNotMatch(pageSource, /Refresh Review|Add Folder Link Manually|Folder verified|Document Links|Matched Docs|Documents Missing/, "technical folder and document-count controls must be removed from normal UI");
assert.match(pageSource, /Download Remaining Labour Workbook/, "completed view must offer remaining workbook download when applicable");
assert.match(pageSource, /async function downloadReport/, "protected report downloads must go through an authenticated client fetch");
assert.match(pageSource, /Authorization: `Bearer \$\{await token\(\)\}`/, "report download fetch must include the current auth token");
assert.match(pageSource, /filenameFromDisposition/, "report download should use the response filename when available");
assert.doesNotMatch(pageSource, /<a href=\{`\/api\/labour\/import\/report\?batch_id=\$\{batchId\}`\}/, "report links must not open the protected API without auth");
assert.match(pageSource, /Import Another Workbook/, "completed view must offer a new import action");
assert.match(pageSource, /Back to Labour Registration/, "completed view must offer return to registration");
assert.doesNotMatch(pageSource, /storage_bucket|storage_key|drive_file_id/, "Labour Import page must not expose storage paths or Drive IDs");

console.log("Labour import UI polish tests passed.");
