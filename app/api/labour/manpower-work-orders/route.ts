import { NextResponse } from "next/server";
import {
  actorFields,
  applyCompanySiteScope,
  audit,
  jsonError,
  requireLabourPermission,
  type LabourAccess,
  validateContractorProfile,
  validateWorkOrder,
} from "@/app/api/labour/_shared";
import { normalizeText } from "@/lib/labour/constants";
import {
  CONTRACTOR_PROFIT_TYPES,
  dateText,
  isAllowed,
  MANPOWER_ENGAGEMENT_TYPES,
  numberOrNull,
  OVERTIME_BASIS,
  timeText,
} from "@/lib/labour/v2";
import { applyOrganizationScope, isInOrganizationScope } from "@/lib/serverOrganizationScope";

const MODULE = "labour_manpower_work_orders";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

function actorName(access: any) {
  return access.auth.user.user_metadata?.full_name || access.auth.user.user_metadata?.name || access.auth.user.email || "Unknown User";
}

async function assertUniqueNumber(access: any, organizationId: string, number: string, ignoreId?: string) {
  let query = access.admin
    .from("manpower_work_orders")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("manpower_wo_number", number);
  if (ignoreId) query = query.neq("id", ignoreId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? { error: "Manpower Work Order number already exists." } : { ok: true };
}

function actionPermission(action: string | null) {
  if (action === "submit") return "submit";
  if (action === "approve" || action === "complete") return "approve";
  if (["send_back", "reject", "cancel"].includes(action || "")) return "reject";
  if (action === "suspend") return "suspend";
  if (action === "resume") return "resume";
  return null;
}

function requireStatus(existingStatus: string, allowed: string[], message: string) {
  return allowed.includes(existingStatus) ? null : message;
}

function scopedMwo(access: LabourAccess, mwo: any) {
  if (access.organizationScope !== null && !access.organizationScope.includes(mwo.organization_id)) return false;
  if (access.assignments.companyIds?.length && !access.assignments.companyIds.includes(mwo.company_id)) return false;
  if (access.assignments.siteIds?.length && !access.assignments.siteIds.includes(mwo.site_id)) return false;
  if (access.assignments.companyIds && access.assignments.siteIds && !access.assignments.companyIds.length && !access.assignments.siteIds.length) return false;
  return true;
}

async function validateIndependentCompanySite(access: any, requestedOrganizationId: string | null, companyId: string, siteId: string) {
  const [{ data: company, error: companyError }, { data: site, error: siteError }] = await Promise.all([
    access.admin.from("companies").select("id, organization_id, status").eq("id", companyId).maybeSingle(),
    access.admin.from("sites").select("id, organization_id, company_id, status").eq("id", siteId).maybeSingle(),
  ]);
  if (companyError) throw companyError;
  if (siteError) throw siteError;
  if (!company || !isInOrganizationScope(access.organizationScope, company.organization_id)) {
    return { error: "Selected company is not available." };
  }
  if (requestedOrganizationId && requestedOrganizationId !== company.organization_id) {
    return { error: "Selected company is not available." };
  }
  if (!site || site.organization_id !== company.organization_id) {
    return { error: "Selected site is not available for this organization." };
  }
  if (access.assignments.companyIds && !access.assignments.companyIds.includes(companyId)) {
    return { error: "Selected company is outside your assigned scope." };
  }
  if (access.assignments.siteIds && !access.assignments.siteIds.includes(siteId)) {
    return { error: "Selected site is outside your assigned scope." };
  }
  return { organizationId: company.organization_id, company, site };
}

export async function GET(request: Request) {
  try {
    const access = await requireLabourPermission(request, MODULE, "view");
    if ("response" in access) return access.response;
    const { searchParams } = new URL(request.url);
    const status = text(searchParams.get("status"));
    const companyId = text(searchParams.get("company_id"));
    const siteId = text(searchParams.get("site_id"));

    let query = access.admin
      .from("manpower_work_orders")
      .select(`
        *,
        companies(company_name, company_code),
        sites(site_name, site_code),
        labour_contractor_profiles(id, contractor_code, vendors(vendor_name)),
        work_orders(id, wo_number)
      `)
      .order("created_at", { ascending: false });
    const scoped = applyOrganizationScope(query, access.organizationScope);
    if (!scoped) return NextResponse.json({ manpower_work_orders: [] });
    query = applyCompanySiteScope(scoped, access.assignments);
    if (!query) return NextResponse.json({ manpower_work_orders: [] });
    if (status) query = query.eq("status", status);
    if (companyId) query = query.eq("company_id", companyId);
    if (siteId) query = query.eq("site_id", siteId);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ manpower_work_orders: data || [] });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load Manpower Work Orders.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, MODULE, "add");
    if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    const requestedOrganizationId = text(payload.organization_id);
    const companyId = text(payload.company_id);
    const siteId = text(payload.site_id);
    const contractorProfileId = text(payload.contractor_profile_id);
    const manpowerWoNumber = text(payload.manpower_wo_number);
    const title = text(payload.title);
    const effectiveFrom = dateText(payload.effective_from);
    const effectiveTo = dateText(payload.effective_to);
    const engagementType = text(payload.engagement_type) || "daily_wage";
    const overtimeBasis = text(payload.overtime_basis) || "category_rate";
    const contractorProfitType = text(payload.contractor_profit_type) || "none";
    const contractorProfitValue = numberOrNull(payload.contractor_profit_value) || 0;
    const status = "draft";

    if (!companyId || !siteId) return jsonError("Company and site are required.");
    if (!contractorProfileId) return jsonError("Contractor is required.");
    if (!manpowerWoNumber) return jsonError("Manpower Work Order number is required.");
    if (!title) return jsonError("Title is required.");
    if (!effectiveFrom) return jsonError("Effective From date is required.");
    if (effectiveTo && effectiveTo < effectiveFrom) return jsonError("Effective To cannot be before Effective From.");
    if (!isAllowed(MANPOWER_ENGAGEMENT_TYPES, engagementType)) return jsonError("Invalid engagement type.");
    if (!isAllowed(OVERTIME_BASIS, overtimeBasis)) return jsonError("Invalid overtime basis.");
    if (!isAllowed(CONTRACTOR_PROFIT_TYPES, contractorProfitType)) return jsonError("Invalid contractor profit type.");
    if (contractorProfitValue < 0) return jsonError("Contractor Profit Value must be non-negative.");

    const scopeCheck = await validateIndependentCompanySite(access, requestedOrganizationId, companyId, siteId);
    if ("error" in scopeCheck) return jsonError(scopeCheck.error || "Selected company/site is not available.", 403);
    const organizationId = scopeCheck.organizationId;
    const contractorCheck = await validateContractorProfile(access, organizationId, contractorProfileId);
    if ("error" in contractorCheck) return jsonError(contractorCheck.error || "Selected contractor is not available.", 403);
    const workOrderId = text(payload.commercial_work_order_id);
    const workOrderCheck = await validateWorkOrder(access, organizationId, companyId, siteId, workOrderId);
    if ("error" in workOrderCheck) return jsonError(workOrderCheck.error || "Linked Commercial Work Order is not available.", 403);
    const numberCheck = await assertUniqueNumber(access, organizationId, manpowerWoNumber);
    if ("error" in numberCheck) return jsonError(numberCheck.error || "Manpower Work Order number already exists.", 409);

    const insertPayload = {
      organization_id: organizationId,
      company_id: companyId,
      site_id: siteId,
      contractor_profile_id: contractorProfileId,
      manpower_wo_number: manpowerWoNumber,
      title,
      scope: text(payload.scope),
      commercial_work_order_id: workOrderId,
      engagement_type: engagementType,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      shift_start_time: timeText(payload.shift_start_time),
      shift_end_time: timeText(payload.shift_end_time),
      standard_break_minutes: numberOrNull(payload.standard_break_minutes),
      overtime_basis: overtimeBasis,
      contractor_profit_type: contractorProfitType,
      contractor_profit_value: contractorProfitValue,
      status,
      notes: text(payload.notes),
      ...actorFields(access.auth, "created"),
    };
    const { data, error } = await access.admin.from("manpower_work_orders").insert(insertPayload).select("id").single();
    if (error) throw error;
    await audit(access, request, {
      moduleCode: MODULE,
      action: "create",
      entityType: "manpower_work_order",
      recordId: data.id,
      organizationId,
      companyId,
      siteId,
      description: `Created Manpower Work Order ${manpowerWoNumber}.`,
      newValues: insertPayload,
    });
    return NextResponse.json({ manpower_work_order_id: data.id });
  } catch (error: any) {
    return jsonError(error.message || "Failed to save Manpower Work Order.", 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json().catch(() => ({}));
    const id = text(payload.id);
    const action = text(payload.action);
    const permissionAction = actionPermission(action);
    if (!permissionAction) return jsonError("Invalid Manpower Work Order action.");
    const access = await requireLabourPermission(request, MODULE, permissionAction);
    if ("response" in access) return access.response;
    if (!id) return jsonError("Manpower Work Order is required.");
    const { data: existing, error: loadError } = await access.admin.from("manpower_work_orders").select("*").eq("id", id).maybeSingle();
    if (loadError) throw loadError;
    if (!existing) return jsonError("Manpower Work Order not found.", 404);
    if (!scopedMwo(access, existing)) return jsonError("Manpower Work Order not found.", 404);

    const patch: Record<string, any> = { ...actorFields(access.auth, "updated"), updated_at: new Date().toISOString() };
    if (action === "submit") {
      const statusError = requireStatus(existing.status, ["draft"], "Only Draft Manpower Work Orders can be submitted.");
      if (statusError) return jsonError(statusError, 403);
      patch.status = "submitted";
      patch.submitted_by = access.auth.user.id;
      patch.submitted_by_name = actorName(access);
      patch.submitted_by_email = access.auth.user.email || null;
      patch.submitted_at = new Date().toISOString();
    } else if (action === "approve") {
      const statusError = requireStatus(existing.status, ["submitted"], "Only submitted Manpower Work Orders can be approved.");
      if (statusError) return jsonError(statusError, 403);
      patch.status = "approved";
      patch.approved_by = access.auth.user.id;
      patch.approved_by_name = actorName(access);
      patch.approved_by_email = access.auth.user.email || null;
      patch.approved_at = new Date().toISOString();
      patch.approval_reason = text(payload.reason);
    } else if (action === "send_back") {
      const statusError = requireStatus(existing.status, ["submitted"], "Only submitted Manpower Work Orders can be sent back.");
      if (statusError) return jsonError(statusError, 403);
      patch.status = "draft";
      patch.rejected_by = access.auth.user.id;
      patch.rejected_by_name = actorName(access);
      patch.rejected_by_email = access.auth.user.email || null;
      patch.rejected_at = new Date().toISOString();
      patch.rejection_reason = text(payload.reason);
    } else if (action === "reject") {
      const statusError = requireStatus(existing.status, ["submitted"], "Only submitted Manpower Work Orders can be rejected.");
      if (statusError) return jsonError(statusError, 403);
      patch.status = "cancelled";
      patch.rejected_by = access.auth.user.id;
      patch.rejected_by_name = actorName(access);
      patch.rejected_by_email = access.auth.user.email || null;
      patch.rejected_at = new Date().toISOString();
      patch.rejection_reason = text(payload.reason);
    } else if (action === "suspend") {
      const statusError = requireStatus(existing.status, ["approved"], "Only approved Manpower Work Orders can be suspended.");
      if (statusError) return jsonError(statusError, 403);
      patch.status = "suspended";
      patch.rejected_by = access.auth.user.id;
      patch.rejected_by_name = actorName(access);
      patch.rejected_by_email = access.auth.user.email || null;
      patch.rejected_at = new Date().toISOString();
      patch.rejection_reason = text(payload.reason);
    } else if (action === "resume") {
      const statusError = requireStatus(existing.status, ["suspended"], "Only suspended Manpower Work Orders can be resumed.");
      if (statusError) return jsonError(statusError, 403);
      patch.status = "approved";
      patch.approval_reason = text(payload.reason);
    } else if (action === "complete") {
      const statusError = requireStatus(existing.status, ["approved"], "Only approved Manpower Work Orders can be completed.");
      if (statusError) return jsonError(statusError, 403);
      patch.status = "completed";
    } else if (action === "cancel") {
      const statusError = requireStatus(existing.status, ["draft"], "Only Draft Manpower Work Orders can be cancelled.");
      if (statusError) return jsonError(statusError, 403);
      patch.status = "cancelled";
      patch.rejection_reason = text(payload.reason);
    } else {
      return jsonError("Invalid Manpower Work Order action.");
    }

    const { error } = await access.admin.from("manpower_work_orders").update(patch).eq("id", id);
    if (error) throw error;
    await audit(access, request, {
      moduleCode: MODULE,
      entityType: "manpower_work_order",
      recordId: id,
      organizationId: existing.organization_id,
      companyId: existing.company_id,
      siteId: existing.site_id,
      action: action === "approve" ? "approve" : ["reject", "send_back"].includes(action) ? "reject" : "update",
      description: `Manpower Work Order ${action.replace(/_/g, " ")}: ${existing.status} to ${patch.status}.`,
      oldValues: { status: existing.status },
      newValues: { status: patch.status, business_action: action, reason: text(payload.reason) },
    });
    return NextResponse.json({ updated: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to update Manpower Work Order.", 500);
  }
}
