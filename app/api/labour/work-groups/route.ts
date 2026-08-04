import { NextResponse } from "next/server";
import {
  actorFields,
  applyCompanySiteScope,
  audit,
  jsonError,
  loadEligibleDeployments,
  loadLabourEditLockBlocker,
  requireLabourPermission,
  validateContractorProfile,
  validateLabourCompanySiteIndependent,
  validateWorkOrder,
} from "@/app/api/labour/_shared";
import { COMMERCIAL_MODELS, dateText, isAllowed, LABOUR_WORK_GROUP_STATUSES } from "@/lib/labour/v2";
import { normalizeText } from "@/lib/labour/constants";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

function textArray(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => text(item)).filter((item): item is string => Boolean(item))))
    : [];
}

async function validateMwo(access: any, organizationId: string, companyId: string, siteId: string, id?: string | null) {
  if (!id) return { mwo: null };
  const { data, error } = await access.admin.from("manpower_work_orders").select("id, organization_id, company_id, site_id, status").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data || data.organization_id !== organizationId || data.company_id !== companyId || data.site_id !== siteId || data.status !== "approved") return { error: "Selected Manpower Work Order is not available." };
  return { mwo: data };
}

export async function GET(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_work_groups", "view");
    if ("response" in access) return access.response;
    const { searchParams } = new URL(request.url);
    let query = access.admin
      .from("labour_work_groups")
      .select("*, companies(company_name), sites(site_name), labour_contractor_profiles(vendors(vendor_name)), manpower_work_orders(manpower_wo_number, title), work_orders(wo_number), labour_work_group_members(id, labour_worker_id, attendance_id, deployment_id, joined_from, joined_to, role_snapshot, category_snapshot, labour_workers(labour_code, worker_name, father_or_husband_name))")
      .order("work_date", { ascending: false });
    const scoped = applyOrganizationScope(query, access.organizationScope);
    if (!scoped) return NextResponse.json({ work_groups: [] });
    query = applyCompanySiteScope(scoped, access.assignments);
    if (!query) return NextResponse.json({ work_groups: [] });
    if (searchParams.get("date")) query = query.eq("work_date", searchParams.get("date"));
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ work_groups: data || [] });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load work groups.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_work_groups", "add");
    if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    const requestedOrganizationId = text(payload.organization_id) || (Array.isArray(access.organizationScope) ? access.organizationScope[0] : null);
    const companyId = text(payload.company_id);
    const siteId = text(payload.site_id);
    const workDate = dateText(payload.work_date);
    const commercialModel = text(payload.commercial_model) || "contract_basis";
    if (!companyId || !siteId || !workDate) return jsonError("Company, site and work date are required.");
    if (!isAllowed(COMMERCIAL_MODELS, commercialModel)) return jsonError("Invalid commercial model.");
    const scopeCheck = await validateLabourCompanySiteIndependent(access, requestedOrganizationId, companyId, siteId);
    if ("error" in scopeCheck) return jsonError(scopeCheck.error || "Selected company/site is not available.", 403);
    const organizationId = scopeCheck.organizationId;
    const lockBlocker = await loadLabourEditLockBlocker(access, { organizationId, companyId, siteId, contractorProfileId: text(payload.contractor_profile_id), attendanceDate: workDate });
    if (lockBlocker) return jsonError(lockBlocker, 403);
    const contractorCheck = await validateContractorProfile(access, organizationId, text(payload.contractor_profile_id));
    if ("error" in contractorCheck) return jsonError(contractorCheck.error || "Selected contractor is not available.", 403);
    const woCheck = await validateWorkOrder(access, organizationId, companyId, siteId, text(payload.commercial_work_order_id));
    if ("error" in woCheck) return jsonError(woCheck.error || "Selected Commercial Work Order is not available.", 403);
    const mwoCheck = await validateMwo(access, organizationId, companyId, siteId, text(payload.manpower_work_order_id));
    if ("error" in mwoCheck) return jsonError(mwoCheck.error || "Selected Manpower Work Order is not available.", 403);
    if (commercialModel === "daily_wage" && !mwoCheck.mwo) return jsonError("Daily-wage work groups require a Manpower Work Order.");
    if (commercialModel === "contract_basis" && !woCheck.workOrder) return jsonError("Contract-basis work groups require a Commercial Work Order.");
    const status = text(payload.status) || "draft";
    if (!isAllowed(LABOUR_WORK_GROUP_STATUSES, status)) return jsonError("Invalid work group status.");
    const memberWorkerIds = textArray(payload.member_worker_ids);
    if (!memberWorkerIds.length) return jsonError("Select at least one labourer for the work group.");
    const eligibleDeployments = await loadEligibleDeployments(access, {
      organizationId,
      companyId,
      siteId,
      contractorProfileId: contractorCheck.contractor?.id || null,
      attendanceDate: workDate,
      workOrderId: woCheck.workOrder?.id || null,
      manpowerWorkOrderId: mwoCheck.mwo?.id || null,
    });
    const eligibleByWorker = new Map(eligibleDeployments.map((deployment: any) => [deployment.labour_worker_id, deployment]));
    const missingMembers = memberWorkerIds.filter((workerId) => !eligibleByWorker.has(workerId));
    if (missingMembers.length) return jsonError("One or more selected labourers are not eligible for this work group.", 403);
    const { data: attendanceRows, error: attendanceError } = await access.admin
      .from("labour_attendance")
      .select("id, labour_worker_id, status, start_time, end_time")
      .eq("attendance_date", workDate)
      .in("labour_worker_id", memberWorkerIds);
    if (attendanceError) throw attendanceError;
    const attendanceByWorker = new Map((attendanceRows || []).map((row: any) => [row.labour_worker_id, row]));
    const absentMember = memberWorkerIds.find((workerId) => {
      const attendance = attendanceByWorker.get(workerId);
      return !attendance || !["present", "half_day"].includes(attendance.status);
    });
    if (absentMember) return jsonError("Work group members must have present or half-day attendance for the selected date.", 403);
    const insertPayload = {
      organization_id: organizationId,
      company_id: companyId,
      site_id: siteId,
      work_date: workDate,
      contractor_profile_id: contractorCheck.contractor?.id || null,
      commercial_work_order_id: woCheck.workOrder?.id || null,
      manpower_work_order_id: mwoCheck.mwo?.id || null,
      commercial_model: commercialModel,
      crew_code: text(payload.crew_code),
      crew_name: text(payload.crew_name) || "Crew",
      supervisor_user_id: text(payload.supervisor_user_id),
      status,
      ...actorFields(access.auth, "created"),
    };
    const { data, error } = await access.admin.from("labour_work_groups").insert(insertPayload).select("id").single();
    if (error) throw error;
    const memberPayload = memberWorkerIds.map((workerId) => {
      const deployment = eligibleByWorker.get(workerId) as any;
      const attendance = attendanceByWorker.get(workerId) as any;
      const worker = Array.isArray(deployment.labour_workers) ? deployment.labour_workers[0] : deployment.labour_workers;
      const trade = Array.isArray(deployment.labour_trades) ? deployment.labour_trades[0] : deployment.labour_trades;
      return {
        work_group_id: data.id,
        labour_worker_id: workerId,
        attendance_id: attendance?.id || null,
        deployment_id: deployment.id,
        joined_from: attendance?.start_time || null,
        joined_to: attendance?.end_time || null,
        role_snapshot: deployment.skill_level || worker?.skill_level || null,
        category_snapshot: trade?.trade_name || deployment.trade || null,
        ...actorFields(access.auth, "created"),
      };
    });
    const { error: memberError } = await access.admin.from("labour_work_group_members").insert(memberPayload);
    if (memberError) throw memberError;
    await audit(access, request, { moduleCode: "labour_work_groups", action: "create", entityType: "labour_work_group", recordId: data.id, organizationId, companyId, siteId, description: "Created labour work group.", newValues: insertPayload });
    return NextResponse.json({ work_group_id: data.id, members: memberPayload.length });
  } catch (error: any) {
    return jsonError(error.message || "Failed to save work group.", 500);
  }
}
