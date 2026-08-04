import { NextResponse } from "next/server";
import {
  actorFields,
  audit,
  jsonError,
  loadScopedWorker,
  requireLabourPermission,
} from "@/app/api/labour/_shared";
import { isValidActionValue, LABOUR_RECOVERY_MODES, normalizeText, csvEscape } from "@/lib/labour/constants";
import { applyCompanySiteScope } from "@/app/api/labour/_shared";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

export async function GET(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_advances", "view");
    if ("response" in access) return access.response;
    const { searchParams } = new URL(request.url);
    const exportCsv = searchParams.get("export") === "csv";
    let query = access.admin
      .from("labour_advances")
      .select("*, labour_workers(labour_code, worker_name, father_or_husband_name), labour_contractor_profiles(contractor_code, vendors(vendor_name)), companies(company_name), sites(site_name)")
      .order("advance_date", { ascending: false });
    const orgScoped = applyOrganizationScope(query, access.organizationScope);
    if (!orgScoped) return NextResponse.json({ advances: [] });
    query = applyCompanySiteScope(orgScoped, access.assignments);
    if (!query) return NextResponse.json({ advances: [] });
    if (searchParams.get("status")) query = query.eq("status", searchParams.get("status"));
    if (searchParams.get("worker_id")) query = query.eq("labour_worker_id", searchParams.get("worker_id"));
    const { data, error } = await query;
    if (error) throw error;
    if (exportCsv) {
      const rows = ["Labour Code,Worker,Contractor,Site,Date,Amount,Recovered,Balance,Status,Purpose"];
      for (const row of data || []) {
        rows.push([
          row.labour_workers?.labour_code,
          row.labour_workers?.worker_name,
          row.labour_contractor_profiles?.vendors?.vendor_name || "No Contractor",
          row.sites?.site_name,
          row.advance_date,
          row.amount,
          row.recovered_amount,
          row.balance_amount,
          row.status,
          row.purpose,
        ].map(csvEscape).join(","));
      }
      return new NextResponse(rows.join("\n"), {
        headers: { "content-type": "text/csv", "content-disposition": "attachment; filename=labour-advances.csv" },
      });
    }
    return NextResponse.json({ advances: data || [] });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load labour advances.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_advances", "add");
    if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    const workerId = text(payload.labour_worker_id);
    const worker = workerId ? await loadScopedWorker(access, workerId) : null;
    if (!worker) return jsonError("Labourer not found.", 404);
    const amount = Number(payload.amount || 0);
    const mode = text(payload.recovery_mode) || "manual";
    if (amount <= 0) return jsonError("Advance amount must be greater than zero.");
    if (!text(payload.advance_date)) return jsonError("Advance date is required.");
    if (!isValidActionValue(LABOUR_RECOVERY_MODES, mode)) return jsonError("Invalid recovery mode.");
    const installment = payload.installment_amount === "" || payload.installment_amount == null ? null : Number(payload.installment_amount);
    if (installment != null && installment < 0) return jsonError("Installment amount cannot be negative.");
    const insertPayload = {
      organization_id: worker.organization_id,
      labour_worker_id: worker.id,
      contractor_profile_id: worker.current_contractor_profile_id,
      company_id: worker.current_company_id,
      site_id: worker.current_site_id,
      advance_date: text(payload.advance_date),
      amount,
      purpose: text(payload.purpose),
      recovery_mode: mode,
      installment_amount: installment,
      status: "active",
      recovered_amount: 0,
      balance_amount: amount,
      payment_reference: text(payload.payment_reference),
      remarks: text(payload.remarks),
      ...actorFields(access.auth, "created"),
    };
    const { data, error } = await access.admin.from("labour_advances").insert(insertPayload).select("id").single();
    if (error) throw error;
    await audit(access, request, {
      moduleCode: "labour_advances",
      action: "create",
      entityType: "labour_advance",
      recordId: data.id,
      parentEntityType: "labour_worker",
      parentRecordId: worker.id,
      organizationId: worker.organization_id,
      companyId: worker.current_company_id,
      siteId: worker.current_site_id,
      description: "Created labour advance.",
      newValues: { amount, recovery_mode: mode, purpose: insertPayload.purpose },
    });
    return NextResponse.json({ advance_id: data.id });
  } catch (error: any) {
    return jsonError(error.message || "Failed to create labour advance.", 500);
  }
}
