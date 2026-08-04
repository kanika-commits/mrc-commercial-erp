import assert from "node:assert/strict";
import fs from "node:fs";

const importSource = fs.readFileSync(new URL("../lib/hr/employeeImport.ts", import.meta.url), "utf8");
const validateSource = fs.readFileSync(new URL("../app/api/hr/employee-import/validate/route.ts", import.meta.url), "utf8");
const executeSource = fs.readFileSync(new URL("../app/api/hr/employee-import/execute/route.ts", import.meta.url), "utf8");
const uploadSource = fs.readFileSync(new URL("../app/api/hr/employee-import/upload/route.ts", import.meta.url), "utf8");
const mappingSource = fs.readFileSync(new URL("../app/api/hr/employee-import/mapping/route.ts", import.meta.url), "utf8");
const previewSource = fs.readFileSync(new URL("../app/api/hr/employee-import/preview/route.ts", import.meta.url), "utf8");
const rowSource = fs.readFileSync(new URL("../app/api/hr/employee-import/rows/[rowId]/route.ts", import.meta.url), "utf8");
const reportSource = fs.readFileSync(new URL("../app/api/hr/employee-import/report/route.ts", import.meta.url), "utf8");
const remainingSource = fs.readFileSync(new URL("../app/api/hr/employee-import/remaining/route.ts", import.meta.url), "utf8");
const pageSource = fs.readFileSync(new URL("../app/hr/employees/import/page.tsx", import.meta.url), "utf8");
const directorySource = fs.readFileSync(new URL("../app/hr/employees/page.tsx", import.meta.url), "utf8");
const templateInspect = fs.readFileSync(new URL("../outputs/employee-import-template/ConstructIQ_Employee_Import_Template.xlsx.inspect.ndjson", import.meta.url), "utf8");
const employeeImportMigrationSource = fs.readFileSync(new URL("../supabase/migrations/202607310004_system_generated_employee_codes.sql", import.meta.url), "utf8");

for (const column of [
  "Employee Photo Drive Link",
  "Aadhaar Front Drive Link",
  "Aadhaar Back Drive Link",
  "Combined Aadhaar Drive Link",
  "PAN Drive Link",
  "Bank Proof Drive Link",
  "Resume Drive Link",
  "Appointment Letter Drive Link",
]) {
  assert.ok(importSource.includes(column), `${column} must be parsed`);
  assert.ok(templateInspect.includes(column), `${column} must be present in the official template`);
}

