import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync(new URL("../app/api/hr/attendance/approval-groups/export/route.ts", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../app/hr/attendance-approval/page.tsx", import.meta.url), "utf8");
const approvalRoute = fs.readFileSync(new URL("../app/api/hr/attendance/approval-groups/route.ts", import.meta.url), "utf8");

assert.match(route, /accessibleDailyRows\(admin, auth, \["approved"\]\)/, "export is restricted to approved daily submissions");
assert.match(route, /loadAttendanceRows\(admin, scope\)/, "export uses canonical employee attendance rows");
assert.match(route, /loadEligibleEmployees\(admin, scope(?:, \{ historicalEmployeeIds: [^}]+ \})?\)/, "export resolves employee-level rows through approval eligibility");
assert.match(route, /attendance_status/, "export accepts the employee attendance status filter");
assert.match(route, /hasAttendanceApprovalPermission\(auth, "view"\)/, "export checks approval-page view authorization");
assert.match(route, /writeBuffer\(\)/, "export produces an XLSX workbook");
assert.match(route, /Employee.*Company.*Site.*Date.*Status/s, "export includes employee, scope, date, and attendance details");
assert.match(route, /rowsByDate = new Map/, "export partitions approved rows by attendance date");
assert.match(route, /addWorksheet\(safeSheetName\(attendanceDate\)\)/, "export creates one safe worksheet per date");
assert.match(route, /rows\.forEach\(\(row, index\)/, "each date sheet writes only its own rows");
assert.match(route, /sheet\.getCell\("A2"\)\.value = `\$\{site\} · \$\{attendanceDate\}`/, "each date sheet includes site and date heading");
assert.match(route, /sheet\.autoFilter = \{ from: "A4", to: `L\$\{Math\.max\(4, rows\.length \+ 4\)\}` \}/, "date sheets filter the complete table");
assert.match(route, /ySplit: 4/, "date sheets freeze the header row");
assert.match(route, /fitToWidth: 1/, "date sheets fit columns across print pages");
assert.match(route, /getCell\(5\)\.numFmt = "dd-mmm-yyyy"/, "date cells use a readable date format");
assert.match(page, /Download Approved Attendance/, "approval page exposes the export button");
assert.match(page, /appliedSiteId/, "export uses the applied site filter");
assert.match(page, /appliedFromDate.*appliedToDate/s, "export uses the applied date range");
assert.match(page, /query\.set\("attendance_status", statusFilter\)/, "export forwards the row status filter");
assert.match(approvalRoute, /loadActorOrganizationScope/, "approval queue applies organization scope");
assert.match(approvalRoute, /loadActorAssignments/, "approval queue applies assignment scope");
console.log("HR approved attendance export contract checks passed.");
