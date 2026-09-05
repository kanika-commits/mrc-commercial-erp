import { NextResponse } from "next/server";
import {
  audit,
  findOrCreateAttendancePeriod,
  jsonError,
  requireLabourPermission,
} from "@/app/api/labour/_shared";
import { loadAttendanceImportEditBlockers, loadBatchRows, loadScopedAttendanceImportBatch } from "@/app/api/labour/attendance-import/_shared";
import { buildLabourAttendanceUpsertPayload } from "@/lib/labour/operations";

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_attendance_import", "execute");
    if ("response" in access) return access.response;
    const { batch_id } = await request.json().catch(() => ({}));
    if (!batch_id) return jsonError("Batch ID is required.");

    const batch = await loadScopedAttendanceImportBatch(access, batch_id);
    if (!batch) return jsonError("Import batch not found.", 404);
    const rows = (await loadBatchRows(access, batch_id)).filter(
      (row: any) =>
        ["ready", "warning"].includes(row.validation_status) &&
        row.selected_action === "import" &&
        row.execution_status === "pending",
    );

    let executed = 0;
    let failed = 0;
    const periodByMonth = new Map<string, any>();

    for (const row of rows) {
      try {
        const normalized = row.normalized_data || {};
        if (!row.matched_labour_worker_id || !row.matched_deployment_id || !row.attendance_date || !normalized.status) {
          throw new Error("Row is not ready for execution.");
        }

        const month = String(row.attendance_date).slice(0, 7);
        if (!periodByMonth.has(month)) {
          periodByMonth.set(month, await findOrCreateAttendancePeriod(access, {
            organizationId: batch.organization_id,
            companyId: batch.selected_company_id,
            siteId: batch.selected_site_id,
            contractorProfileId: batch.selected_contractor_profile_id,
            attendanceDate: row.attendance_date,
            originatingAttendanceSystem: "standard",
          }));
        }
        const period = periodByMonth.get(month);
        const editBlockers = await loadAttendanceImportEditBlockers(access, {
          organizationId: batch.organization_id,
          companyId: batch.selected_company_id,
          siteId: batch.selected_site_id,
          contractorProfileId: batch.selected_contractor_profile_id,
          attendanceDate: row.attendance_date,
          period,
        });
        if (editBlockers.length) throw new Error(editBlockers.join(" "));

        const { data: existingRow, error: existingError } = await access.admin
          .from("labour_attendance")
          .select("*")
          .eq("period_id", period.id)
          .eq("labour_worker_id", row.matched_labour_worker_id)
          .eq("attendance_date", row.attendance_date)
          .maybeSingle();
        if (existingError) throw existingError;
        const now = new Date().toISOString();
        const attendancePayload = buildLabourAttendanceUpsertPayload({
          existingRow,
          organizationId: batch.organization_id,
          companyId: batch.selected_company_id,
          siteId: batch.selected_site_id,
          contractorProfileId: batch.selected_contractor_profile_id,
          labourWorkerId: row.matched_labour_worker_id,
          deploymentId: row.matched_deployment_id,
          periodId: period.id,
          attendanceDate: row.attendance_date,
          status: normalized.status,
          overtimeMinutes: normalized.overtime_minutes || 0,
          remarks: normalized.remarks,
          source: "import",
          importBatchId: batch_id,
          importRowId: row.id,
          actorId: access.auth.user.id,
          actorName: access.auth.user.user_metadata?.full_name || access.auth.user.user_metadata?.name || access.auth.user.email || "Unknown User",
          actorEmail: access.auth.user.email || null,
          now,
        });
        const { data, error } = await access.admin
          .from("labour_attendance")
          .upsert(attendancePayload, { onConflict: "period_id,labour_worker_id,attendance_date" })
          .select("id")
          .single();
        if (error) throw error;

        await access.admin.from("labour_attendance_import_rows").update({
          execution_status: "executed",
          validation_status: "executed",
          imported_attendance_id: data.id,
          updated_at: new Date().toISOString(),
        }).eq("id", row.id);

        await audit(access, request, {
          moduleCode: "labour_attendance_import",
          action: "import",
          entityType: "labour_attendance",
          recordId: data.id,
          organizationId: batch.organization_id,
          companyId: batch.selected_company_id,
          siteId: batch.selected_site_id,
          description: `Imported labour attendance from row ${row.source_row_number}${row.source_column ? ` column ${row.source_column}` : ""}.`,
          importBatchId: batch_id,
          newValues: {
            labour_worker_id: row.matched_labour_worker_id,
            attendance_date: row.attendance_date,
            status: normalized.status,
            source: "import",
          },
        });
        executed += 1;
      } catch (rowError: any) {
        failed += 1;
        await access.admin.from("labour_attendance_import_rows").update({
          execution_status: "failed",
          validation_status: "failed",
          validation_errors: [rowError.message || "Execution failed."],
          updated_at: new Date().toISOString(),
        }).eq("id", row.id);
      }
    }

    await access.admin.from("labour_attendance_import_batches").update({
      status: failed ? "failed" : "executed",
      summary: { ...(batch.summary || {}), executed_rows: executed, failed_rows: failed },
      executed_at: new Date().toISOString(),
      executed_by: access.auth.user.id,
      executed_by_name: access.auth.user.user_metadata?.full_name || access.auth.user.email,
      executed_by_email: access.auth.user.email || null,
      updated_at: new Date().toISOString(),
    }).eq("id", batch_id);

    return NextResponse.json({ executed, failed });
  } catch (error: any) {
    return jsonError(error.message || "Failed to execute labour attendance import.", 500);
  }
}
