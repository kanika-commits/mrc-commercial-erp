import { NextResponse } from "next/server";
import {
  findOrCreateAttendancePeriod,
  jsonError,
  loadEligibleDeployments,
  requireLabourPermission,
  validateLabourCompanySiteIndependent,
  validateContractorProfile,
  validateTrade,
  validateWorkOrder,
} from "@/app/api/labour/_shared";
import { attendanceCode, monthStart, statusUnits } from "@/lib/labour/operations";
import { csvEscape, labelFromCode, normalizeText } from "@/lib/labour/constants";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

function daysInMonth(periodMonth: string) {
  const [year, month] = periodMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

async function loadMuster(request: Request, action: "view" | "export" = "view") {
  const access = await requireLabourPermission(request, "labour_attendance", action);
  if ("response" in access) return access;
  const { searchParams } = new URL(request.url);
  const organizationId = text(searchParams.get("organization_id")) || (Array.isArray(access.organizationScope) ? access.organizationScope[0] : null);
  const companyId = text(searchParams.get("company_id"));
  const siteId = text(searchParams.get("site_id"));
  const periodMonth = monthStart(searchParams.get("month"));
  const contractorProfileId = text(searchParams.get("contractor_profile_id"));
  const workOrderId = text(searchParams.get("work_order_id"));
  const tradeId = text(searchParams.get("trade_id"));
  if (!organizationId || !companyId || !siteId || !periodMonth) throw new Error("Company, site and month are required.");

  const scopeCheck = await validateLabourCompanySiteIndependent(access, organizationId, companyId, siteId);
  if ("error" in scopeCheck) throw new Error(scopeCheck.error);
  const contractorCheck = await validateContractorProfile(access, organizationId, contractorProfileId);
  if ("error" in contractorCheck) throw new Error(contractorCheck.error);
  const workOrderCheck = await validateWorkOrder(access, organizationId, companyId, siteId, workOrderId);
  if ("error" in workOrderCheck) throw new Error(workOrderCheck.error);
  const tradeCheck = await validateTrade(access, organizationId, tradeId);
  if ("error" in tradeCheck) throw new Error(tradeCheck.error || "Selected labour category is not available.");

  const dayCount = daysInMonth(periodMonth);
  const monthEnd = `${periodMonth.slice(0, 8)}${String(dayCount).padStart(2, "0")}`;
  const period = await findOrCreateAttendancePeriod(access, { organizationId, companyId, siteId, contractorProfileId, periodMonth, originatingAttendanceSystem: "standard" });
  const deploymentsByWorker = new Map<string, any>();
  for (let day = 1; day <= dayCount; day += 1) {
    const date = `${periodMonth.slice(0, 8)}${String(day).padStart(2, "0")}`;
    const deployments = await loadEligibleDeployments(access, { organizationId, companyId, siteId, contractorProfileId, attendanceDate: date, workOrderId, tradeId });
    for (const deployment of deployments) {
      if (!deploymentsByWorker.has(deployment.labour_worker_id)) deploymentsByWorker.set(deployment.labour_worker_id, deployment);
    }
  }
  const workerIds = Array.from(deploymentsByWorker.keys());
  const { data: attendanceRows, error: attendanceError } = workerIds.length
    ? await access.admin
      .from("labour_attendance")
      .select("labour_worker_id, attendance_date, status, overtime_minutes")
      .gte("attendance_date", periodMonth)
      .lte("attendance_date", monthEnd)
      .in("labour_worker_id", workerIds)
    : { data: [], error: null };
  if (attendanceError) throw attendanceError;

  const attendanceByWorkerDate = new Map((attendanceRows || []).map((row: any) => [`${row.labour_worker_id}:${row.attendance_date}`, row]));
  const rows = workerIds.map((workerId) => {
    const deployment = deploymentsByWorker.get(workerId);
    const worker = Array.isArray(deployment.labour_workers) ? deployment.labour_workers[0] : deployment.labour_workers;
    const workOrder = Array.isArray(deployment.work_orders) ? deployment.work_orders[0] : deployment.work_orders;
    const manpowerWorkOrder = Array.isArray(deployment.manpower_work_orders) ? deployment.manpower_work_orders[0] : deployment.manpower_work_orders;
    const dayMap: Record<string, string> = {};
    const totals: any = { present: 0, half_day: 0, absent: 0, weekly_off: 0, holiday: 0, leave: 0, not_deployed: 0, overtime_minutes: 0, payable_days: 0, missing: 0, total_recorded: 0 };
    for (let day = 1; day <= dayCount; day += 1) {
      const date = `${periodMonth.slice(0, 8)}${String(day).padStart(2, "0")}`;
      const saved = attendanceByWorkerDate.get(`${workerId}:${date}`);
      if (!saved) {
        dayMap[String(day)] = "";
        totals.missing += 1;
        continue;
      }
      dayMap[String(day)] = attendanceCode(saved.status);
      totals[saved.status] = (totals[saved.status] || 0) + 1;
      totals.overtime_minutes += Number(saved.overtime_minutes || 0);
      totals.payable_days += statusUnits(saved.status).payable;
      totals.total_recorded += 1;
    }
    return {
      labour_worker_id: workerId,
      worker,
      contractor: deployment.labour_contractor_profiles,
      work_order: workOrder || null,
      manpower_work_order: manpowerWorkOrder || null,
      commercial_model: deployment.commercial_model || "contract_basis",
      assignment_label: (deployment.commercial_model || "contract_basis") === "daily_wage"
        ? manpowerWorkOrder?.manpower_wo_number || "-"
        : workOrder?.wo_number || "-",
      trade: deployment.labour_trades || { trade_name: deployment.trade },
      skill_level: deployment.skill_level || worker?.skill_level,
      wage_type: deployment.wage_type,
      wage_rate: deployment.wage_rate,
      days: dayMap,
      totals,
    };
  });
  return { access, rows, period, day_count: dayCount, filters: { organizationId, companyId, siteId, contractorProfileId, periodMonth } };
}

export async function GET(request: Request) {
  try {
    if (new URL(request.url).searchParams.get("export") === "csv") return PUT(request);
    const result = await loadMuster(request);
    if ("response" in result) return result.response;
    return NextResponse.json({ rows: result.rows, period: result.period, day_count: result.day_count });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load labour muster.", 500);
  }
}

export async function POST(request: Request) {
  return GET(request);
}

export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

export async function PUT(request: Request) {
  try {
    const result = await loadMuster(request, "export");
    if ("response" in result) return result.response;
    const header = ["Labour Code", "Worker Name", "Father/Husband", "Contractor", "Payment Model", "Work Order", "Labour Category", ...Array.from({ length: result.day_count }, (_, i) => String(i + 1)), "Present", "Half Days", "Absent", "Weekly Off", "Holiday", "Leave", "Overtime Hours", "Payable Days", "Missing", "Total Recorded"];
    const rows = [header.join(",")];
    for (const row of result.rows) {
      rows.push([
        row.worker?.labour_code,
        row.worker?.worker_name,
        row.worker?.father_or_husband_name,
        row.contractor?.vendors?.vendor_name || "Contractor not available",
        labelFromCode(row.commercial_model),
        row.assignment_label,
        row.trade?.trade_name,
        ...Array.from({ length: result.day_count }, (_, i) => row.days[String(i + 1)] || ""),
        row.totals.present,
        row.totals.half_day,
        row.totals.absent,
        row.totals.weekly_off,
        row.totals.holiday,
        row.totals.leave,
        Math.round((row.totals.overtime_minutes / 60) * 100) / 100,
        row.totals.payable_days,
        row.totals.missing,
        row.totals.total_recorded,
      ].map(csvEscape).join(","));
    }
    return new NextResponse(rows.join("\n"), {
      headers: { "content-type": "text/csv", "content-disposition": "attachment; filename=labour-muster.csv" },
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to export labour muster.", 500);
  }
}
