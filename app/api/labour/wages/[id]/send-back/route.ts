import { NextResponse } from "next/server";
import { actorFields, applyCompanySiteScope, audit, jsonError, requireLabourPermission } from "@/app/api/labour/_shared";
import { normalizeText } from "@/lib/labour/constants";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";

async function loadPeriod(access: any, id: string) {
  let query = access.admin.from("labour_wage_periods").select("*").eq("id", id);
  const orgScoped = applyOrganizationScope(query, access.organizationScope);
  if (!orgScoped) return null;
  query = applyCompanySiteScope(orgScoped, access.assignments);
  if (!query) return null;
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, "labour_wage_approval", "reject");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const payload = await request.json().catch(() => ({}));
    const reason = normalizeText(payload.reason);
    if (!reason) return jsonError("Send-back reason is required.");
    const period = await loadPeriod(access, id);
    if (!period) return jsonError("Wage period not found.", 404);
    if (period.status !== "submitted") return jsonError("Only submitted wage periods can be sent back.");
    const updatePayload = {
      status: "calculated",
      transition_reason: reason,
      updated_at: new Date().toISOString(),
      ...actorFields(access.auth, "updated"),
    };
    const { error } = await access.admin.from("labour_wage_periods").update(updatePayload).eq("id", id);
    if (error) throw error;
    await audit(access, request, {
      moduleCode: "labour_wage_approval",
      action: "reject",
      entityType: "labour_wage_period",
      recordId: id,
      organizationId: period.organization_id,
      companyId: period.company_id,
      siteId: period.site_id,
      description: "Sent labour wage period back for correction.",
      oldValues: period,
      newValues: updatePayload,
    });
    return NextResponse.json({ sent_back: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to send back wage period.", 500);
  }
}
