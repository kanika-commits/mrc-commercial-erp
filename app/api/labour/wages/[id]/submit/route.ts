import { NextResponse } from "next/server";
import { actorFields, applyCompanySiteScope, audit, jsonError, requireLabourPermission } from "@/app/api/labour/_shared";
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
    const access = await requireLabourPermission(request, "labour_wages", "submit");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const period = await loadPeriod(access, id);
    if (!period) return jsonError("Wage period not found.", 404);
    if (!["calculated", "reopened"].includes(period.status)) return jsonError("Only calculated wage periods can be submitted.");
    const updatePayload = {
      status: "submitted",
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...actorFields(access.auth, "submitted" as any),
      ...actorFields(access.auth, "updated"),
    };
    const { error } = await access.admin.from("labour_wage_periods").update(updatePayload).eq("id", id);
    if (error) throw error;
    await audit(access, request, {
      moduleCode: "labour_wages",
      action: "approve",
      entityType: "labour_wage_period",
      recordId: id,
      organizationId: period.organization_id,
      companyId: period.company_id,
      siteId: period.site_id,
      description: "Submitted labour wage period.",
      oldValues: period,
      newValues: updatePayload,
    });
    return NextResponse.json({ submitted: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to submit wage period.", 500);
  }
}
