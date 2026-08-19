import { NextResponse } from "next/server";
import {
  audit,
  jsonError,
  loadScopedWorker,
  requireLabourPermission,
  type LabourAccess,
  validateTrade,
} from "@/app/api/labour/_shared";
import { isValidActionValue, normalizeText, SKILL_LEVELS, WAGE_TYPES } from "@/lib/labour/constants";
import { COMMERCIAL_MODELS, isAllowed } from "@/lib/labour/v2";
import { isInOrganizationScope } from "@/lib/serverOrganizationScope";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

async function validateIndependentCompanySite(access: LabourAccess, organizationId: string, companyId: string, siteId: string) {
  const [{ data: company, error: companyError }, { data: site, error: siteError }] = await Promise.all([
    access.admin.from("companies").select("id, organization_id, status").eq("id", companyId).maybeSingle(),
    access.admin.from("sites").select("id, organization_id, company_id, status").eq("id", siteId).maybeSingle(),
  ]);
  if (companyError) throw companyError;
  if (siteError) throw siteError;
  if (!company || company.organization_id !== organizationId || !isInOrganizationScope(access.organizationScope, company.organization_id)) {
    return { error: "Selected company is not available." };
  }
  if (!site || site.organization_id !== organizationId) {
    return { error: "Selected site is not available for this organization." };
  }
  if (access.assignments.companyIds && !access.assignments.companyIds.includes(companyId)) {
    return { error: "Selected company is outside your assigned scope." };
  }
  if (access.assignments.siteIds && !access.assignments.siteIds.includes(siteId)) {
    return { error: "Selected site is outside your assigned scope." };
  }
  return { company, site };
}

