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
    const access = await requireLabourPermission(request, "labour_wage_approval", "approve");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const period = await loadPeriod(access, id);
    if (!period) return jsonError("Wage period not found.", 404);
    if (period.status !== "submitted") return jsonError("Submit the wage period before finalizing.");
    const { data: lines, error: linesError } = await access.admin.from("labour_wage_lines").select("*").eq("wage_period_id", id);
    if (linesError) throw linesError;
    for (const line of lines || []) {
      const recoveryAmount = Number(line.advance_recovery || 0);
      if (recoveryAmount <= 0) continue;
      const { data: advances, error: advancesError } = await access.admin
        .from("labour_advances")
        .select("*")
        .eq("labour_worker_id", line.labour_worker_id)
        .eq("status", "active")
        .gt("balance_amount", 0)
        .order("advance_date");
      if (advancesError) throw advancesError;
      let remaining = recoveryAmount;
      for (const advance of advances || []) {
        if (remaining <= 0) break;
        const amount = Math.min(remaining, Number(advance.balance_amount || 0));
        const nextRecovered = Number(advance.recovered_amount || 0) + amount;
        const nextBalance = Math.max(0, Number(advance.amount || 0) - nextRecovered);
        const { error: recoveryError } = await access.admin.from("labour_advance_recoveries").insert({
          advance_id: advance.id,
          wage_period_id: id,
          wage_line_id: line.id,
          recovery_date: new Date().toISOString().slice(0, 10),
          amount,
          remarks: "Recovered during wage finalization.",
          ...actorFields(access.auth, "created"),
        });
        if (recoveryError) throw recoveryError;
        const { error: advanceError } = await access.admin.from("labour_advances").update({
          recovered_amount: nextRecovered,
          balance_amount: nextBalance,
          status: nextBalance <= 0 ? "recovered" : "active",
          updated_at: new Date().toISOString(),
          ...actorFields(access.auth, "updated"),
        }).eq("id", advance.id);
        if (advanceError) throw advanceError;
        remaining -= amount;
      }
    }
    const updatePayload = {
      status: "finalized",
      finalized_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...actorFields(access.auth, "finalized" as any),
      ...actorFields(access.auth, "updated"),
    };
    const { error } = await access.admin.from("labour_wage_periods").update(updatePayload).eq("id", id);
    if (error) throw error;
    await audit(access, request, {
      moduleCode: "labour_wage_approval",
      action: "approve",
      entityType: "labour_wage_period",
      recordId: id,
      organizationId: period.organization_id,
      companyId: period.company_id,
      siteId: period.site_id,
      description: "Finalized labour wage period and applied recoveries.",
      oldValues: period,
      newValues: updatePayload,
    });
    return NextResponse.json({ finalized: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to finalize wage period.", 500);
  }
}
