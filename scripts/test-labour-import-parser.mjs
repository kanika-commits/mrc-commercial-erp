import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../lib/labour/import.ts", import.meta.url), "utf8");

function assertContains(text, message) {
  assert.ok(source.includes(text), message);
}

assertContains("export function parseLabourWorkbook", "worker import parser is exported");
assertContains("parseGenericWorkbook(buffer)", "labour import uses a workbook parser scoped to the Labour template");
assertContains("LABOUR_IMPORT_TEMPLATE_COLUMNS", "official Labour Import template columns are exported");
assertContains("DOCUMENT_FOLDER_LINK_ALIASES", "parser reads the workbook-level document folder link from explicit labels");
assertContains("Google Drive Document Folder Link", "official workbook folder-link label is supported");
assertContains("documentFolderUrl", "parsed labour workbooks expose the detected document folder URL");
assertContains("\"Daily Rate *\"", "daily rate column is part of the official import template");
assertContains("\"Company Name *\"", "company name is part of the official import template");
assertContains("\"Site Name *\"", "site name is part of the official import template");
assertContains("\"Contractor Name *\"", "contractor name is part of the official import template");
assertContains("\"Labour Category *\"", "labour category is part of the official import template");
assertContains("\"Labour Photo Drive Link\"", "labour photo uses the direct Drive-link workflow");
assertContains("\"Aadhaar Front Drive Link\"", "Aadhaar front uses the direct Drive-link workflow");
assertContains("\"Aadhaar Back Drive Link\"", "Aadhaar back uses the direct Drive-link workflow");
assertContains("\"Combined Aadhaar Drive Link\"", "combined Aadhaar uses the direct Drive-link workflow");
assertContains("\"PAN Drive Link\"", "PAN uses an optional Drive link");
assertContains("\"Bank Proof Drive Link\"", "Bank Proof uses an optional Drive link");
assertContains("\"Other Document Drive Link\"", "Other documents use optional Drive links");
assertContains("worker_name: [\"worker name\", \"labour name\", \"labour name *\"", "labour name aliases are supported");
assertContains("father_or_husband_name", "father/husband name is parsed for duplicate matching");
assertContains("contractor_text", "contractor source text is preserved for resolution");
assertContains("site_text", "site source text is preserved for resolution");
assertContains("designation: [\"designation\", \"trade\"", "designation/workbook skill column is parsed separately");
assertContains("employment_category: [\"labour category\"", "labour category/payment category column is preserved separately");
assertContains("photo_filename: [\"labour photo filename\"", "labour photo filename is parsed separately from direct Drive URLs");
assertContains("aadhaar_front_filename: [\"aadhaar front filename\"", "Aadhaar front filename is parsed separately from direct Drive URLs");
assertContains("aadhaar_back_filename: [\"aadhaar back filename\"", "Aadhaar back filename is parsed separately from direct Drive URLs");
assertContains("aadhaar_combined_filename: [\"combined aadhaar pdf filename\"", "Combined Aadhaar filename is parsed separately from direct Drive URLs");
assertContains("normalized.labour_category = normalized.employment_category || \"\"", "workbook labour category is retained as metadata");
assertContains("(fields.has(\"designation\") || fields.has(\"trade\") || fields.has(\"employment_category\"))", "header detection accepts either Designation or the legacy Labour Category trade column");
assertContains("normalized.trade = normalized.designation || normalized.trade_name || normalized.trade || normalized.employment_category", "designation takes precedence over labour category when resolving ERP trade");
assertContains("isGoogleDriveFileLink(normalized[filenameField])", "legacy filename headings with full Drive URLs are promoted into direct document link fields");
assertContains("normalized.date_of_birth = normalizeDateValue(normalized.date_of_birth)", "labour import normalizes Excel DOB values");
assertContains("normalized.date_of_joining = normalizeDateValue(normalized.date_of_joining)", "labour import normalizes Excel joining date values");
assertContains("optionalFormattedAadhaar(normalized.aadhaar_number)", "Aadhaar sentinel normalization and standard dashed formatting is applied");
assertContains("worker_type = \"contractor_labour\"", "import rows remain contractor labour internally");
assertContains(".filter((row) => row.normalized.worker_name || row.normalized.company_text || row.normalized.site_text || row.normalized.aadhaar_number)", "blank rows are skipped");
assertContains("validateLabourImportDailyRate", "daily rate validation helper is exported");
assertContains("maskAadhaarForImport", "import reports and previews can mask Aadhaar");
assert.ok(!source.includes("\"Import Reference\""), "template does not ask users for Import Reference");
assert.ok(!source.includes("\"Company Code\""), "template does not ask users for Company Code");
assert.ok(!source.includes("\"Site Code\""), "template does not ask users for Site Code");
assert.ok(!source.includes("\"Contractor Vendor ID\""), "template does not ask users for Contractor Vendor ID");
assert.ok(!source.includes("\"Contractor Code\""), "template does not ask users for Contractor Code");
assert.ok(!source.includes("\"Labour Category Code\""), "template does not ask users for Labour Category Code");
assert.ok(!source.includes("\"Labour Code\""), "template does not ask users to enter Labour Code");
assert.ok(!source.includes("\"Gender\""), "template excludes unsupported Gender field");
assert.ok(!source.includes("\"Age\""), "template excludes unsupported Age field");
assert.ok(!source.includes("\"Organization Code\""), "template excludes organization columns; organization is server-side scope");
assert.ok(!source.includes("\"UAN\""), "template excludes UAN from the default HR-facing template");
assert.ok(source.includes("uan_number"), "parser can preserve supported UAN values when a completed workbook contains them");
assert.ok(source.includes("esi_number"), "parser can preserve supported ESI/ESIC values when a completed workbook contains them");
assert.ok(source.includes("bank_account_number"), "parser can preserve supported bank account values when a completed workbook contains them");

