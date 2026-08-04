import assert from "node:assert/strict";
import fs from "node:fs";

const parserSource = fs.readFileSync(new URL("../lib/labour/import.ts", import.meta.url), "utf8");
const validationSource = fs.readFileSync(new URL("../app/api/labour/attendance-import/validate/route.ts", import.meta.url), "utf8");
const executeSource = fs.readFileSync(new URL("../app/api/labour/attendance-import/execute/route.ts", import.meta.url), "utf8");
const sharedSource = fs.readFileSync(new URL("../app/api/labour/attendance-import/_shared.ts", import.meta.url), "utf8");

function has(text, message) {
  assert.ok(parserSource.includes(text), message);
}

has("export function parseLabourAttendanceWorkbook", "attendance import parser is exported");
has("looksLikeTransactionHeaders", "transaction-format headers are detected");
has("looksLikeMusterHeaders", "monthly muster day-column headers are detected");
has("format: LabourAttendanceImportFormat = looksLikeTransactionHeaders(headers) ? \"transaction\" : \"monthly_muster\"", "format is selected from recognized headers");
has("P: \"present\"", "P maps to present");
has("A: \"absent\"", "A maps to absent");
has("HD: \"half_day\"", "HD maps to half day");
has("WO: \"weekly_off\"", "WO maps to weekly off");
has("H: \"holiday\"", "H maps to holiday");
has("L: \"leave\"", "L maps to leave");
has("ND: \"not_deployed\"", "ND maps to not deployed");
has("normalizeDateValue", "date values are normalized");
has("if (!attendanceCode) continue;", "empty monthly muster cells are skipped");

assert.ok(sharedSource.includes("loadAttendanceImportEditBlockers"), "shared edit-state blocker helper exists");
assert.ok(validationSource.includes("isFutureDate"), "future-date validation is applied");
assert.ok(validationSource.includes("Duplicate attendance row in workbook."), "duplicate worker/date rows are detected");
assert.ok(validationSource.includes("Attendance date is outside the selected month."), "month-boundary validation exists");
assert.ok(validationSource.includes("normalizeLookup(worker.worker_name)"), "worker name matching is normalized");
assert.ok(validationSource.includes(".from(\"labour_deployments\")"), "attendance import validation loads active deployments");
assert.ok(!validationSource.includes("worker.current_company_id === batch.selected_company_id"), "attendance import validation must not match by stale worker current_company_id");
assert.ok(!validationSource.includes("worker.current_site_id === batch.selected_site_id"), "attendance import validation must not match by stale worker current_site_id");
assert.ok(validationSource.includes("No active deployment exists for this labourer on the attendance date."), "attendance import requires an active deployment for the row date");
assert.ok(sharedSource.includes("Attendance period is submitted."), "submitted period blocks preview");
assert.ok(sharedSource.includes("Attendance period is finalized."), "finalized period blocks preview");
assert.ok(sharedSource.includes("Finalized wage period prevents attendance changes."), "finalized wage period blocks preview");
assert.ok(validationSource.includes("loadAttendanceImportEditBlockers"), "validate route uses shared blocker helper");
assert.ok(executeSource.includes("loadAttendanceImportEditBlockers"), "execute route uses shared blocker helper");

console.log("Labour attendance import parser contract tests passed.");
