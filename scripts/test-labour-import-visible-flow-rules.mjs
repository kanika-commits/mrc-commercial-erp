import assert from "node:assert/strict";
import fs from "node:fs";

const pageSource = fs.readFileSync(new URL("../app/labour/workers/import/page.tsx", import.meta.url), "utf8");
const validateSource = fs.readFileSync(new URL("../app/api/labour/import/validate/route.ts", import.meta.url), "utf8");

assert.match(
  pageSource,
  /type ImportStep = "upload" \| "mapping" \| "preview" \| "permission" \| "checking" \| "review" \| "importing" \| "completed"/,
  "Labour Import must use the approved visible-flow state machine"
);
assert.match(pageSource, /Upload & Preview/, "flow starts with Upload Excel");
assert.match(pageSource, /Save Mapping & Continue/, "mapping stage must continue into preview");
assert.match(pageSource, /Worker Preview/, "worker preview stage must exist before document access");
assert.match(
  pageSource,
  /Allow ConstructIQ to access and import the available worker documents from Google Drive\?/,
  "permission stage must use approved direct-link user-facing copy"
);
assert.match(pageSource, /Checking worker documents\.\.\./, "checking stage must show a clear processing state");
assert.match(pageSource, /Final Review/, "document-checked batches must move to final review");
assert.match(pageSource, /Confirm Import/, "final review must be the only normal import confirmation stage");
assert.match(pageSource, /Import Completed ✓/, "completed stage must show one clear completion view");

assert.match(pageSource, /setBatchId\(""\)/, "fresh upload must reset stale batch state");
assert.match(pageSource, /setPreview\(\{ rows: \[\], batch: null \}\)/, "fresh upload must reset stale preview rows");
assert.doesNotMatch(pageSource, /\/api\/labour\/import\/folder/, "document access must not call folder verification for direct-link workbooks");
assert.match(pageSource, /setStep\("checking"\)/, "permission Continue must transition to checking");
assert.match(pageSource, /const validation = await validateBatch\(batchId\)/, "permission Continue must validate direct document links");
assert.doesNotMatch(pageSource, /Paste the Google Drive folder link/, "permission stage must not request a folder source");
assert.match(pageSource, /disabled=\{!batchId \|\| Boolean\(busy\)\}/, "Continue must only be disabled for missing batch or active request");
assert.match(pageSource, /setStep\("review"\)/, "successful folder verification must transition to final review");
assert.doesNotMatch(pageSource, /if \(!folderUrl\.trim\(\)\) \{[\s\S]{0,220}setMessage/, "permission Continue must not show missing-source from stale local state");
assert.match(pageSource, /\["ready", "warning"\]\.includes\(row\.validation_status\)/, "warning rows must remain importable while blocked rows are skipped");
assert.match(pageSource, /documentRows\(n, row, documentAccessChecked, preAccess\)/, "document badges must distinguish pre-access and checked states");
assert.match(pageSource, /Pending access/, "pre-access document filenames must not pretend to be verified");
assert.match(pageSource, /Not Provided/, "placeholder document cells must remain visible as not provided");
assert.match(pageSource, /rowMessage \? rowMessage\.replace/, "visible document badges must use the precise row-level validation reason");
assert.match(validateSource, /is not a Google Drive file link\./, "non-link document references must produce direct-link validation wording");

assert.doesNotMatch(
  pageSource,
  /Add Folder Link Manually|Refresh Review|Folder verified|Document Links|Matched Docs|Documents Missing/,
  "removed technical folder and duplicate document-summary UI must not be visible in the normal flow"
);
assert.doesNotMatch(pageSource, /storage_bucket|storage_key|drive_file_id/, "visible flow must not expose storage paths or Drive IDs");

console.log("Labour import visible flow tests passed.");
