import assert from "node:assert/strict";
import fs from "node:fs";
import { inflateRawSync } from "node:zlib";

function readZipEntries(buffer) {
  const entries = new Map();
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 66000); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  assert.notEqual(eocdOffset, -1, "template must be a valid XLSX zip");
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  let offset = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;
  while (offset < end) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    entries.set(fileName, method === 8 ? inflateRawSync(compressed, { finishFlush: 2 }).toString("utf8") : compressed.toString("utf8"));
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

const importLib = fs.readFileSync(new URL("../lib/labour/import.ts", import.meta.url), "utf8");
const uploadRoute = fs.readFileSync(new URL("../app/api/labour/import/upload/route.ts", import.meta.url), "utf8");
const folderRoute = fs.readFileSync(new URL("../app/api/labour/import/folder/route.ts", import.meta.url), "utf8");
const pageSource = fs.readFileSync(new URL("../app/labour/workers/import/page.tsx", import.meta.url), "utf8");
const validateRoute = fs.readFileSync(new URL("../app/api/labour/import/validate/route.ts", import.meta.url), "utf8");
const executeRoute = fs.readFileSync(new URL("../app/api/labour/import/execute/route.ts", import.meta.url), "utf8");
const template = fs.readFileSync(new URL("../public/templates/ConstructIQ_Labour_Import_Template.xlsx", import.meta.url));
const entries = readZipEntries(template);
const workbookText = Array.from(entries.values()).join("\n");

assert.match(workbookText, /Google Drive Document Folder Link/, "official template must contain the workbook-level folder-link field");
assert.match(workbookText, /Labour Photo Drive Link/, "official template must use direct Labour Photo Drive Link columns");
assert.match(workbookText, /Aadhaar Front Drive Link/, "official template must use direct Aadhaar Front Drive Link columns");
assert.match(workbookText, /Aadhaar Back Drive Link/, "official template must use direct Aadhaar Back Drive Link columns");
assert.match(workbookText, /Combined Aadhaar Drive Link/, "official template must use direct Combined Aadhaar Drive Link columns");

assert.match(importLib, /DOCUMENT_FOLDER_LINK_ALIASES/, "parser must use an explicit folder-link alias list");
assert.match(importLib, /Google Drive Document Folder Link/, "parser must recognize the official folder-link label");
assert.match(importLib, /Document Folder Link/, "parser must support the approved folder-link alias");
assert.match(importLib, /Drive Folder Link/, "parser must support the approved short folder-link alias");
assert.match(importLib, /findWorkbookSetting\(sheets, DOCUMENT_FOLDER_LINK_ALIASES\)/, "parser must read the folder URL from explicit workbook settings");
assert.doesNotMatch(importLib, /drive\.google\.com[\s\S]{0,120}findWorkbookSetting/, "parser must not scan arbitrary Drive URLs as folder links");

assert.match(uploadRoute, /extractGoogleDriveFolderId\(documentFolderUrl\)/, "upload must parse the workbook folder URL");
assert.match(uploadRoute, /DOCUMENT_FOLDER_SOURCE_KEY/, "upload must persist the detected folder source metadata");
assert.match(uploadRoute, /mapping,/, "upload response must include the inserted mapping object for immediate UI consent state");
assert.doesNotMatch(uploadRoute, /listDriveFolderFiles/, "upload must not access Drive before user confirmation");

assert.match(pageSource, />Continue<\/button>/, "UI must expose the same concise confirmation action as Employee Import");
assert.match(pageSource, /Allow ConstructIQ to access and import the available worker documents from Google Drive\?/, "UI must ask before direct Drive document access");
assert.doesNotMatch(pageSource, /Google Drive Document Folder Link/, "UI must not ask for a folder link in the direct-link workflow");
assert.doesNotMatch(pageSource, /Paste the Google Drive folder link/, "folder-link input must not appear in the direct-link workflow");
assert.doesNotMatch(pageSource, /Add Folder Link Manually/, "UI must not expose a separate manual folder-entry workflow");
assert.doesNotMatch(pageSource, /Document folder found/, "UI must not expose a technical detected-folder card");
assert.match(pageSource, /setPreview\(\{ rows: \[\], batch: \{ id: payload\.batch_id, mapping: nextMapping, status: "uploaded" \} \}\)/, "fresh upload must seed detected folder metadata before preview refresh completes");

assert.doesNotMatch(pageSource, /\/api\/labour\/import\/folder/, "Continue must not call the folder endpoint for direct-link document access");
assert.match(pageSource, /const validation = await validateBatch\(batchId\)/, "Continue must validate direct document links");
assert.match(folderRoute, /payload\.folder_url \|\| source\.folder_url/, "folder endpoint must still support the persisted workbook-detected folder URL");
assert.match(folderRoute, /The Google Drive document source could not be detected\. Please use the latest Labour Import template\./, "folder endpoint must report missing source only after reading the persisted batch mapping");
assert.match(folderRoute, /status: "detected"/, "entered folder source must be persisted before folder listing");
assert.match(folderRoute, /\.\.\.currentMapping/, "folder source persistence must preserve existing master mappings and folder metadata");
assert.match(folderRoute, /listDriveFolderFiles\(\{ folderId \}\)/, "confirmed verification must use the shared Drive listing helper");
assert.match(pageSource, /ConstructIQ could not access the worker documents\./, "UI must show a friendly Drive access failure");
assert.match(folderRoute, /Enter a valid Google Drive folder link\./, "folder endpoint must reject invalid folder URLs clearly");
assert.doesNotMatch(pageSource, /Unsupported action/, "UI must not expose raw Apps Script unsupported-action errors");
assert.match(validateRoute, /folderFilesByName\(mapping\)/, "revalidation must reuse persisted folder inventory");
assert.match(executeRoute, /downloadDriveFile/, "document ownership flow must still download Drive files server-side");
assert.match(executeRoute, /createPrivateStorageAdapter/, "document ownership flow must still copy files to private ERP storage");

console.log("Labour import folder consent tests passed.");
