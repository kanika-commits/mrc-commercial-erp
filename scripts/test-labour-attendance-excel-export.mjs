import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const exportSource = fs.readFileSync("lib/labour/attendanceExport.ts", "utf8");
const routeSource = fs.readFileSync("app/api/labour/approvals/export/route.ts", "utf8");
const approvalSource = fs.readFileSync("app/api/labour/approvals/route.ts", "utf8");
const pageSource = fs.readFileSync("app/labour/approvals/page.tsx", "utf8");

assert.match(pageSource, /\/api\/labour\/approvals\/export\?format=\$\{format\}/, "the register export button calls the attendance export route");
assert.match(routeSource, /await labourAttendanceXlsx\(context, excelRows\)/, "the XLSX route awaits workbook generation");
assert.match(approvalSource, /daily_rate_snapshot: row\.daily_rate_snapshot \?\? null/, "submitted snapshot daily rate is passed through without resolving a current deployment rate");
assert.match(routeSource, /\.from\("labour_workers"\)[\s\S]*\.select\("id, status"\)[\s\S]*\.eq\("organization_id", first\.organization_id\)/, "worker master status is loaded from the organization-scoped canonical source");
assert.match(routeSource, /worker_status: workerStatusById\.get\(row\.labour_worker_id\)/, "only the Excel row receives the master status mapping");

const baseline = execFileSync("git", ["show", "HEAD:lib/labour/attendanceExport.ts"], { encoding: "utf8" });
const pdfFunction = (source) => {
  const start = source.indexOf("export function labourAttendancePdf(");
  const end = source.indexOf("export function labourMonthlyAttendancePdf(", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return source.slice(start, end);
};
assert.equal(pdfFunction(exportSource), pdfFunction(baseline), "the existing PDF export implementation remains unchanged");

const workbookCheck = String.raw`
  import assert from "node:assert/strict";
  import ExcelJS from "exceljs";
  import { labourAttendanceXlsx } from "./lib/labour/attendanceExport.ts";

  const buffer = await labourAttendanceXlsx({
    company_name: "Example Company",
    site_name: "North Site",
    work_date: "2026-09-19",
    status: "Submitted",
    submitted_by_name: "Harpreet Singh",
    submitted_at: "19 Sept 2026, 9:50 am",
  }, [{
    labour_code: "LAB-007",
    labour_name: "Asha Worker",
    contractor_name: "Example Contractor",
    category: "Mason",
    daily_rate: 9876,
    daily_rate_snapshot: 1250.5,
    daily_rate_label: undefined,
    work_date: "2026-09-19",
    first_half_present: false,
    second_half_present: false,
    overtime_minutes: 240,
    bonus_minutes: 30,
    status: "absent",
    worker_status: "active",
  }, {
    labour_code: "LAB-008",
    labour_name: "Bina Worker",
    contractor_name: "Example Contractor",
    category: "Mason",
    daily_rate: 9876,
    daily_rate_snapshot: null,
    daily_rate_label: undefined,
    work_date: "2026-09-19",
    first_half_present: true,
    second_half_present: true,
    overtime_minutes: 0,
    bonus_minutes: 0,
    status: "present",
    worker_status: "inactive",
  }]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(buffer));
  const sheet = workbook.getWorksheet("Attendance");
  assert.ok(sheet, "attendance worksheet is generated");
  const metadata = new Map(Array.from({ length: 6 }, (_, index) => {
    const row = sheet.getRow(index + 2);
    return [String(row.getCell(1).value), row.getCell(2).value];
  }));
  assert.equal(metadata.get("Submitted By"), "Harpreet Singh", "submitter remains in report metadata");
  assert.equal(metadata.get("Submitted At"), "19 Sept 2026, 9:50 am", "submission time remains in report metadata");

  const headers = sheet.getRow(9).values.slice(1);
  const worker = sheet.getRow(10);
  const values = worker.values.slice(1);
  assert.deepEqual(headers, [
    "S.No.", "Labour Code", "Labour Name", "Contractor", "Category / Trade", "Daily Rate",
    "Attendance Date", "First Half", "Second Half", "OT Hours", "Bonus Hours", "Status",
  ]);
  assert.equal(headers.length, values.length, "worker header and value counts match exactly");
  assert.equal(headers.includes("Submitted By"), false, "submitter is not repeated in the worker table");
  const valueFor = (heading) => values[headers.indexOf(heading)];
  assert.equal(valueFor("First Half"), "Absent");
  assert.equal(valueFor("Second Half"), "Absent");
  assert.equal(valueFor("OT Hours"), 4);
  assert.equal(valueFor("Bonus Hours"), 0.5, "bonus hours contain only bonus minutes, never a half-day status");
  assert.equal(valueFor("Status"), "Active", "absent attendance remains independent from active Labour Master status");
  assert.equal(sheet.getRow(11).getCell(headers.indexOf("Status") + 1).value, "Inactive", "inactive master status is professionally labeled");
  assert.equal(valueFor("Daily Rate"), 1250.5, "export uses the historical snapshot rate");
  assert.equal(sheet.getRow(11).getCell(6).value, "-", "missing snapshot rate stays unavailable instead of using the deployment rate");
  assert.equal(valueFor("Attendance Date").toISOString(), "2026-09-19T00:00:00.000Z");
  assert.equal(sheet.getColumn(10).numFmt, "0.00");
  assert.equal(sheet.getColumn(11).numFmt, "0.00");
  assert.equal(sheet.getColumn(6).numFmt, "₹#,##0.00");
  assert.equal(sheet.views[0].ySplit, 9, "worker header is frozen");
`;
execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", workbookCheck], { stdio: "pipe" });

console.log("Labour Attendance Excel export mapping passed.");
