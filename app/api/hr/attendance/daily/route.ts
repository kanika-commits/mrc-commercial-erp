import { NextResponse } from "next/server";
import { insertErpAuditLog } from "@/lib/serverAudit";
import { actorName, buildAttendanceUpsertPayload, isAdminRecoveryRole, monthStart } from "@/lib/hr/attendance";
import {
  adminClient,
  assertDateEditAllowed,
  ensurePeriod,
  jsonError,
  loadAttendanceRows,
  loadDayLock,
  loadEligibleEmployees,
  loadEmployeeAttendancePolicyForScope,
  hasEmployeePostLockEditAuthority,
  isEmployeeAttendanceLockedByPolicy,
  parseDailyParams,
  requireAttendancePermission,
  requireAttendanceWrite,
  requireAttendanceView,
  validateCompanySiteScope,
  validateDailyPayload,
  validateEditablePeriod,
} from "../_shared";

export async function GET(request: Request) {
  try {
    const auth = await requireAttendanceView(request);
    if ("response" in auth) return auth.response;

    const params = parseDailyParams(request.url);
    if ("error" in params) return jsonError(String(params.error), 400);

    const admin = adminClient();
    const scope = await validateCompanySiteScope(admin, auth, params.companyId, params.siteId);
    if ("response" in scope) return scope.response;

    const month = monthStart(params.attendanceDate)!;
    const [employees, rows, period, dayLock, policy] = await Promise.all([
      loadEligibleEmployees(admin, {
        organizationId: scope.organizationId,
        companyId: params.companyId,
        siteId: params.siteId,
        startDate: params.attendanceDate,
        endDate: params.attendanceDate,
      }),
      loadAttendanceRows(admin, {
        organizationId: scope.organizationId,
        companyId: params.companyId,
        siteId: params.siteId,
        startDate: params.attendanceDate,
        endDate: params.attendanceDate,
      }),
      ensurePeriod(admin, auth, {
        organizationId: scope.organizationId,
        companyId: params.companyId,
        siteId: params.siteId,
        month,
      }),
      loadDayLock(admin, {
        organizationId: scope.organizationId,
        companyId: params.companyId,
        siteId: params.siteId,
        attendanceDate: params.attendanceDate,
      }),
      loadEmployeeAttendancePolicyForScope(admin, {
        organizationId: scope.organizationId,
        companyId: params.companyId,
        siteId: params.siteId,
      }),
    ]);

    const rowsByEmployee = new Map(rows.map((row: any) => [row.employee_id, row]));
    const departmentIds = Array.from(new Set(employees.map((employee: any) => employee.department_id).filter(Boolean)));
    const designationIds = Array.from(new Set(employees.map((employee: any) => employee.designation_id).filter(Boolean)));
    const [departmentResult, designationResult] = await Promise.all([
      departmentIds.length
        ? admin.from("hr_departments").select("id, department_name").in("id", departmentIds)
        : Promise.resolve({ data: [], error: null }),
      designationIds.length
        ? admin.from("hr_designations").select("id, designation_name").in("id", designationIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (departmentResult.error) throw departmentResult.error;
    if (designationResult.error) throw designationResult.error;
    const departments = new Map((departmentResult.data || []).map((row: any) => [row.id, row.department_name]));
    const designations = new Map((designationResult.data || []).map((row: any) => [row.id, row.designation_name]));
    return NextResponse.json({
      date: params.attendanceDate,
      employees,
      attendance: employees.map((employee: any) => ({
        employee: {
          ...employee,
          department_name: departments.get(employee.department_id) || null,
          designation_name: designations.get(employee.designation_id) || null,
        },
        attendance: rowsByEmployee.get(employee.id) || null,
      })),
      period,
      policy,
      day_lock: dayLock,
      can_admin_backdate: isAdminRecoveryRole(auth.roleCodes),
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load daily attendance.", 500);
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireAttendanceWrite(request);
    if ("response" in auth) return auth.response;

    const payload = await request.json().catch(() => ({}));
    const attendanceDate = String(payload.date || "").trim();
    const params = {
      companyId: String(payload.company_id || "").trim(),
      siteId: String(payload.site_id || "").trim(),
      attendanceDate,
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) return jsonError("Valid attendance date is required.", 400);

    const validationError = validateDailyPayload(payload);
    if (validationError) return jsonError(validationError, 400);

    const editAllowed = assertDateEditAllowed(auth, attendanceDate, payload.backdated_reason);
    if (!editAllowed.allowed) return jsonError(editAllowed.error || "Attendance date is not editable.", 403);

    const admin = adminClient();
    const scope = await validateCompanySiteScope(admin, auth, params.companyId, params.siteId);
    if ("response" in scope) return scope.response;

    const month = monthStart(attendanceDate)!;
    const period = await ensurePeriod(admin, auth, {
      organizationId: scope.organizationId,
      companyId: params.companyId,
      siteId: params.siteId,
      month,
    });
    const periodError = validateEditablePeriod(period);
    if (periodError) return jsonError(periodError, 403);

    const dayLock = await loadDayLock(admin, {
      organizationId: scope.organizationId,
      companyId: params.companyId,
      siteId: params.siteId,
      attendanceDate,
    });
    const policy = await loadEmployeeAttendancePolicyForScope(admin, {
      organizationId: scope.organizationId,
      companyId: params.companyId,
      siteId: params.siteId,
    });
    const lockedByPolicy = isEmployeeAttendanceLockedByPolicy(policy, attendanceDate);
    if (dayLock || lockedByPolicy) {
      if (!hasEmployeePostLockEditAuthority(auth, policy)) return jsonError("This attendance day is locked for this user.", 403);
      if (!String(payload.backdated_reason || "").trim()) return jsonError("Reason is required for editing locked attendance.", 400);
    }

    const submittedRows = payload.attendance as Array<{ employee_id: string; status: string; remarks?: string | null }>;
    const employeeIds = Array.from(new Set(submittedRows.map((row) => row.employee_id)));
    const employees = await loadEligibleEmployees(admin, {
      organizationId: scope.organizationId,
      companyId: params.companyId,
      siteId: params.siteId,
      startDate: attendanceDate,
      endDate: attendanceDate,
    });
    const eligibleIds = new Set(employees.map((employee: any) => employee.id));
    if (employeeIds.some((id) => !eligibleIds.has(id))) {
      return jsonError("One or more employees are not eligible for the selected site and date.", 403);
    }

    const existing = await loadAttendanceRows(admin, {
      organizationId: scope.organizationId,
      companyId: params.companyId,
      siteId: params.siteId,
      startDate: attendanceDate,
      endDate: attendanceDate,
    });
    const existingByEmployee = new Map(existing.map((row: any) => [row.employee_id, row]));
    const now = new Date().toISOString();
    const upserts = submittedRows.map((row) =>
      buildAttendanceUpsertPayload({
        existingRow: existingByEmployee.get(row.employee_id),
        organizationId: scope.organizationId,
        companyId: params.companyId,
        siteId: params.siteId,
        employeeId: row.employee_id,
        periodId: period.id,
        attendanceDate,
        status: row.status as any,
        remarks: row.remarks,
        backdatedReason: editAllowed.backdated ? String(payload.backdated_reason || "").trim() : null,
        actorId: auth.user.id,
        actorName: actorName(auth.user),
        actorEmail: auth.user.email || null,
        now,
      }),
    );

    const { data, error } = await admin
      .from("employee_attendance")
      .upsert(upserts, { onConflict: "employee_id,attendance_date" })
      .select("*");
    if (error) throw error;

    await insertErpAuditLog(admin, auth.user, {
      organizationId: scope.organizationId,
      companyId: params.companyId,
      siteId: params.siteId,
      moduleCode: "hr_attendance",
      entityType: "employee_attendance_day",
      action: editAllowed.backdated ? "manual_event" : "update",
      description: editAllowed.backdated
        ? `Backdated attendance saved for ${attendanceDate}.`
        : (dayLock || lockedByPolicy)
          ? `Locked attendance corrected for ${attendanceDate}.`
          : `Attendance saved for ${attendanceDate}.`,
      oldValues: existing,
      newValues: { attendance: data, locked_correction: Boolean(dayLock || lockedByPolicy), reason: String(payload.backdated_reason || "").trim() || null },
      source: "system",
    }, request);

    return NextResponse.json({ saved: data?.length || 0, attendance: data || [], period });
  } catch (error: any) {
    return jsonError(error.message || "Failed to save daily attendance.", 500);
  }
}
