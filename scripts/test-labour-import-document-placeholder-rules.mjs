import assert from "node:assert/strict";
import fs from "node:fs";

const importLib = fs.readFileSync(new URL("../lib/labour/import.ts", import.meta.url), "utf8");
const validateSource = fs.readFileSync(new URL("../app/api/labour/import/validate/route.ts", import.meta.url), "utf8");
const pageSource = fs.readFileSync(new URL("../app/labour/workers/import/page.tsx", import.meta.url), "utf8");
const executeSource = fs.readFileSync(new URL("../app/api/labour/import/execute/route.ts", import.meta.url), "utf8");

assert.match(importLib, /export function labourImportDocumentReferenceValue/, "document reference placeholder normalization must be shared");
assert.match(importLib, /"N\/A"/, "N/A must be treated as not provided");
assert.match(importLib, /"NOT AVAILABLE"/, "Not Available must be treated as not provided");
assert.match(importLib, /"NOT APPLICABLE"/, "Not Applicable must be treated as not provided");
assert.match(importLib, /"\-", "--"/, "dash placeholders must be treated as not provided");

assert.match(validateSource, /verifyDriveDocument\(link, label\)/, "provided Drive file links must be verified directly");
assert.match(validateSource, /warnings\.push\(error\.message \|\| `\$\{label\} could not be verified\.`\)/, "optional direct-link document failures must become warnings");
assert.match(validateSource, /warnings\.push\(`\$\{label\}: "\$\{filename\}" is not a Google Drive file link\.`\)/, "non-link document references must become direct-link warnings");
assert.match(validateSource, /warnings\.push\(\.\.\.documentWarnings\)/, "document warnings must not be merged into blocking errors");
assert.match(validateSource, /documentReferenceValue\(normalized, field, filenameField\)\)\.filter\(Boolean\)/, "document link counts must exclude placeholders");
assert.match(validateSource, /provide matched Aadhaar Front and Back documents or a matched Combined Aadhaar document/, "Aadhaar mandatory rule must require matched documents");

assert.match(pageSource, /function documentReferenceValue\(\.\.\.values: unknown\[\]\)/, "preview must share the placeholder concept for document rows");
assert.match(pageSource, /hasPlaceholderDocumentReference/, "preview must render explicit placeholders as neutral not-provided badges");
assert.match(pageSource, /"Not Provided"/, "placeholder document values must display as Not Provided");
assert.match(pageSource, /row\.validation_status === "ready" \|\| row\.validation_status === "warning"/, "Ready summary must count warning rows with no blocking errors");
assert.match(pageSource, /document\.status === "not_provided"/, "not-provided document badges must use neutral styling");
assert.doesNotMatch(pageSource, /Paste the Google Drive folder link/, "placeholder handling must not require a folder link");

assert.match(executeSource, /if \(!sourceLink && !entry\) return null;/, "execution must skip missing optional documents");
assert.match(executeSource, /document_import_warnings/, "execution must record optional document import warnings");
assert.match(executeSource, /createPrivateStorageAdapter/, "matched documents must still be copied into private Supabase storage");

console.log("Labour import document placeholder rules passed.");
