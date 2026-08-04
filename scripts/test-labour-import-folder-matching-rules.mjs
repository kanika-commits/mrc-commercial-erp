import assert from "node:assert/strict";
import fs from "node:fs";

const validateSource = fs.readFileSync(new URL("../app/api/labour/import/validate/route.ts", import.meta.url), "utf8");
const folderRoute = fs.readFileSync(new URL("../app/api/labour/import/folder/route.ts", import.meta.url), "utf8");
const executeSource = fs.readFileSync(new URL("../app/api/labour/import/execute/route.ts", import.meta.url), "utf8");
const pageSource = fs.readFileSync(new URL("../app/labour/workers/import/page.tsx", import.meta.url), "utf8");
const importLib = fs.readFileSync(new URL("../lib/labour/import.ts", import.meta.url), "utf8");

assert.match(importLib, /photo_filename/, "workbook photo filename column must be parsed");
assert.match(importLib, /aadhaar_front_filename/, "workbook Aadhaar front filename column must be parsed");
assert.match(importLib, /aadhaar_back_filename/, "workbook Aadhaar back filename column must be parsed");
assert.match(importLib, /aadhaar_combined_filename/, "workbook combined Aadhaar filename column must be parsed");

assert.doesNotMatch(pageSource, /\/api\/labour\/import\/folder/, "permission Continue must not call folder verification for direct-link workbooks");
assert.match(pageSource, /const validation = await validateBatch\(batchId\)/, "permission Continue must validate direct document links");
assert.match(folderRoute, /payload\.folder_url \|\| source\.folder_url/, "folder verification must reuse workbook-detected folder URLs after confirmation");
assert.match(folderRoute, /extractGoogleDriveFolderId\(folderUrl\)/, "folder verification must validate a Google Drive folder URL");
assert.match(folderRoute, /listDriveFolderFiles\(\{ folderId \}\)/, "folder verification must use the shared Drive folder listing helper");
assert.match(folderRoute, /normalizeLabourImportFilename\(file\.file_name\)/, "folder verification must normalize filenames");
assert.match(folderRoute, /duplicate_filenames/, "folder verification must detect duplicate filenames");
assert.match(folderRoute, /DOCUMENT_FOLDER_KEY/, "folder inventory must be stored in the batch mapping JSON");
assert.match(folderRoute, /DOCUMENT_FOLDER_SOURCE_KEY/, "folder verification must preserve detected-folder source metadata");

assert.match(validateSource, /const fieldValue = labourImportDocumentReferenceValue\(normalized\[field\]\)/, "validation must normalize legacy document field values separately");
assert.match(validateSource, /const filenameValue = labourImportDocumentReferenceValue\(normalized\[filenameField\]\)/, "validation must normalize workbook filename cells separately");
assert.match(validateSource, /const filenameIsDirectLink = Boolean\(filenameValue && extractGoogleDriveFileId\(filenameValue\)\)/, "filename cells that are direct URLs remain explicitly supported");
assert.match(validateSource, /const fieldValueIsDirectLink = Boolean\(fieldValue && extractGoogleDriveFileId\(fieldValue\)\)/, "document field values must only use Drive-link validation when they are real Drive links");
assert.match(validateSource, /const filename = filenameValue && !filenameIsDirectLink \? filenameValue : fieldValue && !fieldValueIsDirectLink \? fieldValue : ""/, "legacy filename headers containing full Drive URLs must be treated as direct links");
assert.match(validateSource, /if \(!filename\) return;/, "missing filename must not be treated as an invalid Drive URL");
assert.match(validateSource, /is not a Google Drive file link\./, "non-link document references must report invalid direct link wording");
assert.match(validateSource, /matches multiple files in the verified folder/, "duplicate Drive filename must report ambiguity");
assert.match(validateSource, /const hasAadhaarFrontBack = Boolean\(documentManifest\.aadhaar_front_drive_url && documentManifest\.aadhaar_back_drive_url\)/, "Aadhaar front/back requirement must use matched documents, not raw placeholder values");
assert.match(validateSource, /const hasCombinedAadhaar = Boolean\(documentManifest\.aadhaar_combined_drive_url\)/, "combined Aadhaar requirement must use matched documents, not raw placeholder values");

assert.match(executeSource, /const entry = manifest\[field\] \|\| manifest\[sourceLink\]/, "execution must use matched manifest entries");
assert.match(executeSource, /if \(!sourceLink && !entry\) return null;/, "execution must attach filename-matched documents without direct row URLs");
assert.match(executeSource, /bucket: LABOUR_DOCUMENT_BUCKET/, "matched files must still be copied into private Supabase Labour storage");

assert.match(pageSource, /Worker documents checked\./, "UI must confirm successful document checks without exposing technical folder inventory");
assert.doesNotMatch(pageSource, /Folder verified\./, "UI must not expose the removed technical folder verified card");
assert.doesNotMatch(pageSource, /duplicate filename\(s\)/, "UI must not expose raw folder inventory details");
assert.doesNotMatch(pageSource, /verify the google drive document folder/, "direct-link UI must not display stale verify-folder document messages");
assert.doesNotMatch(pageSource, /✕[^\\n]+Verified/, "UI must never show a failed badge as verified");

console.log("Labour import folder matching rules passed.");
