import { NextResponse } from "next/server";
import { jsonError, loadScopedWorker, requireLabourPermission } from "@/app/api/labour/_shared";

const checks = [
  ["labour_attendance", "Attendance exists", "labour_worker_id"],
  ["labour_attendance_import_rows", "Attendance import data exists", "matched_labour_worker_id"],
  ["labour_attendance_submission_version_rows", "Attendance snapshot exists", "labour_worker_id"],
  ["labour_site_in_engineer_assignments", "Engineer Site-In assignment exists", "labour_worker_id"],
  ["labour_site_ins", "Site-In exists", "labour_worker_id"],
  ["labour_wage_lines", "Wage/payroll data exists", "labour_worker_id"],
  ["labour_wage_rates", "Wage-rate data exists", "labour_worker_id"],
  ["labour_work_group_members", "Work-group membership exists", "labour_worker_id"],
  ["labour_worker_rate_overrides", "Rate override exists", "labour_worker_id"],
  ["labour_advances", "Advance exists", "labour_worker_id"],
  ["labour_documents", "Document exists", "labour_worker_id"],
  ["labour_overtime_requests", "Overtime request exists", "labour_worker_id"],
] as const;
const MAX_BULK_HARD_DELETE = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function countReference(admin: any, table: string, column: string, id: string) {
  let query = admin.from(table).select("id", { count: "exact", head: true }).eq(column, id);
  if (table === "labour_advances") query = query.neq("status", "deleted");
  return (await query).count || 0;
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_workers", "hard_delete");
    if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    const rawIds = Array.isArray(payload.labour_worker_ids) ? payload.labour_worker_ids : [];
    if (rawIds.some((id: unknown) => typeof id !== "string" || !UUID_RE.test(id))) return jsonError("Every Labour worker ID must be a valid UUID.", 400);
    const ids: string[] = Array.from(new Set(rawIds as string[]));
    if (!ids.length) return jsonError("Select at least one labour worker.");
    if (ids.length > MAX_BULK_HARD_DELETE) return jsonError(`Bulk hard delete supports a maximum of ${MAX_BULK_HARD_DELETE} workers at a time.`, 400);
    const rows = [];
    for (const id of ids) {
      const worker = await loadScopedWorker(access, id);
      if (!worker) {
        rows.push({ labour_worker_id: id, safe: false, reasons: ["Worker is not available in your scope."] });
        continue;
      }
      const { data: deployments, error: deploymentError } = await access.admin.from("labour_deployments").select("id, company_id, site_id, contractor_profile_id, effective_from, effective_to, status").eq("labour_worker_id", id).order("effective_from");
      if (deploymentError) throw deploymentError;
      const reasons: string[] = [];
      if ((deployments || []).length > 1) reasons.push("Multiple/later deployments exist");
      if ((deployments || []).length === 0) reasons.push("No eligible deployment exists");
      for (const [table, reason, column] of checks) if (await countReference(access.admin, table, column, id) > 0) reasons.push(reason);
      const { count: attendanceImportDeploymentCount } = await access.admin.from("labour_attendance_import_rows").select("id", { count: "exact", head: true }).eq("matched_deployment_id", deployments?.[0]?.id || "00000000-0000-0000-0000-000000000000");
      const { count: snapshotDeploymentCount } = await access.admin.from("labour_attendance_submission_version_rows").select("id", { count: "exact", head: true }).eq("deployment_id", deployments?.[0]?.id || "00000000-0000-0000-0000-000000000000");
      if ((attendanceImportDeploymentCount || 0) > 0) reasons.push("Attendance import deployment reference exists");
      if ((snapshotDeploymentCount || 0) > 0) reasons.push("Attendance snapshot deployment reference exists");
      const { count: otherImportCount } = await access.admin.from("labour_import_rows").select("id", { count: "exact", head: true }).or(`created_labour_worker_id.eq.${id},matched_labour_worker_id.eq.${id}`);
      if ((otherImportCount || 0) > 0) reasons.push("Referenced by an import");
      rows.push({
        labour_worker_id: id,
        labour_code: worker.labour_code,
        worker_name: worker.worker_name,
        contractor: worker.contractor_name || worker.labour_contractor_profiles?.vendors?.vendor_name || null,
        company: worker.current_company_name || null,
        site: worker.current_site_name || null,
        deployment_ids: (deployments || []).map((deployment: any) => deployment.id),
        safe: reasons.length === 0,
        reasons,
      });
    }
    return NextResponse.json({ selected: ids.length, safe: rows.filter((row) => row.safe).length, blocked: rows.filter((row) => !row.safe).length, rows, ok: rows.some((row) => row.safe) });
  } catch (error: any) {
    return jsonError(error.message || "Could not preview Labour hard delete.", 500);
  }
}
