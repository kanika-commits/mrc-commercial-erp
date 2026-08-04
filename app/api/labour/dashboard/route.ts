import { NextResponse } from "next/server";
import { jsonError, loadEligibleDeployments, requireLabourPermission, validateCompanySite } from "@/app/api/labour/_shared";
import { isoDate } from "@/lib/labour/operations";
import { normalizeText } from "@/lib/labour/constants";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

export async function GET(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_attendance", "view");
    if ("response" in access) return access.response;
    const { searchParams } = new URL(request.url);
    const organizationId = text(searchParams.get("organization_id")) || (Array.isArray(access.organizationScope) ? access.organizationScope[0] : null);
    const companyId = text(searchParams.get("company_id"));
    const siteId = text(searchParams.get("site_id"));
    const date = isoDate(searchParams.get("date"));
    if (!organizationId || !companyId || !siteId || !date) return jsonError("Company, site and date are required.");
    const scopeCheck = await validateCompanySite(access, organizationId, companyId, siteId);
    if ("error" in scopeCheck) return jsonError(scopeCheck.error || "Selected company/site is not available.", 403);

    const deployments = await loadEligibleDeployments(access, { organizationId, companyId, siteId, attendanceDate: date });
    const workerIds = deployments.map((row: any) => row.labour_worker_id);
    const [attendanceResult, workLogsResult, overtimeResult] = await Promise.all([
      workerIds.length
        ? access.admin.from("labour_attendance").select("status, overtime_minutes, labour_worker_id, contractor_profile_id").eq("attendance_date", date).in("labour_worker_id", workerIds)
        : Promise.resolve({ data: [], error: null }),
      access.admin.from("labour_daily_work_logs").select("id, work_type, status").eq("organization_id", organizationId).eq("company_id", companyId).eq("site_id", siteId).eq("work_date", date),
      access.admin.from("labour_overtime_requests").select("id, status, proposed_minutes, approved_minutes").eq("organization_id", organizationId).eq("company_id", companyId).eq("site_id", siteId),
    ]);
    for (const result of [attendanceResult, workLogsResult, overtimeResult]) if (result.error) throw result.error;

    const attendance = attendanceResult.data || [];
    const workLogs = workLogsResult.data || [];
    const overtime = overtimeResult.data || [];
    const contractorCounts = new Map<string, number>();
    const categoryCounts = new Map<string, number>();
    const modelCounts = new Map<string, number>();
    for (const deployment of deployments) {
      const contractor = deployment.labour_contractor_profiles?.vendors?.vendor_name || "No Contractor";
      contractorCounts.set(contractor, (contractorCounts.get(contractor) || 0) + 1);
      const category = deployment.labour_trades?.trade_name || deployment.trade || "Unassigned";
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
      const model = deployment.commercial_model || "contract_basis";
      modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
    }
    return NextResponse.json({
      summary: {
        total_deployed: deployments.length,
        present: attendance.filter((row: any) => row.status === "present").length,
        absent: attendance.filter((row: any) => row.status === "absent").length,
        half_day: attendance.filter((row: any) => row.status === "half_day").length,
        contract_basis: modelCounts.get("contract_basis") || 0,
        daily_wage: modelCounts.get("daily_wage") || 0,
        productive_work_logs: workLogs.filter((row: any) => row.work_type === "productive").length,
        non_productive_work_logs: workLogs.filter((row: any) => row.work_type === "non_productive").length,
        ot_proposed: overtime.filter((row: any) => Number(row.proposed_minutes || 0) > 0).length,
        ot_approved: overtime.filter((row: any) => row.status === "approved").length,
        missing_work_logs: Math.max(0, attendance.filter((row: any) => ["present", "half_day"].includes(row.status)).length - workLogs.length),
      },
      contractor_counts: Array.from(contractorCounts, ([label, count]) => ({ label, count })),
      category_counts: Array.from(categoryCounts, ([label, count]) => ({ label, count })),
      model_counts: Array.from(modelCounts, ([label, count]) => ({ label, count })),
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load labour dashboard.", 500);
  }
}