const validationSource = fs.readFileSync(new URL("../app/api/labour/import/validate/route.ts", import.meta.url), "utf8");
assert.ok(validationSource.includes("Duplicate Aadhaar in this workbook."), "duplicate workbook Aadhaar identities are blocked");
assert.ok(validationSource.includes("Multiple existing labourers match this row."), "multiple existing labour matches are blocked");
assert.ok(!validationSource.includes("hr_employees"), "labour import validation does not write or validate through hr_employees");
assert.ok(validationSource.includes("validateLabourCompanySiteIndependent"), "labour import preserves independent company/site validation");
assert.ok(validationSource.includes("validateLabourImportDailyRate"), "labour import validates mandatory whole rupee daily rate");
assert.ok(validationSource.includes("selected_action: workerMatches.length ? \"skip\" : \"create\""), "existing labour rows skip in V1 instead of silently overwriting");
assert.ok(validationSource.includes("loadRegistrationContractors"), "labour import contractor validation follows registration Work Order Vendor source");
assert.ok(validationSource.includes("contractor_vendor_id"), "validation preserves Vendor ID for profile creation during registration");
assert.ok(validationSource.includes("extractGoogleDriveFileId"), "validation extracts Drive file IDs from direct document links");
assert.ok(validationSource.includes("downloadDriveFile"), "validation verifies Drive file accessibility directly");
assert.ok(validationSource.includes("is not a Google Drive file link."), "non-link document references are warned without requiring folder matching");
assert.ok(validationSource.includes("Aadhaar Available is Yes; provide matched Aadhaar Front and Back documents or a matched Combined Aadhaar document."), "Aadhaar document option validation is enforced");
assert.ok(!validationSource.includes("documents_by_import_reference"), "validation no longer matches documents by Import Reference");

const uploadSource = fs.readFileSync(new URL("../app/api/labour/import/upload/route.ts", import.meta.url), "utf8");
assert.ok(uploadSource.includes("\"labour_workers\", \"import\""), "upload requires labour_workers import permission");
assert.ok(uploadSource.includes("labour_code: null"), "upload does not persist a user-supplied labour code");

const executeSource = fs.readFileSync(new URL("../app/api/labour/import/execute/route.ts", import.meta.url), "utf8");
assert.ok(executeSource.includes("POST as registerWorker"), "execute reuses the current Labour Registration API");
assert.ok(executeSource.includes("attachDocument"), "execute links imported documents to the created labour worker");
assert.ok(executeSource.includes("wage_rate: n.wage_rate"), "execute path passes Daily Rate to the current registration validation");
assert.ok(executeSource.includes("vendor_id: row.matched_contractor_profile_id ? undefined : n.contractor_vendor_id"), "execute lets registration create a compatibility profile from a valid Vendor when needed");
assert.ok(executeSource.includes("registrationPayload.action === \"registered\""), "failed document attachment cleanup only deletes newly registered workers");
assert.ok(executeSource.includes("storage_provider: object.provider"), "execute stores the ERP-owned private storage provider");
assert.ok(executeSource.includes("downloadDriveFile"), "execute downloads Drive files server-side before attaching them");
assert.ok(executeSource.includes("createPrivateStorageAdapter"), "execute reuses the existing private storage adapter");
assert.ok(executeSource.includes("source_url: entry.source_url || entry.drive_file_url"), "execute stores Drive source URL for imported documents");
assert.ok(executeSource.includes("LABOUR_IMPORT_DOCUMENT_FIELDS"), "execute attaches all direct Drive link manifest documents through the shared document field list");

const driveSource = fs.readFileSync(new URL("../src/lib/googleDrive.ts", import.meta.url), "utf8");
assert.ok(driveSource.includes("export function extractGoogleDriveFileId"), "shared Google Drive helper exposes reusable file ID extraction");

const pageSource = fs.readFileSync(new URL("../app/labour/workers/import/page.tsx", import.meta.url), "utf8");
assert.ok(pageSource.includes("Allow ConstructIQ to access and import the available worker documents from Google Drive?"), "Labour Import UI uses the approved direct-link document-access confirmation language");
assert.ok(pageSource.includes("Continue"), "Labour Import UI exposes a concise confirmation action");
assert.ok(!pageSource.includes("Paste the Google Drive folder link"), "Labour Import UI does not require a folder link for direct document imports");
assert.ok(!pageSource.includes("Upload ZIP"), "Labour Import UI no longer shows ZIP upload");

console.log("Labour import parser contract tests passed.");
