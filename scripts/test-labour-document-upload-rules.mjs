import assert from "node:assert/strict";
import fs from "node:fs";

const contractorPage = fs.readFileSync("app/labour/contractors/[id]/page.tsx", "utf8");
const contractorApi = fs.readFileSync("app/api/labour/contractors/[id]/documents/route.ts", "utf8");
const workerPage = fs.readFileSync("app/labour/workers/[id]/page.tsx", "utf8");
const workerApi = fs.readFileSync("app/api/labour/workers/[id]/documents/route.ts", "utf8");
const shared = fs.readFileSync("app/api/labour/_shared.ts", "utf8");
const storageAdapter = fs.readFileSync("lib/storage/privateStorage.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/202607250003_labour_phase1_navigation_permission_upload_fix.sql", "utf8");

for (const [label, page, api] of [
  ["Contractor", contractorPage, contractorApi],
  ["Worker", workerPage, workerApi],
]) {
  assert.match(page, /new FormData\(\)/, `${label} page must upload with multipart FormData`);
  assert.match(page, /\.set\("file", file\)/, `${label} page must send the selected file in the file field`);
  assert.match(page, /\.set\("document_type", documentType\)/, `${label} page must send document_type in the same request`);
  assert.doesNotMatch(page, /"content-type":\s*"multipart\/form-data"/i, `${label} page must not manually set multipart Content-Type`);
  assert.match(page, /parsePayload\(response\)/, `${label} page must safely parse JSON and plain-text API errors`);
  assert.match(page, /payload\.error \|\|/, `${label} page must surface API errors`);
  assert.match(page, /Uploading\.\.\./, `${label} page must show upload progress`);
  assert.match(page, /uploaded successfully/, `${label} page must show upload success`);
  assert.match(page, /key=\{fileInputKey\}/, `${label} page must reset the native file input after success`);
  assert.match(page, /type="button" onClick=\{uploadDoc\}/, `${label} upload button must not behave as a default form submit`);
  assert.match(page, /Choose a document file before uploading\./, `${label} upload handler must report missing file state`);
  assert.match(page, /catch \(uploadError: any\)/, `${label} upload handler must surface fetch/runtime failures`);
  assert.match(page, /finally \{[\s\S]+setUploading\(false\)/, `${label} upload handler must always clear loading state`);

  assert.match(api, /requireLabourPermission\(request, "labour_documents", "view"\)/, `${label} document GET must use labour_documents:view`);
  assert.match(api, /requireLabourPermission\(request, "labour_documents", "upload"\)/, `${label} document POST must use labour_documents:upload`);
  assert.match(api, /requireLabourPermission\(request, "labour_documents", "delete"\)/, `${label} document DELETE must use labour_documents:delete`);
  assert.match(api, /request\.formData\(\)/, `${label} API must parse multipart FormData`);
  assert.match(api, /formData\.get\("file"\)/, `${label} API must read the file field`);
  assert.match(api, /formData\.get\("document_type"\)/, `${label} API must read document_type`);
  assert.match(api, /file instanceof File/, `${label} API must reject missing files`);
  assert.match(api, /createPrivateStorageAdapter\(access\.admin\)/, `${label} API must use the private storage adapter`);
  assert.match(api, /LABOUR_DOCUMENT_BUCKET/, `${label} API must use the canonical labour document bucket`);
  assert.match(api, /createSignedReadUrl/, `${label} GET must open documents through signed private URLs`);
  assert.match(api, /\.delete\(\{ bucket: document\.storage_bucket, key: document\.storage_key \}\)/, `${label} delete must remove the storage object`);
  assert.match(api, /storage_bucket: object\.bucket/, `${label} insert must store the actual bucket`);
  assert.match(api, /storage_key: object\.key/, `${label} insert must store the actual object key`);
  assert.match(api, /original_file_name: object\.originalFileName/, `${label} insert must store original filename metadata`);
  assert.match(api, /mime_type: object\.mimeType/, `${label} insert must store MIME type metadata`);
  assert.match(api, /size_bytes: object\.sizeBytes/, `${label} insert must store file size metadata`);
  assert.match(api, /if \(stored\)/, `${label} upload must clean up storage if DB insert fails`);
}

assert.match(contractorApi, /\.from\("labour_contractor_documents"\)/, "Contractor documents use the contractor document table");
assert.match(contractorApi, /\.eq\("contractor_profile_id", id\)/, "Contractor document open/list/delete is scoped to the contractor");
assert.match(contractorApi, /safeObjectKey\(\[contractor\.organization_id, "contractors", id, documentType/, "Contractor storage path is organization/contractor scoped");

assert.match(workerApi, /\.from\("labour_documents"\)/, "Worker documents use the worker document table");
assert.match(workerApi, /\.eq\("labour_worker_id", id\)/, "Worker document open/list/delete is scoped to the worker");
assert.match(workerApi, /safeObjectKey\(\[worker\.organization_id, id, documentType/, "Worker storage path is organization/worker scoped");
assert.match(workerPage, /documentType === "Photo" \? "Profile photo uploaded successfully\."/, "Worker photo upload has a specific success message");
assert.match(workerPage, /const photo = \(payload\.documents \|\| \[\]\)\.find/, "Worker detail identifies the active Photo document");
assert.match(workerPage, /<img src=\{photoUrl\}/, "Worker detail visibly renders the uploaded profile photo after refresh");

assert.match(shared, /export const LABOUR_DOCUMENT_BUCKET = "labour-documents"/, "Shared Labour bucket constant is labour-documents");
assert.match(storageAdapter, /Buffer\.from\(await input\.file\.arrayBuffer\(\)\)/, "Private storage adapter accepts File and converts it to Buffer");
assert.match(storageAdapter, /contentType: input\.file\.type \|\| "application\/octet-stream"/, "Private storage adapter preserves MIME type");
assert.match(migration, /values \('labour-documents', 'labour-documents', false\)/, "Migration creates the private labour-documents bucket");

console.log("Labour document upload rule tests passed.");
