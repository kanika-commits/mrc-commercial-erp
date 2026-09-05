import { NextResponse } from "next/server";
import { requireLabourPermission } from "@/app/api/labour/_shared";
import { isWithinAssignments, loadAttendanceImportEditBlockers, loadBatchRows, loadScopedAttendanceImportBatch } from "@/app/api/labour/attendance-import/_shared";
import { jsonError } from "@/app/api/labour/_shared";
import { normalizeLookup } from "@/lib/labour/constants";
import { isFutureDate, monthStart } from "@/lib/labour/operations";
import { normalizeAttendanceStatus } from "@/lib/labour/import";

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_attendance_import", "upload");
    if ("response" in access) return access.response;
    const { batch_id } = await request.json().catch(() => ({}));
    if (!batch_id) return jsonError("Batch ID is required.");

    const batch = await loadScopedAttendanceImportBatch(access, batch_id);
    if (!batch) return jsonError("Import batch not found.", 404);
    const rows = await loadBatchRows(access, batch_id);

    const [{ data: workers, error: workersError }, { data: deployments, error: deploymentsError }] = await Promise.all([
      access.admin
        .from("labour_workers")
        .select("id, labour_code, worker_name, status")
        .eq("organization_id", batch.organization_id)
        .neq("status", "deleted"),
      access.admin
        .from("labour_deployments")
        .select("id, organization_id, labour_worker_id, contractor_profile_id, company_id, site_id, effective_from, effective_to, status, labour_trade_id")
        .eq("organization_id", batch.organization_id)
        .eq("company_id", batch.selected_company_id)
        .eq("site_id", batch.selected_site_id)
        .eq("status", "active"),
    ]);
    if (workersError) throw workersError;
    if (deploymentsError) throw deploymentsError;

    const attendanceDates = Array.from(new Set(
      rows
        .map((row: any) => row.normalized_data?.attendance_date || row.attendance_date)
        .filter(Boolean),
    )) as string[];
    const periodMonths = Array.from(new Set(attendanceDates.map((date) => monthStart(date)).filter(Boolean))) as string[];
    let existingPeriodsQuery = periodMonths.length
      ? access.admin
          .from("labour_attendance_periods")
          .select("id, period_month")
          .eq("organization_id", batch.organization_id)
          .eq("company_id", batch.selected_company_id)
          .eq("site_id", batch.selected_site_id)
          .in("period_month", periodMonths)
      : null;
    if (existingPeriodsQuery) {
      existingPeriodsQuery = batch.selected_contractor_profile_id
        ? existingPeriodsQuery.eq("contractor_profile_id", batch.selected_contractor_profile_id)
        : existingPeriodsQuery.is("contractor_profile_id", null);
    }
    const { data: existingPeriods, error: periodsError } = existingPeriodsQuery
      ? await existingPeriodsQuery
      : { data: [], error: null };
    if (periodsError) throw periodsError;
    const periodByMonth = new Map((existingPeriods || []).map((period: any) => [period.period_month, period]));
    const periodIds = Array.from(new Set((existingPeriods || []).map((period: any) => period.id).filter(Boolean)));
    const { data: existingAttendance, error: existingError } = periodIds.length
      ? await access.admin
          .from("labour_attendance")
          .select("id, period_id, labour_worker_id, attendance_date")
          .in("period_id", periodIds)
      : { data: [], error: null };
    if (existingError) throw existingError;

    const existingKeys = new Set((existingAttendance || []).map((row: any) => `${row.period_id}|${row.labour_worker_id}|${row.attendance_date}`));
    const workbookKeys = new Map<string, number>();
    const updates = [];

    for (const row of rows) {
      const normalized = row.normalized_data || {};
      const errors: string[] = [];
      const warnings: string[] = [];
      const attendanceDate = normalized.attendance_date || row.attendance_date;
      const status = normalizeAttendanceStatus(normalized.status || normalized.attendance_code || row.attendance_code);

      if (!isWithinAssignments(access, batch.selected_company_id, batch.selected_site_id)) {
        errors.push("Selected company/site is outside your assigned scope.");
      }
      if (!attendanceDate) errors.push("Attendance date is required.");
      if (attendanceDate && isFutureDate(attendanceDate)) errors.push("Future labour attendance cannot be imported.");
      if (!status) errors.push("Invalid attendance code.");

      const workerMatches = (workers || []).filter((worker: any) => {
        if (normalized.labour_code && normalizeLookup(worker.labour_code) === normalizeLookup(normalized.labour_code)) return true;
        if (normalized.worker_name && normalizeLookup(worker.worker_name) === normalizeLookup(normalized.worker_name)) return true;
        return false;
      });

      if (!workerMatches.length) errors.push("Labourer not found for selected site.");

      const deploymentMatches = attendanceDate
        ? (deployments || []).filter((item: any) =>
            workerMatches.some((worker: any) => worker.id === item.labour_worker_id) &&
            item.effective_from <= attendanceDate &&
            (!item.effective_to || item.effective_to >= attendanceDate) &&
            (batch.selected_contractor_profile_id ? item.contractor_profile_id === batch.selected_contractor_profile_id : true)
          )
        : [];

      if (workerMatches.length && !deploymentMatches.length) errors.push("No active deployment exists for this labourer on the attendance date.");
      if (deploymentMatches.length > 1) errors.push("Multiple labourers match this row.");

      const deployment = deploymentMatches.length === 1 ? deploymentMatches[0] : null;
      const worker = deployment ? (workers || []).find((item: any) => item.id === deployment.labour_worker_id) : null;
      if (worker && worker.status !== "active") errors.push("Matched labourer is not active.");

      if (attendanceDate) {
        const editBlockers = await loadAttendanceImportEditBlockers(access, {
          organizationId: batch.organization_id,
          companyId: batch.selected_company_id,
          siteId: batch.selected_site_id,
          contractorProfileId: batch.selected_contractor_profile_id,
          attendanceDate,
        });
        for (const blocker of editBlockers) {
          if (!errors.includes(blocker)) errors.push(blocker);
        }
      }

      const periodMonth = monthStart(attendanceDate);
      if (periodMonth && batch.selected_period_month && periodMonth !== batch.selected_period_month) {
        errors.push("Attendance date is outside the selected month.");
      }

      const key = worker && attendanceDate ? `${worker.id}|${attendanceDate}` : `${row.source_row_number}|${row.source_column || ""}`;
      workbookKeys.set(key, (workbookKeys.get(key) || 0) + 1);
      if (workbookKeys.get(key)! > 1) errors.push("Duplicate attendance row in workbook.");
      const period = attendanceDate ? periodByMonth.get(monthStart(attendanceDate)) : null;
      if (worker && attendanceDate && period && existingKeys.has(`${period.id}|${worker.id}|${attendanceDate}`)) {
        warnings.push("Existing attendance will be updated.");
      }

      updates.push({
        id: row.id,
        matched_labour_worker_id: worker?.id || null,
        matched_deployment_id: deployment?.id || null,
        matched_company_id: batch.selected_company_id,
        matched_site_id: batch.selected_site_id,
        attendance_date: attendanceDate || null,
        attendance_code: normalized.attendance_code || row.attendance_code || null,
        normalized_data: { ...normalized, attendance_date: attendanceDate || null, status },
        validation_status: errors.length ? "blocked" : warnings.length ? "warning" : "ready",
        validation_errors: errors,
        validation_warnings: warnings,
        selected_action: errors.length ? "skip" : "import",
        updated_at: new Date().toISOString(),
      });
    }

    for (const update of updates) {
      const { id, ...payload } = update;
      const { error } = await access.admin.from("labour_attendance_import_rows").update(payload).eq("id", id).eq("batch_id", batch_id);
      if (error) throw error;
    }

    const summary = {
      total_rows: updates.length,
      ready_rows: updates.filter((row) => row.validation_status === "ready" || row.validation_status === "warning").length,
      blocked_rows: updates.filter((row) => row.validation_status === "blocked").length,
      warnings: updates.filter((row) => row.validation_status === "warning").length,
    };
    await access.admin.from("labour_attendance_import_batches").update({ status: "validated", summary, updated_at: new Date().toISOString() }).eq("id", batch_id);
    return NextResponse.json({ summary });
  } catch (error: any) {
    return jsonError(error.message || "Failed to validate labour attendance import.", 500);
  }
}
