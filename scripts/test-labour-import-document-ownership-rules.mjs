import assert from "node:assert/strict";
import fs from "node:fs";

const executeSource = fs.readFileSync(new URL("../app/api/labour/import/execute/route.ts", import.meta.url), "utf8");
const validateSource = fs.readFileSync(new URL("../app/api/labour/import/validate/route.ts", import.meta.url), "utf8");
const pageSource = fs.readFileSync(new URL("../app/labour/workers/import/page.tsx", import.meta.url), "utf8");
const workerDocumentApi = fs.readFileSync(new URL("../app/api/labour/workers/[id]/documents/route.ts", import.meta.url), "utf8");
const labourImportLib = fs.readFileSync(new URL("../lib/labour/import.ts", import.meta.url), "utf8");

assert.match(executeSource, /downloadDriveFile\({[\s\S]+maxSizeBytes: 10 \* 1024 \* 1024/, "execution must download Drive files server-side with a size limit");
assert.match(executeSource, /for \(const row of rows \|\| \[\]\)/, "Labour Import executes registration rows sequentially so Labour Code generation does not race within a batch");
assert.doesNotMatch(executeSource, /Promise\.all\(\(rows \|\| \[\]\)/, "Labour Import must not register all rows concurrently");
assert.match(executeSource, /Buffer\.from\(driveFile\.base64, "base64"\)/, "execution must convert Drive file content to a server-side buffer");
assert.match(executeSource, /new File\(\[buffer\], fileName/, "execution must feed the existing storage adapter a File-like upload");
assert.match(executeSource, /createPrivateStorageAdapter\(access\.admin\)/, "execution must reuse the private storage adapter");
assert.match(executeSource, /bucket: LABOUR_DOCUMENT_BUCKET/, "execution must upload into the canonical private Labour documents bucket");
assert.match(executeSource, /storage_provider: object\.provider/, "imported labour documents must store the Supabase provider, not Google Drive as operational storage");
assert.match(executeSource, /storage_bucket: object\.bucket/, "imported labour documents must store the private bucket");
assert.match(executeSource, /storage_key: object\.key/, "imported labour documents must store the private object key");
assert.match(executeSource, /original_source_url/, "imported labour documents must retain the original Drive link as metadata only");
assert.match(executeSource, /import_source_filename: entry\.source_filename \|\| entry\.display_name \|\| null/, "execution must retain Excel hyperlink visible text as source filename metadata");
assert.match(executeSource, /document_import_warnings/, "document failures must be preserved as row-level import warnings");
assert.match(executeSource, /catch \(error: any\) \{[\s\S]+warnings\.push/, "optional document failures must not abort a successful worker import");
assert.match(executeSource, /document_warnings: documentWarnings\.length/, "audit must include document warning counts");
assert.doesNotMatch(executeSource, /storage_provider: entry\.storage_provider \|\| "google_drive"/, "execution must not leave imported documents Drive-backed");

assert.match(validateSource, /downloadDriveFile/, "validation must continue verifying Drive accessibility before execution");
assert.match(validateSource, /verifyDriveDocument\(link, label\)/, "validation must verify direct per-row Drive file links");
assert.match(validateSource, /const displayName = labourImportDocumentReferenceValue/, "validation must preserve Excel hyperlink visible text as the document display name");
assert.match(validateSource, /source_filename: filename \|\| null/, "validation manifest must keep the visible filename separate from the Drive source URL");
assert.match(validateSource, /is not a Google Drive file link\./, "non-link document references must not require folder matching");
assert.match(validateSource, /document_type: documentType/, "validation manifest must preserve final Labour document category");
assert.match(labourImportLib, /LABOUR_IMPORT_DOCUMENT_FIELDS/, "Labour import document fields must be shared by validation and execution");
assert.match(labourImportLib, /filenameField: "photo_filename"/, "shared document fields include filename columns");
assert.match(labourImportLib, /isGoogleDriveFileLink\(normalized\[filenameField\]\)/, "legacy filename columns containing Drive URLs must stay attached to the same row as direct links");
assert.match(labourImportLib, /pan_drive_url/, "optional PAN document links are parsed");
assert.match(labourImportLib, /bank_proof_drive_url/, "optional Bank Proof document links are parsed");
assert.match(labourImportLib, /other_document_drive_url/, "optional Other document links are parsed");

assert.match(pageSource, /shortLabel: "Photo"/, "preview must include Photo document status badges");
assert.match(pageSource, /document\.status === "accessible"/, "preview must show accessible document status per row");
assert.match(pageSource, /document\.status === "not_provided"/, "preview must keep placeholder documents visibly separate");
assert.match(pageSource, /labelizeStatus\(document\.status\)/, "preview must render precise document issue statuses");
assert.match(pageSource, /documentRows\(n, row, documentAccessChecked, preAccess\)/, "preview must switch document status messaging after document access");

assert.match(workerDocumentApi, /createSignedReadUrl/, "manual/open document path still serves private storage via signed URLs");
assert.match(workerDocumentApi, /storage_provider: object\.provider/, "manual Labour document upload remains Supabase-backed");

console.log("Labour import document ownership tests passed.");
