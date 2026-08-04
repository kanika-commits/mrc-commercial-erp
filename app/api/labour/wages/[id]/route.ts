import { NextResponse } from "next/server";
import { actorFields, audit, isGlobalOrSuperAdmin, jsonError, requireLabourPermission } from "@/app/api/labour/_shared";
import { LABOUR_PAYMENT_STATUSES, normalizeText } from "@/lib/labour/constants";
import { applyCompanySiteScope } from "@/app/api/labour/_shared";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

async function loadWagePeriod(access: any, id: string) {
  let query = access.admin
    .from("labour_wage_periods")
    .select("*, companies(company_name), sites(site_name), labour_contractor_profiles(contractor_code, vendors(vendor_name))")
    .eq("id", id);
  const orgScoped = applyOrganizationScope(query, access.organizationScope);
  if (!orgScoped) return null;
  query = applyCompanySiteScope(orgScoped, access.assignments);
  if (!query) return null;
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, "labour_wages", "view");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const period = await loadWagePeriod(access, id);
    if (!period) return jsonError("Wage period not found.", 404);
    const { data: lines, error } = await access.admin
      .from("labour_wage_lines")
      .select("*, labour_workers(labour_code, worker_name, father_or_husband_name), labour_wage_rates(wage_type, base_rate)")
      .eq("wage_period_id", id)
      .order("created_at");
    if (error) throw error;
    return NextResponse.json({ wage_period: period, lines: lines || [] });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load wage period.", 500);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, "labour_wages", "edit");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const period = await loadWagePeriod(access, id);
    if (!period) return jsonError("Wage period not found.", 404);
    if (period.status === "finalized") return jsonError("Finalized wage period cannot be edited.", 403);
    const payload = await request.json().catch(() => ({}));
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    for (const line of lines) {
      const lineId = text(line.id);
      if (!lineId) continue;
      const otherDeductions = Math.max(0, Number(line.other_deductions || 0));
      const paymentStatus = text(line.payment_status) || "unpaid";
      if (!LABOUR_PAYMENT_STATUSES.includes(paymentStatus as any)) return jsonError("Invalid payment status.");
      const { data: existing, error: existingError } = await access.admin.from("labour_wage_lines").select("*").eq("id", lineId).eq("wage_period_id", id).maybeSingle();
      if (existingError) throw existingError;
      if (!existing) return jsonError("Wage line not found.", 404);
      const netWages = Math.max(0, Number(existing.gross_wages || 0) - Number(existing.advance_recovery || 0) - otherDeductions);
      const updatePayload = {
        other_deductions: otherDeductions,
        net_wages: netWages,
        payment_status: paymentStatus,
        paid_amount: Math.max(0, Number(line.paid_amount || 0)),
        updated_at: new Date().toISOString(),
      };
      const { error } = await access.admin.from("labour_wage_lines").update(updatePayload).eq("id", lineId);
      if (error) throw error;
      await audit(access, request, {
        moduleCode: "labour_wages",
        action: "update",
        entityType: "labour_wage_line",
        recordId: lineId,
        parentEntityType: "labour_wage_period",
        parentRecordId: id,
        organizationId: period.organization_id,
        companyId: period.company_id,
        siteId: period.site_id,
        description: "Updated labour wage line adjustment/payment status.",
        oldValues: existing,
        newValues: updatePayload,
      });
    }
    return NextResponse.json({ updated: lines.length });
  } catch (error: any) {
    return jsonError(error.message || "Failed to update wage lines.", 500);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, "labour_wage_approval", "reject");
    if ("response" in access) return access.response;
    if (!isGlobalOrSuperAdmin(access)) return jsonError("Only Platform Owner or Super Admin can reopen wage periods.", 403);
    const { id } = await context.params;
    const period = await loadWagePeriod(access, id);
    if (!period) return jsonError("Wage period not found.", 404);
    const payload = await request.json().catch(() => ({}));
    const reason = text(payload.reason);
    if (!reason) return jsonError("Reopen reason is required.");
    const { data: recoveries, error: recoveryError } = await access.admin.from("labour_advance_recoveries").select("*").eq("wage_period_id", id);
    if (recoveryError) throw recoveryError;
    for (const recovery of recoveries || []) {
      const { data: advance, error: advanceError } = await access.admin.from("labour_advances").select("*").eq("id", recovery.advance_id).maybeSingle();
      if (advanceError) throw advanceError;
      if (advance) {
        const recovered = Math.max(0, Number(advance.recovered_amount || 0) - Number(recovery.amount || 0));
        const { error } = await access.admin.from("labour_advances").update({
          recovered_amount: recovered,
          balance_amount: Math.max(0, Number(advance.amount || 0) - recovered),
          status: "active",
          updated_at: new Date().toISOString(),
          ...actorFields(access.auth, "updated"),
        }).eq("id", advance.id);
        if (error) throw error;
      }
    }
    if ((recoveries || []).length) {
      const { error } = await access.admin.from("labour_advance_recoveries").delete().eq("wage_period_id", id);
      if (error) throw error;
    }
    const updatePayload = {
      status: "reopened",
      reopened_at: new Date().toISOString(),
      transition_reason: reason,
      updated_at: new Date().toISOString(),
      ...actorFields(access.auth, "reopened" as any),
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
      description: "Reopened labour wage period and reversed recoveries.",
      oldValues: period,
      newValues: { ...updatePayload, reversed_recoveries: (recoveries || []).length },
    });
    return NextResponse.json({ reopened: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to reopen wage period.", 500);
  }
}
