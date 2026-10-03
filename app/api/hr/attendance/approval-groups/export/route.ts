import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { ATTENDANCE_STATUS_LABELS, ATTENDANCE_STATUSES } from "@/lib/hr/attendance";
import {
  adminClient,
  hasAttendanceApprovalPermission,
  loadAttendanceRows,
  loadEligibleEmployees,
  requireAttendanceApprovalActor,
} from "../../_shared";
import { accessibleDailyRows } from "../shared";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function validDate(value: string | null) {
  return !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function scopedApprovedRows(admin: any, auth: any, siteId: string, fromDate: string | null, toDate: string | null) {
  const rows = await accessibleDailyRows(admin, auth, ["approved"]);
  return rows.filter((row: any) => row.site_id === siteId
    && (!fromDate || row.attendance_date >= fromDate)
    && (!toDate || row.attendance_date <= toDate));
}

export async function GET(request: Request) {
  try {
    const auth = await requireAttendanceApprovalActor(request);
    if ("response" in auth) return auth.response;
    if (!hasAttendanceApprovalPermission(auth, "view")) {
      return NextResponse.json({ error: "You do not have permission to view attendance approvals." }, { status: 403 });
    }
    const params = new URL(request.url).searchParams;
    const siteId = params.get("site_id") || "";
    const fromDate = params.get("from_date");
    const toDate = params.get("to_date");
    const attendanceStatus = params.get("attendance_status") || "";
    if (!siteId) return NextResponse.json({ error: "Select a site before downloading approved attendance." }, { status: 400 });
    if (!validDate(fromDate) || !validDate(toDate) || (fromDate && toDate && fromDate > toDate)) {
      return NextResponse.json({ error: "A valid From/To date range is required." }, { status: 400 });
    }
    if (attendanceStatus && !ATTENDANCE_STATUSES.includes(attendanceStatus as any)) {
      return NextResponse.json({ error: "Invalid attendance status filter." }, { status: 400 });
    }

    const admin = adminClient();
    const approvedSubmissions = await scopedApprovedRows(admin, auth, siteId, fromDate, toDate);
    const companyIds = Array.from(new Set(approvedSubmissions.map((row: any) => row.company_id).filter(Boolean)));
    const siteIds = Array.from(new Set(approvedSubmissions.map((row: any) => row.site_id).filter(Boolean)));
    const [companies, sites] = await Promise.all([
      companyIds.length ? admin.from("companies").select("id, company_name, company_code").in("id", companyIds) : Promise.resolve({ data: [], error: null }),
      siteIds.length ? admin.from("sites").select("id, site_name, site_code").in("id", siteIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (companies.error) throw companies.error;
    if (sites.error) throw sites.error;
    const companyById = new Map((companies.data || []).map((row: any) => [row.id, row.company_name || row.company_code || "Company"]));
    const siteById = new Map((sites.data || []).map((row: any) => [row.id, row.site_name || row.site_code || "Site"]));
    const outputRows: any[] = [];

    for (const submission of approvedSubmissions) {
      const scope = { organizationId: submission.organization_id, companyId: submission.company_id, siteId: submission.site_id, startDate: submission.attendance_date, endDate: submission.attendance_date };
      const attendance = await loadAttendanceRows(admin, scope);
      const employees = await loadEligibleEmployees(admin, scope, {
        historicalEmployeeIds: attendance.map((row: any) => row.employee_id),
      });
      const employeeById = new Map(employees.map((employee: any) => [employee.id, employee]));
      for (const day of attendance) {
        if (attendanceStatus && day.status !== attendanceStatus) continue;
        const employee = employeeById.get(day.employee_id) || (await loadEligibleEmployees(admin, scope, { historicalEmployeeIds: [day.employee_id] })).find((item: any) => item.id === day.employee_id);
        if (!employee) continue;
        outputRows.push({
          Employee: employee.employee_name || employee.employee_code || "Employee",
          "Employee Code": employee.employee_code || "",
          Company: companyById.get(submission.company_id) || "Company",
          Site: siteById.get(submission.site_id) || "Site",
          Date: submission.attendance_date,
          Status: ATTENDANCE_STATUS_LABELS[day.status as keyof typeof ATTENDANCE_STATUS_LABELS] || day.status,
          "Check In": day.check_in || "",
          "Check Out": day.check_out || "",
          "Worked Minutes": day.worked_minutes ?? "",
          "Overtime Minutes": day.overtime_minutes ?? "",
          Remarks: day.remarks || "",
          "Approval Status": "Approved",
        });
      }
    }

    outputRows.sort((left, right) => `${left.Date}|${left.Company}|${left.Site}|${left.Employee}`.localeCompare(`${right.Date}|${right.Company}|${right.Site}|${right.Employee}`));
    const workbook = new ExcelJS.Workbook();
    const headers = ["Employee", "Employee Code", "Company", "Site", "Date", "Status", "Check In", "Check Out", "Worked Minutes", "Overtime Minutes", "Remarks", "Approval Status"];
    const titleFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF17365D" } };
    const headerFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF1F4E78" } };
    const alternateFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF2F6FA" } };
    const columnWidths = [24, 16, 24, 24, 15, 18, 14, 14, 16, 18, 30, 18];
    const dateValue = (value: string) => {
      const [year, month, day] = value.split("-").map(Number);
      return new Date(Date.UTC(year, month - 1, day));
    };
    const safeSheetName = (value: string) => value.replace(/[\\/*?:\[\]]/g, "-").slice(0, 31) || "Approved Attendance";
    const rowsByDate = new Map<string, any[]>();
    for (const row of outputRows) rowsByDate.set(row.Date, [...(rowsByDate.get(row.Date) || []), row]);

    if (!rowsByDate.size) {
      const sheet = workbook.addWorksheet("No approved rows");
      sheet.mergeCells("A1:L1");
      sheet.getCell("A1").value = "Approved Attendance";
      sheet.getCell("A1").font = { bold: true, color: { argb: "FFFFFFFF" }, size: 14 };
      sheet.getCell("A1").fill = titleFill;
      sheet.getCell("A3").value = "No approved attendance rows matched the selected filters.";
      sheet.columns = columnWidths.map((width) => ({ width }));
    }

    for (const [attendanceDate, rows] of rowsByDate) {
      const sheet = workbook.addWorksheet(safeSheetName(attendanceDate));
      const site = rows[0]?.Site || "Site";
      sheet.mergeCells("A1:L1");
      sheet.getCell("A1").value = "Approved Attendance";
      sheet.getCell("A1").font = { bold: true, color: { argb: "FFFFFFFF" }, size: 14 };
      sheet.getCell("A1").fill = titleFill;
      sheet.getCell("A1").alignment = { horizontal: "left" };
      sheet.mergeCells("A2:L2");
      sheet.getCell("A2").value = `${site} · ${attendanceDate}`;
      sheet.getCell("A2").font = { bold: true, color: { argb: "FF17365D" }, size: 11 };
      sheet.getCell("A2").alignment = { horizontal: "left" };
      sheet.getRow(4).values = headers;
      sheet.getRow(4).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(4).fill = headerFill;
      sheet.getRow(4).alignment = { vertical: "middle", wrapText: true };
      rows.forEach((row, index) => {
        const excelRow = sheet.addRow(headers.map((header) => row[header]));
        excelRow.getCell(5).value = dateValue(row.Date);
        excelRow.getCell(5).numFmt = "dd-mmm-yyyy";
        excelRow.getCell(9).numFmt = "#,##0";
        excelRow.getCell(10).numFmt = "#,##0";
        if (index % 2 === 1) excelRow.fill = alternateFill;
      });
      sheet.columns = columnWidths.map((width) => ({ width }));
      sheet.autoFilter = { from: "A4", to: `L${Math.max(4, rows.length + 4)}` };
      sheet.views = [{ state: "frozen", ySplit: 4 }];
      sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
      sheet.pageSetup.horizontalDpi = 300;
      sheet.pageSetup.verticalDpi = 300;
      sheet.getRow(1).height = 24;
      sheet.getRow(2).height = 20;
      sheet.getRow(4).height = 32;
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer as BodyInit, {
      headers: { "Content-Type": XLSX_CONTENT_TYPE, "Content-Disposition": 'attachment; filename="Approved_Attendance.xlsx"', "Cache-Control": "no-store" },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to export approved attendance." }, { status: 500 });
  }
}