async function validateCommercialWorkOrderForContractor(access: LabourAccess, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
  contractorProfileId?: string | null;
  workOrderId?: string | null;
  effectiveFrom?: string | null;
}) {
  const workOrderId = text(input.workOrderId);
  if (!workOrderId) return { workOrder: null };
  const contractorProfileId = text(input.contractorProfileId);
  if (!contractorProfileId) return { error: "Labour contractor is required for Contract Basis deployment." };

  const { data: contractor, error: contractorError } = await access.admin
    .from("labour_contractor_profiles")
    .select("id, organization_id, vendor_id, contractor_status")
    .eq("id", contractorProfileId)
    .maybeSingle();
  if (contractorError) throw contractorError;
  if (!contractor || contractor.organization_id !== input.organizationId || contractor.contractor_status !== "active") {
    return { error: "Selected labour contractor is not available." };
  }
  if (!contractor.vendor_id) return { error: "This labourer's contractor is not linked to a Vendor record." };

  const { data: workOrder, error: workOrderError } = await access.admin
    .from("work_orders")
    .select("id, organization_id, company_id, site_id, status, approval_status, wo_type, start_date, end_date")
    .eq("id", workOrderId)
    .maybeSingle();
  if (workOrderError) throw workOrderError;
  if (
    !workOrder ||
    workOrder.organization_id !== input.organizationId ||
    workOrder.company_id !== input.companyId ||
    workOrder.site_id !== input.siteId ||
    workOrder.status !== "active" ||
    workOrder.approval_status !== "approved"
    || (input.effectiveFrom && workOrder.start_date && workOrder.start_date > input.effectiveFrom)
    || (input.effectiveFrom && workOrder.end_date && workOrder.end_date < input.effectiveFrom)
  ) {
    return { error: "Selected Commercial Work Order is not available for this contractor, company and site." };
  }

  const { data: link, error: linkError } = await access.admin
    .from("work_order_vendors")
    .select("id")
    .eq("work_order_id", workOrderId)
    .eq("vendor_id", contractor.vendor_id)
    .limit(1)
    .maybeSingle();
  if (linkError) throw linkError;
  if (!link) return { error: "Selected Commercial Work Order is not linked to this contractor." };

  return { workOrder };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, "labour_workers", "change_deployment");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const worker = await loadScopedWorker(access, id);
    if (!worker) return jsonError("Labourer not found.", 404);

    const payload = await request.json().catch(() => ({}));
    const companyId = text(payload.company_id);
    const siteId = text(payload.site_id);
    const effectiveFrom = text(payload.effective_from);
    const skillLevel = text(payload.skill_level);
    const wageType = text(payload.wage_type);
    const commercialModel = text(payload.commercial_model) || "contract_basis";
    const manpowerWorkOrderId = text(payload.manpower_work_order_id);
    const labourTradeId = text(payload.labour_trade_id) || text(payload.trade_id);
    const contractorProfileId = text(payload.contractor_profile_id) || worker.current_contractor_profile_id;
    const isReactivation = worker.status === "inactive";

    if (!companyId || !siteId || !effectiveFrom) return jsonError("Company, site and effective date are required.");
    if (isReactivation && !contractorProfileId) return jsonError("Contractor is required to reactivate a labourer.");
    if (!labourTradeId) return jsonError("Labour Category is required.");
    if (skillLevel && !isValidActionValue(SKILL_LEVELS, skillLevel)) return jsonError("Invalid skill level.");
    if (wageType && !isValidActionValue(WAGE_TYPES, wageType)) return jsonError("Invalid wage type.");
    if (!isAllowed(COMMERCIAL_MODELS, commercialModel)) return jsonError("Invalid commercial model.");

    const scopeCheck = await validateIndependentCompanySite(access, worker.organization_id, companyId, siteId);
    if ("error" in scopeCheck) return jsonError(scopeCheck.error || "Selected company/site is not available.", 403);
    const tradeCheck = await validateTrade(access, worker.organization_id, labourTradeId);
    if ("error" in tradeCheck) return jsonError(tradeCheck.error || "Selected Labour Category is not available.", 403);

    const workOrderCheck = (commercialModel === "contract_basis" || commercialModel === "daily_wage")
      ? await validateCommercialWorkOrderForContractor(access, {
        organizationId: worker.organization_id,
        companyId,
        siteId,
        contractorProfileId,
        workOrderId: payload.work_order_id,
        effectiveFrom,
      })
      : { workOrder: null };
    if ("error" in workOrderCheck) return jsonError(workOrderCheck.error || "Selected Commercial Work Order is not available.", 403);
    if (!isReactivation && commercialModel === "contract_basis" && !workOrderCheck.workOrder) return jsonError("Contract-basis deployment requires a Commercial Work Order.");
    if (!isReactivation && commercialModel === "daily_wage" && !workOrderCheck.workOrder) return jsonError("Daily-wage deployment requires an approved Daily Wage Work Order.");
    if (commercialModel === "daily_wage" && workOrderCheck.workOrder?.wo_type !== "Daily Wage") return jsonError("Selected Work Order is not a Daily Wage Work Order.", 403);
    if (commercialModel === "daily_wage" && (!workOrderCheck.workOrder || !Number.isFinite(Number(payload.wage_rate)) || Number(payload.wage_rate) <= 0)) return jsonError("Commercial Work Order and a positive Daily Rate are required for Daily Wage deployment.");
    if (isReactivation && !text(payload.deployment_reason)) {
      return jsonError("Reactivation Reason is required.");
    }
    if (commercialModel === "contract_basis" && !manpowerWorkOrderId) return jsonError("Contractual Labour requires an Approved Manpower Work Order.");
    let resolvedMwoRate: any = null;
    if (commercialModel === "daily_wage" && isReactivation && manpowerWorkOrderId) {
      const { data: mwo, error: mwoError } = await access.admin
        .from("manpower_work_orders")
        .select("id, organization_id, company_id, site_id, contractor_profile_id, status")
        .eq("id", manpowerWorkOrderId)
        .maybeSingle();
      if (mwoError) throw mwoError;
      if (!mwo || mwo.organization_id !== worker.organization_id || mwo.company_id !== companyId || mwo.site_id !== siteId || mwo.status !== "approved") {
        return jsonError("Selected Manpower Work Order is not available for this deployment.", 403);
      }
      if (contractorProfileId && mwo.contractor_profile_id !== contractorProfileId) {
        return jsonError("Selected Manpower Work Order belongs to a different contractor.", 403);
      }
      const { data: rate, error: rateError } = await access.admin
        .from("manpower_work_order_rates")
        .select("id, daily_rate, effective_from, effective_to, status, labour_trade_id")
        .eq("manpower_work_order_id", manpowerWorkOrderId)
        .eq("labour_trade_id", labourTradeId)
        .eq("status", "active")
        .lte("effective_from", effectiveFrom)
        .or(`effective_to.is.null,effective_to.gte.${effectiveFrom}`)
        .order("effective_from", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (rateError) throw rateError;
      if (!rate) return jsonError("Selected Manpower Work Order does not have an active rate for this Labour Category on the deployment date.", 403);
      resolvedMwoRate = rate;
    }
    if (isReactivation && commercialModel === "contract_basis") {
      const { data: mwo, error: mwoError } = await access.admin.from("manpower_work_orders").select("id, organization_id, company_id, site_id, contractor_profile_id, status").eq("id", manpowerWorkOrderId).maybeSingle();
      if (mwoError) throw mwoError;
      if (!mwo || mwo.organization_id !== worker.organization_id || mwo.company_id !== companyId || mwo.site_id !== siteId || mwo.status !== "approved" || mwo.contractor_profile_id !== contractorProfileId) return jsonError("Selected Manpower Work Order is not available for this contractor, company and site.", 403);
      const { data: rate, error: rateError } = await access.admin.from("manpower_work_order_rates").select("daily_rate, effective_from, effective_to, status, labour_trade_id").eq("manpower_work_order_id", manpowerWorkOrderId).eq("labour_trade_id", labourTradeId).eq("status", "active").lte("effective_from", effectiveFrom).or(`effective_to.is.null,effective_to.gte.${effectiveFrom}`).order("effective_from", { ascending: false }).limit(1).maybeSingle();
      if (rateError) throw rateError;
      if (!rate) return jsonError("Selected Manpower Work Order does not have an active rate for this Labour Category on the deployment date.", 403);
      resolvedMwoRate = rate;
    }

    const { data: openDeployment, error: openError } = await access.admin
      .from("labour_deployments")
      .select("id, effective_from")
      .eq("labour_worker_id", id)
      .eq("status", "active")
      .is("effective_to", null)
      .maybeSingle();
    if (openError) throw openError;
    if (openDeployment && effectiveFrom <= openDeployment.effective_from) {
      return jsonError("New deployment must start after the current deployment start date.");
    }

    let overlapQuery = access.admin
      .from("labour_deployments")
      .select("id, effective_from, effective_to")
      .eq("labour_worker_id", id)
      .lte("effective_from", effectiveFrom)
      .or(`effective_to.is.null,effective_to.gte.${effectiveFrom}`)
      .limit(1);
    if (openDeployment?.id) overlapQuery = overlapQuery.neq("id", openDeployment.id);
    const { data: overlapping, error: overlapError } = await overlapQuery.maybeSingle();
    if (overlapError) throw overlapError;
    if (overlapping) return jsonError("Another deployment already exists for the selected effective date.");
    const deploymentReason = text(payload.deployment_reason);
    if (openDeployment && (!deploymentReason || deploymentReason.trim().length < 10)) {
      return jsonError("Transfer reason must be at least 10 characters.");
    }

    const insertPayload = {
      organization_id: worker.organization_id,
      labour_worker_id: id,
      contractor_profile_id: contractorProfileId,
      company_id: companyId,
      site_id: siteId,
      work_order_id: (commercialModel === "contract_basis" && !isReactivation) || (isReactivation && commercialModel === "daily_wage") || (commercialModel === "daily_wage" && !isReactivation) ? text(payload.work_order_id) : null,
      manpower_work_order_id: isReactivation && commercialModel === "contract_basis" ? manpowerWorkOrderId : (!isReactivation ? manpowerWorkOrderId : null),
      commercial_model: commercialModel,
      trade: tradeCheck.trade?.trade_name || null,
      labour_trade_id: tradeCheck.trade?.id || null,
      skill_level: skillLevel,
      wage_type: commercialModel === "daily_wage" ? "daily" : (isReactivation ? "daily" : wageType),
      wage_rate: isReactivation ? (commercialModel === "daily_wage" ? Number(payload.wage_rate) : resolvedMwoRate?.daily_rate) : (commercialModel === "daily_wage" ? Number(payload.wage_rate) : text(payload.wage_rate)),
      effective_from: effectiveFrom,
      effective_to: text(payload.effective_to),
      status: text(payload.effective_to) ? "ended" : "active",
      deployment_reason: deploymentReason,
    };

    const rpcName = isReactivation ? "reactivate_labour_deployment" : "transfer_labour_deployment";
    const rpcArgs = {
      p_worker_id: id,
      p_organization_id: worker.organization_id,
      p_contractor_profile_id: insertPayload.contractor_profile_id,
      p_company_id: companyId,
      p_site_id: siteId,
      p_work_order_id: insertPayload.work_order_id,
      p_manpower_work_order_id: insertPayload.manpower_work_order_id,
      p_commercial_model: insertPayload.commercial_model,
      p_trade: insertPayload.trade,
      p_skill_level: insertPayload.skill_level,
      p_wage_type: insertPayload.wage_type,
      p_wage_rate: insertPayload.wage_rate ? Number(insertPayload.wage_rate) : null,
      p_effective_from: effectiveFrom,
      p_effective_to: insertPayload.effective_to,
      p_deployment_reason: insertPayload.deployment_reason,
      p_actor_id: access.auth.user.id,
      p_actor_name: access.auth.user.user_metadata?.full_name || access.auth.user.user_metadata?.name || access.auth.user.email || "Unknown User",
      p_actor_email: access.auth.user.email || null,
      ...(isReactivation ? { p_labour_trade_id: insertPayload.labour_trade_id } : {}),
    };
    const { data, error } = await access.admin.rpc(rpcName, rpcArgs);
    if (error) throw error;
    const deploymentId = Array.isArray(data) ? data[0] : data;

    if (insertPayload.labour_trade_id && !isReactivation) {
      const { error: categoryUpdateError } = await access.admin
        .from("labour_deployments")
        .update({ labour_trade_id: insertPayload.labour_trade_id })
        .eq("id", deploymentId);
      if (categoryUpdateError) throw categoryUpdateError;
      const { error: workerCategoryError } = await access.admin
        .from("labour_workers")
        .update({ labour_trade_id: insertPayload.labour_trade_id })
        .eq("id", id);
      if (workerCategoryError) throw workerCategoryError;
    }

    await audit(access, request, {
      moduleCode: "labour_deployments",
      action: openDeployment ? "update" : "create",
      entityType: "labour_deployment",
      recordId: deploymentId,
      parentEntityType: "labour_worker",
      parentRecordId: id,
      organizationId: worker.organization_id,
      companyId,
      siteId,
      description: isReactivation
        ? `Reactivated labourer ${worker.labour_code}.`
        : openDeployment ? "Transferred labourer to a new deployment." : "Created labour deployment.",
      newValues: insertPayload,
    } as any);

    return NextResponse.json({ deployment_id: deploymentId });
  } catch (error: any) {
    return jsonError(error.message || "Failed to save labour deployment.", 500);
  }
}