assert.ok(importSource.includes("\"company_name\", \"site_name\""), "company and site are mandatory in unified import");
assert.ok(!importSource.includes("\"employee_code\", \"employee_name\", \"company_name\""), "Employee Code must not be mandatory for employee import");
assert.ok(importSource.includes("preserveOnly: true"), "legacy Employee Code columns are preserve-only and not part of the official template contract");
assert.ok(importSource.includes("admin.rpc(\"next_employee_code\")"), "employee import helper generates employee codes through the shared RPC");
assert.ok(importSource.includes("EmployeeImportFinalStatus"), "employee import defines the final row state model");
assert.ok(importSource.includes("assertEmployeeWorkbookColumnIntegrity"), "employee import has an upload-time parser alignment guard");
assert.ok(importSource.includes("raw[header] = String(row.cellsByColumn[columnIndex] ?? \"\").trim()"), "employee parser stages raw data from physical worksheet columns");
assert.ok(!importSource.includes("raw[header] = String(row.values[index] || \"\").trim()"), "employee parser must not stage rows through positional value fallback");
assert.ok(importSource.includes("mapping[MASTER_MAPPING_KEY] = overrides[MASTER_MAPPING_KEY]"), "field mapping preserves saved master dropdown mappings");
assert.ok(importSource.includes("aliases: [\"employee name\", \"full name\", \"name\"]"), "Full Name maps to Employee Name");
assert.ok(!importSource.includes("Selected site belongs to a different company."), "Employee Import must not enforce sites.company_id ownership");
assert.ok(!importSource.includes("matches.company_id = siteLookup.match.company_id"), "Employee Import must not derive selected company from sites.company_id");
assert.ok(importSource.includes("companies.data || []).filter((row: any) => row.status === \"active\")"), "Employee Import company masters are active-only");
assert.ok(importSource.includes("sites.data || []).filter((row: any) => row.status === \"active\")"), "Employee Import site masters are active-only");
assert.ok(importSource.includes("accountCompanyIds.includes(row.id)"), "Employee Import company lookups must respect assigned company access");
assert.ok(importSource.includes("accountSiteIds.includes(row.id)"), "Employee Import site lookups must respect explicit site access");
assert.ok(importSource.includes("savedTarget !== \"reporting_manager_name\""), "Reporting Manager saved mapping is guarded against unrelated source columns");
assert.ok(importSource.includes("savedTarget === canonicalTarget"), "canonical workbook headers cannot be overwritten by incompatible saved mappings");
assert.ok(importSource.includes("import_status === \"skipped\"") && importSource.includes("already_exists"), "skipped rows map to Already Exists final status");
assert.ok(importSource.includes("import_status === \"failed\"") && importSource.includes("import_failed"), "failed rows map to Import Failed final status");
assert.ok(importSource.includes("validation_status === \"invalid\"") && importSource.includes("validation_failed"), "invalid rows map to Validation Failed final status");
assert.ok(importSource.includes("isEmployeeImportReady"), "Ready rows are calculated from validation-ready and pending rows only");
assert.ok(importSource.includes("applyExistingEmployeeStatus"), "shared import logic pre-classifies existing employees");
assert.ok(uploadSource.includes("applyExistingEmployeeStatus"), "upload staging detects Already Exists rows");
assert.ok(uploadSource.includes("loadSavedMappingForWorkbook"), "upload staging loads previously saved workbook mappings before validation");
assert.ok(uploadSource.includes("mappingFromHeaders(parsed.headers, savedMapping)"), "upload staging applies saved mappings before parsing rows");
assert.ok(uploadSource.includes(".eq(\"source_file_hash\", sourceFileHash)"), "upload staging first reuses exact saved mapping by workbook hash");
assert.ok(uploadSource.includes("mappingScoreForHeaders"), "upload staging safely falls back to compatible saved header mappings");
assert.ok(uploadSource.includes("assertEmployeeWorkbookColumnIntegrity(parsed)"), "upload validates parser column integrity before staging rows");
assert.ok(!uploadSource.includes("raw_data") || uploadSource.includes("rowPayloadForInsert(row, mapping, masters, organizationId)"), "upload creates fresh staged rows from parsed workbook data");
assert.ok(importSource.includes("import_result: {}"), "upload row payload helper must write non-null import_result for freshly staged rows");
assert.ok(validateSource.includes("applyExistingEmployeeStatus"), "validation detects Already Exists rows");
assert.ok(mappingSource.includes("applyExistingEmployeeStatus"), "mapping revalidation detects Already Exists rows");
assert.ok(!mappingSource.includes("import_result: row.import_status === \"imported\" ? row.import_result : null"), "mapping revalidation must not write NULL import_result");
assert.ok(mappingSource.includes("import_result: row.import_status === \"imported\" ? (row.import_result || {}) : {}"), "mapping revalidation writes non-null import_result");
assert.ok(mappingSource.includes("import_status: row.import_status === \"imported\" ? \"imported\" : \"pending\""), "mapping revalidation resets non-imported rows to pending");
assert.ok(rowSource.includes("applyExistingEmployeeStatus"), "row correction revalidation detects Already Exists rows");
assert.ok(!rowSource.includes("import_result: null"), "row correction must not write NULL import_result");
assert.ok(rowSource.includes("import_result: row.import_result || {}"), "row correction preserves or writes non-null import_result");
assert.ok(validateSource.includes("extractGoogleDriveFileId"), "validation extracts Drive file IDs from direct links");
assert.ok(validateSource.includes("downloadDriveFile"), "validation verifies Drive file accessibility");
assert.ok(validateSource.includes("document_manifest"), "validation stores per-row document metadata");
assert.ok(!validateSource.includes("import_result: row.import_status === \"imported\" ? row.import_result : null"), "validation must not write NULL import_result");
assert.ok(validateSource.includes("import_result: row.import_status === \"imported\" ? (row.import_result || {}) : {}"), "validation writes non-null import_result");
assert.ok(validateSource.includes("baseUpdate.import_status === \"skipped\""), "validation skips Drive verification for already-existing rows");
assert.ok(validateSource.includes("import_status: row.import_status === \"imported\" ? \"imported\" : \"pending\""), "validation resets old failed rows to pending when revalidating");
assert.ok(previewSource.includes("summarizeRows(summaryRows || [])"), "preview recalculates row-state summary from current rows");
assert.ok(pageSource.includes("rows.length > 0 ? readyImportRows.length : Number(summary.ready || 0)"), "execute button count uses loaded row states instead of stale batch summary");
assert.ok(importSource.includes("reporting_manager_id"), "reporting manager is resolved into a persisted employee ID");
assert.ok(executeSource.includes("attachEmployeeImportDocuments"), "execution attaches documents after employee create");
assert.ok(executeSource.includes("reporting_manager_id: row.normalized_data.reporting_manager_id"), "execution persists reporting manager after employee create");
assert.ok(executeSource.includes("employee_documents"), "execution writes Employee Documents rows");
assert.ok(executeSource.includes("executeImportRow(admin, auth, batchResult.batch, row, request)"), "execution uses the shared TypeScript employee import helper");
assert.ok(!executeSource.includes("admin.rpc(\"execute_employee_import_row\""), "execution must not call a stale database import RPC");
assert.ok(employeeImportMigrationSource.includes("create sequence if not exists public.employee_code_sequence"), "employee code migration creates the system sequence");
assert.ok(employeeImportMigrationSource.includes("create table if not exists public.employee_code_reservations"), "employee code migration creates reserved-code tracking");
assert.ok(employeeImportMigrationSource.includes("'MRC0001'") && employeeImportMigrationSource.includes("'MRC0004'"), "employee code migration reserves MRC0001 through MRC0004");
assert.ok(employeeImportMigrationSource.includes("create or replace function public.next_employee_code()"), "employee code migration exposes the generation RPC");
assert.ok(employeeImportMigrationSource.includes("v_employee_code := public.next_employee_code();"), "employee import RPC generates employee_code server-side");
assert.ok(employeeImportMigrationSource.includes("'employeeCode', v_employee.employee_code"), "employee import RPC returns generated employee code in import_result");
assert.ok(employeeImportMigrationSource.includes("p_batch_id::text || ':' || v_row.source_row_number::text"), "employee import RPC scopes employment history source_record_id by batch and row number");
assert.ok(!employeeImportMigrationSource.includes("v_employee.status, v_row.source_row_number::text"), "employee import RPC must not reuse plain source row numbers as employment history import references");
assert.ok(importSource.includes("source_record_id: `${batch.id}:${row.source_row_number}`"), "employee import helper scopes source_record_id by batch and row number");
assert.ok(!importSource.includes("source_record_id: String(row.source_row_number)"), "employee import helper must not reuse plain source row numbers as import references");
assert.ok(!executeSource.includes("Resolve invalid rows before executing the import."), "execution must not block ready rows just because invalid rows exist");
assert.ok(executeSource.includes(".in(\"validation_status\", [\"valid\", \"warning\"])"), "execution imports only validation-ready rows");
assert.ok(executeSource.includes(".eq(\"import_status\", \"pending\")"), "execution imports only pending rows");
assert.ok(executeSource.includes("No Ready employee rows are available to import."), "execution clearly rejects batches with no ready rows");
assert.ok(!executeSource.includes("[\"completed\", \"completed_with_errors\", \"executing\"]"), "execution remains resumable after partial completion");
assert.ok(executeSource.includes("batchResult.batch.status === \"executing\""), "execution only blocks concurrent runs");
assert.ok(executeSource.includes("catch (error: any)") && executeSource.includes("import_status: \"failed\""), "execution records row-level failures instead of silently stopping");
assert.ok(executeSource.includes("userFriendlyImportError"), "execution converts common database errors to user-friendly import reasons");
assert.ok(executeSource.includes("summary.failed > 0 || summary.invalid > 0 ? \"completed_with_errors\" : \"completed\""), "invalid skipped rows keep the batch completion summary explicit");
assert.ok(reportSource.includes("employeeImportFinalStatus") && reportSource.includes("employeeImportReason"), "report route returns final status and reason");
assert.ok(remainingSource.includes("Download Remaining Employees.xlsx"), "remaining workbook endpoint downloads the approved xlsx filename");
assert.ok(remainingSource.includes("raw_data") && remainingSource.includes("\"Reason\""), "remaining workbook preserves original columns and appends Reason");
assert.ok(remainingSource.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), "remaining workbook is served as xlsx");
assert.ok(pageSource.includes("Download Official Template"), "unified import page exposes the official template");
assert.ok(pageSource.includes("Generated Employee Code"), "employee import results display generated employee codes after execution");
assert.ok(pageSource.includes("Generated automatically"), "employee import preview communicates that employee codes are generated");
assert.ok(pageSource.includes("Documents"), "review page shows document counts");
assert.ok(!pageSource.includes("summary.invalid === 0"), "UI must not disable execution just because invalid rows exist");
assert.ok(pageSource.includes("readyImportRowCount"), "UI bases execute readiness on ready rows");
assert.ok(pageSource.includes("mappingDirty"), "UI blocks execution when mapping changes are unsaved");
assert.ok(pageSource.includes("Import ${readyImportRowCount} Employee"), "execute button shows the ready-row import count");
assert.ok(pageSource.includes("Download Remaining Employees.xlsx"), "UI exposes a downloadable remaining-employee workbook");
assert.ok(pageSource.includes("Already Exists"), "import summary distinguishes already-existing skipped rows");
assert.ok(pageSource.includes("Validation Failed"), "import summary distinguishes validation failures");
assert.ok(pageSource.includes("Importing 0 / ${readyImportRowCount} employees"), "UI shows import progress feedback while executing");
assert.ok(!directorySource.includes("Import Documents"), "Employee Directory no longer shows the separate bulk Import Documents action");

for (const deprecated of [
  "ZIP",
  "Drive Folder Link",
  "filename matching",
  "separate document workbook",
  "employee_code",
  "EMP001",
]) {
  assert.ok(!templateInspect.includes(deprecated), `template should not mention ${deprecated}`);
}
assert.ok(!templateInspect.includes('"Template Header","Employee Code"'), "template should not expose Employee Code as an import column");
assert.ok(templateInspect.includes("Employee Code is generated by ERP"), "template should explain generated Employee Code behaviour");

console.log("Unified employee import rule tests passed.");
