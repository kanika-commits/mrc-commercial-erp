import { NextResponse } from "next/server";
import { audit, jsonError, requireLabourPermission } from "@/app/api/labour/_shared";
import { calculateDailyWage, monthStart, shiftHoursFromTimes } from "@/lib/labour/operations";
import { applyCompanySiteScope } from "@/app/api/labour/_shared";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";

async function loadWagePeriod(access: any, id: string) {
  let query = access.admin.from("labour_wage_periods").select("*").eq("id", id);
  const orgScoped = applyOrganizationScope(query, access.organizationScope);
  if (!orgScoped) return null;
  query = applyCompanySiteScope(orgScoped, access.assignments);
  if (!query) return null;
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

function monthEnd(periodMonth: string) {
  const [year, month] = periodMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, "labour_wages", "add");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const wagePeriod = await loadWagePeriod(access, id);
    if (!wagePeriod) return jsonError("Wage period not found.", 404);
    if (wagePeriod.status === "finalized") return jsonError("Finalized wage period cannot be recalculated.", 403);

    const { data: attendancePeriod, error: periodError } = await access.admin
      .from("labour_attendance_periods")
      .select("*")
      .eq("id", wagePeriod.attendance_period_id)
      .maybeSingle();
    if (periodError) throw periodError;
    if (!attendancePeriod || attendancePeriod.status !== "finalized") {
      return jsonError("Finalize the attendance period before calculating wages.", 403);
    }

    const periodMonth = monthStart(wagePeriod.period_month)!;
    const end = monthEnd(periodMonth);
    const [attendanceResult, policyResult] = await Promise.all([
      access.admin
        .from("labour_attendance")
        .select("*, labour_workers(labour_code, worker_name)")
        .eq("period_id", wagePeriod.attendance_period_id)
        .eq("organization_id", wagePeriod.organization_id)
        .eq("company_id", wagePeriod.company_id)
        .eq("site_id", wagePeriod.site_id)
        .gte("attendance_date", periodMonth)
        .lte("attendance_date", end),
      access.admin
        .from("labour_site_attendance_policies")
        .select("shift_start_time, shift_end_time")
        .eq("organization_id", wagePeriod.organization_id)
        .eq("company_id", wagePeriod.company_id)
        .eq("site_id", wagePeriod.site_id)
        .eq("status", "active")
        .is("effective_to", null)
        .maybeSingle(),
    ]);
    const attendanceRows = attendanceResult.data || [];
    const attendanceError = attendanceResult.error;
    if (attendanceError) throw attendanceError;
    if (policyResult.error) throw policyResult.error;
    if (!policyResult.data?.shift_start_time || !policyResult.data?.shift_end_time) {
      return jsonError("Configure Attendance Policy shift timings before calculating wages.", 403);
    }
    const shiftHours = shiftHoursFromTimes(policyResult.data?.shift_start_time, policyResult.data?.shift_end_time);
    const scopedAttendance = (attendanceRows || []).filter((row: any) =>
      wagePeriod.contractor_profile_id ? row.contractor_profile_id === wagePeriod.contractor_profile_id : !row.contractor_profile_id,
    );
    const workerIds = Array.from(new Set(scopedAttendance.map((row: any) => row.labour_worker_id)));
    const ratesResult = workerIds.length
      ? await access.admin.from("labour_wage_rates").select("*").in("labour_worker_id", workerIds).neq("status", "cancelled").lte("effective_from", end).or(`effective_to.is.null,effective_to.gte.${periodMonth}`)
      : { data: [], error: null };
    if (ratesResult.error) throw ratesResult.error;
    const ratesByWorker = new Map<string, any[]>();
    for (const rate of ratesResult.data || []) {
      ratesByWorker.set(rate.labour_worker_id, [...(ratesByWorker.get(rate.labour_worker_id) || []), rate]);
    }

    const rowsByWorker = new Map<string, any[]>();
    for (const row of scopedAttendance) rowsByWorker.set(row.labour_worker_id, [...(rowsByWorker.get(row.labour_worker_id) || []), row]);

    const linePayloads = [];
    for (const workerId of workerIds) {
      const workerAttendance = rowsByWorker.get(workerId) || [];
      const isContractBasis = workerAttendance.every((row: any) => (row.commercial_model || "contract_basis") === "contract_basis");
      if (isContractBasis) {
        linePayloads.push({
          wage_period_id: id,
          labour_worker_id: workerId,
          deployment_id: workerAttendance[0]?.deployment_id || null,
          wage_rate_id: null,
          wage_type: "contract_basis",
          base_rate: 0,
          present_days: workerAttendance.filter((row: any) => row.status === "present").length,
          half_days: workerAttendance.filter((row: any) => row.status === "half_day").length,
          payable_days: 0,
          basic_wages: 0,
          overtime_minutes: 0,
          overtime_hours: 0,
          overtime_amount: 0,
          gross_wages: 0,
          advance_recovery: 0,
          other_deductions: 0,
          net_wages: 0,
          calculation_details: { review_required: false, wage_status: "Contract Basis — Paid through Commercial WO / RA Bill" },
        });
        continue;
      }
      const workerRates = (ratesByWorker.get(workerId) || []).filter((rate) => rate.effective_from <= end && (!rate.effective_to || rate.effective_to >= periodMonth));
      const rate = workerRates.sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0];
      if (!rate) {
        linePayloads.push({
          wage_period_id: id,
          labour_worker_id: workerId,
          deployment_id: workerAttendance[0]?.deployment_id || null,
          wage_rate_id: null,
          wage_type: null,
          base_rate: 0,
          calculation_details: { review_required: true, reason: "No effective wage rate found." },
        });
        continue;
      }
      let calc;
      if (rate.wage_type === "daily") {
        calc = calculateDailyWage({
          attendance: workerAttendance.map((row: any) => ({ status: row.status, overtime_minutes: row.approved_overtime_minutes ?? row.overtime_minutes })),
          baseRate: Number(rate.base_rate || 0),
          shiftHours,
          weeklyOffPaid: rate.weekly_off_paid,
          holidayPaid: rate.holiday_paid,
        });
      } else {
        calc = {
          present_days: 0,
          half_days: 0,
          weekly_off_days: 0,
          holiday_days: 0,
          leave_days: 0,
          overtime_minutes: workerAttendance.reduce((sum: number, row: any) => sum + Number(row.overtime_minutes || 0), 0),
          overtime_hours: 0,
          overtime_days: 0,
          attendance_days: 0,
          payable_days: 0,
          basic_wages: 0,
          overtime_amount: 0,
          gross_wages: 0,
        };
      }
      const recovery = 0;
      const net = Math.max(0, Number(calc.gross_wages || 0) - recovery);
      linePayloads.push({
        wage_period_id: id,
        labour_worker_id: workerId,
        deployment_id: workerAttendance[0]?.deployment_id || null,
        wage_rate_id: rate.id,
        wage_type: rate.wage_type,
        base_rate: rate.base_rate,
        ...calc,
        advance_recovery: recovery,
        other_deductions: 0,
        net_wages: net,
        payment_status: "unpaid",
        paid_amount: 0,
        calculation_details: rate.wage_type === "daily"
          ? { review_required: false, attendance_days: calc.attendance_days, ot_days: calc.overtime_days, shift_hours: shiftHours, wage_rule: "daily_rate_ot_days" }
          : { review_required: true, reason: `${rate.wage_type} calculation requires approved rules.` },
      });
    }

    const summary = {
      worker_count: linePayloads.length,
      gross_wages: linePayloads.reduce((sum, row: any) => sum + Number(row.gross_wages || 0), 0),
      advance_recovery: linePayloads.reduce((sum, row: any) => sum + Number(row.advance_recovery || 0), 0),
      net_wages: linePayloads.reduce((sum, row: any) => sum + Number(row.net_wages || 0), 0),
      review_required: linePayloads.filter((row: any) => row.calculation_details?.review_required).length,
    };
    const { error: replaceError } = await access.admin.rpc("replace_labour_wage_lines", {
      p_wage_period_id: id,
      p_lines: linePayloads,
      p_summary: summary,
      p_actor_id: access.auth.user.id,
      p_actor_name: access.auth.user.user_metadata?.full_name || access.auth.user.user_metadata?.name || access.auth.user.email || "Unknown User",
      p_actor_email: access.auth.user.email || null,
    });
    if (replaceError) throw replaceError;
    await audit(access, request, {
      moduleCode: "labour_wages",
      action: "update",
      entityType: "labour_wage_period",
      recordId: id,
      organizationId: wagePeriod.organization_id,
      companyId: wagePeriod.company_id,
      siteId: wagePeriod.site_id,
      description: "Calculated labour wage period.",
      newValues: summary,
    });
    return NextResponse.json({ calculated: true, summary });
  } catch (error: any) {
    return jsonError(error.message || "Failed to calculate wage period.", 500);
  }
}
