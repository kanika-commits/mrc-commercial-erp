import assert from "node:assert/strict";
import fs from "node:fs";

const uploadSource = fs.readFileSync(new URL("../app/api/labour/import/upload/route.ts", import.meta.url), "utf8");
const mappingSource = fs.readFileSync(new URL("../app/api/labour/import/mapping/route.ts", import.meta.url), "utf8");
const folderSource = fs.readFileSync(new URL("../app/api/labour/import/folder/route.ts", import.meta.url), "utf8");
const pageSource = fs.readFileSync(new URL("../app/labour/workers/import/page.tsx", import.meta.url), "utf8");

assert.match(uploadSource, /const mapping = documentFolderSource \? \{ \[DOCUMENT_FOLDER_SOURCE_KEY\]: documentFolderSource \} : \{\};/, "fresh upload without a folder link must insert mapping as an empty object");
assert.doesNotMatch(uploadSource, /mapping:\s*documentFolderSource \? \{ \[DOCUMENT_FOLDER_SOURCE_KEY\]: documentFolderSource \} : null/, "fresh upload must never insert mapping null");
assert.match(uploadSource, /status: documentFolderId \? "detected" : "invalid"/, "valid folder links must store detected metadata and invalid links must store invalid metadata");
assert.match(uploadSource, /mapping,/, "labour_import_batches insert must always include the non-null mapping object");
assert.match(uploadSource, /return NextResponse\.json\(\{[\s\S]*mapping,[\s\S]*document_folder_source: documentFolderSource/, "upload response must return the same mapping used for the inserted batch");

assert.match(mappingSource, /function mappingObject/, "mapping save must normalize existing and incoming mapping values to objects");
assert.match(mappingSource, /const currentMapping = mappingObject\(batch\.mapping\)/, "mapping save must preserve existing batch mapping metadata");
assert.match(mappingSource, /const incomingMapping = mappingObject\(payload\.mapping\)/, "mapping save must reject non-object mapping payloads safely");
assert.match(mappingSource, /mapping: \{ \.\.\.currentMapping, \.\.\.incomingMapping \}/, "saving ERP Master Mapping must merge instead of replacing folder metadata");

assert.match(folderSource, /const currentMapping = mappingObject\(batch\.mapping\)/, "folder verification must preserve existing mapping metadata");
assert.match(folderSource, /\.\.\.currentMapping,[\s\S]*\[DOCUMENT_FOLDER_SOURCE_KEY\]/, "folder verification must merge verified folder metadata into existing mappings");
assert.match(folderSource, /\[DOCUMENT_FOLDER_KEY\]: documentFolder/, "folder verification must persist verified folder inventory for revalidation");
assert.doesNotMatch(pageSource, /\/api\/labour\/import\/folder/, "current direct-link Labour Import UI must not call folder verification");

console.log("Labour import upload mapping tests passed.");
