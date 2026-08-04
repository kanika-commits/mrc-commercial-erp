import { NextResponse } from "next/server";
import {
  actorFields,
  audit,
  jsonError,
  loadScopedWorker,
  normalizeLabourIdentity,
  requireLabourPermission,
  validateContractorProfile,
  validateLabourWorkOrderForContractor,
  validateTrade,
} from "@/app/api/labour/_shared";
import { isValidActionValue, LABOUR_STATUSES, normalizeLabourCode, normalizeText, SKILL_LEVELS } from "@/lib/labour/constants";
import { formatAadhaar, normalizeAadhaar, optionalFormattedAadhaar, validateAadhaar } from "@/lib/utils/aadhaar";

const MODULE = "labour_workers";
const TECHNICAL_WORKER_TYPE = "contractor_labour";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : null;
}

function aadhaarLookupValues(digits: string, formatted = formatAadhaar(digits)) {
  return Array.from(new Set([
    digits,
    formatted,
    `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8, 12)}`,
  ].filter(Boolean)));
}

function duplicateAadhaarMessage(worker: any, formatted: string) {
  const name = worker?.worker_name ? ` to ${worker.worker_name}` : "";
  const code = worker?.labour_code ? ` (Labour Code: ${worker.labour_code})` : "";
  return `Aadhaar ${formatted} is already registered${name}${code}.`;
}

function rateApplies(rate: any, date: string) {
  if (!rate || rate.status === "cancelled") return false;
  if (rate.effective_from && rate.effective_from > date) return false;
  if (rate.effective_to && rate.effective_to < date) return false;
  return true;
}

function resolveDailyRateContext(deployment: any, wageRates: any[], date: string) {
  if (deployment?.commercial_model !== "daily_wage") return { value: null, source: null, effective_from: null, effective_label: "Not Set" };
  const workerRate = (wageRates || []).find((rate: any) => {
    const tradeMatches = !deployment.labour_trade_id || !rate.trade_id || rate.trade_id === deployment.labour_trade_id;
    return tradeMatches && rate.wage_type === "daily" && rateApplies(rate, date);
  });
  const workerRateValue = numberOrNull(workerRate?.base_rate);
  if (workerRateValue !== null) return { value: workerRateValue, source: "labour_wage_rates", effective_from: workerRate.effective_from || null, effective_label: null };

  const mwoRates = deployment.manpower_work_orders?.manpower_work_order_rates || [];
  const mwoRate = (mwoRates || []).find((rate: any) => {
    return rate.labour_trade_id === deployment.labour_trade_id && rate.status === "active" && rateApplies(rate, date);
  });
  const mwoRateValue = numberOrNull(mwoRate?.daily_rate);
  if (mwoRateValue !== null) return { value: mwoRateValue, source: "manpower_work_order_rate", effective_from: mwoRate.effective_from || null, effective_label: mwoRate.effective_from ? null : "Work Order Rate" };

  const deploymentRateValue = numberOrNull(deployment.wage_rate);
  if (deploymentRateValue !== null) return { value: deploymentRateValue, source: "deployment_wage_rate", effective_from: deployment.effective_from || null, effective_label: null };
  return { value: null, source: null, effective_from: null, effective_label: "Not Set" };
}

function resolveDailyRate(deployment: any, wageRates: any[], date: string) {
  return resolveDailyRateContext(deployment, wageRates, date).value;
}

async function referenceCount(query: PromiseLike<{ count: number | null; error: any }>) {
  const result = await query;
  if (result.error) throw result.error;
  return Number(result.count || 0);
}

async function assertUniqueIdentity(admin: any, organizationId: string, values: Record<string, string | null>, excludeId: string) {
  for (const [column, value] of Object.entries(values)) {
    if (!value) continue;
    if (column === "aadhaar_number") {
      const digits = normalizeAadhaar(value);
      const rpcResult = await admin.rpc("find_labour_worker_by_aadhaar", {
        p_organization_id: organizationId,
        p_aadhaar_digits: digits,
        p_exclude_worker_id: excludeId,
      });
      if (!rpcResult.error && rpcResult.data?.[0]) return duplicateAadhaarMessage(rpcResult.data[0], value);
      const { data, error } = await admin
        .from("labour_workers")
        .select("id, labour_code, worker_name, aadhaar_number")
        .eq("organization_id", organizationId)
        .in("aadhaar_number", aadhaarLookupValues(digits, value))
        .neq("id", excludeId)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (data) return duplicateAadhaarMessage(data, value);
      continue;
    }
    const { data, error } = await admin
      .from("labour_workers")
      .select("id")
      .eq("organization_id", organizationId)
      .eq(column, value)
      .neq("id", excludeId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      const label = column === "aadhaar_number" ? "Aadhaar" : column === "uan_number" ? "UAN" : "ESI";
      return `${label} number already exists for another labourer.`;
    }
  }
  return null;
}

async function assertUniqueLabourCode(admin: any, organizationId: string, labourCode: string, excludeId: string) {
  const canonical = normalizeLabourCode(labourCode);
  if (!canonical) return "Labour code is required.";
  const { data, error } = await admin
    .from("labour_workers")
    .select("id, labour_code")
    .eq("organization_id", organizationId)
    .neq("id", excludeId)
    .neq("status", "deleted");
  if (error) throw error;
  const duplicate = (data || []).find((worker: any) => normalizeLabourCode(worker.labour_code) === canonical);
  return duplicate ? "A labourer with this code already exists." : null;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, MODULE, "view");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const worker = await loadScopedWorker(access, id);
    if (!worker) return jsonError("Labourer not found.", 404);

    const [{ data: deployments, error: deploymentsError }, { data: documents, error: documentsError }, { data: activity, error: activityError }, { data: contractor, error: contractorError }, { data: wageRates, error: wageRatesError }, { data: currentWorkOrder, error: currentWorkOrderError }] = await Promise.all([
      access.admin
        .from("labour_deployments")
        .select("*, labour_contractor_profiles(id, contractor_code, vendors(vendor_name)), companies(company_name), sites(site_name), work_orders(id, wo_number, wo_type), manpower_work_orders(manpower_wo_number, title, manpower_work_order_rates(id, labour_trade_id, daily_rate, effective_from, effective_to, status)), labour_trades(trade_name, trade_code)")
        .eq("labour_worker_id", id)
        .order("effective_from", { ascending: false }),
      access.admin
        .from("labour_documents")
        .select("id, document_type, document_name, document_number, issue_date, expiry_date, version, is_active, original_file_name, mime_type, size_bytes, uploaded_at, uploaded_by_name")
        .eq("labour_worker_id", id)
        .order("uploaded_at", { ascending: false }),
      access.admin
        .from("erp_audit_logs")
        .select("id, created_at, created_by_name, created_by_email, action, description, old_values, new_values")
        .eq("entity_type", "labour_worker")
        .eq("record_id", id)
        .order("created_at", { ascending: false })
        .limit(50),
      worker.current_contractor_profile_id
        ? access.admin
          .from("labour_contractor_profiles")
          .select("id, contractor_code, organization_id, vendors(vendor_name)")
          .eq("id", worker.current_contractor_profile_id)
          .eq("organization_id", worker.organization_id)
          .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      access.admin
        .from("labour_wage_rates")
        .select("id, trade_id, wage_type, base_rate, effective_from, effective_to, status, reason, created_by_name, created_by_email, created_at, updated_by_name, updated_by_email, updated_at, companies(company_name), sites(site_name), work_orders(id, wo_number, wo_type), labour_trades(trade_name, trade_code)")
        .eq("labour_worker_id", id)
        .neq("status", "cancelled")
        .order("effective_from", { ascending: false }),
      worker.current_work_order_id
        ? access.admin
          .from("work_orders")
          .select("id, wo_number, wo_type")
          .eq("id", worker.current_work_order_id)
          .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (deploymentsError) throw deploymentsError;
    if (documentsError) throw documentsError;
    if (activityError) throw activityError;
    if (contractorError) throw contractorError;
    if (wageRatesError) throw wageRatesError;
    if (currentWorkOrderError) throw currentWorkOrderError;

    const today = new Date().toISOString().slice(0, 10);
    const deploymentsWithRates = (deployments || []).map((deployment: any) => {
      const rateDate = deployment.effective_from && deployment.effective_from > today ? deployment.effective_from : today;
      const dailyRate = resolveDailyRateContext(deployment, wageRates || [], rateDate);
      return {
        ...deployment,
        daily_rate: dailyRate.value,
        daily_rate_source: dailyRate.source,
        daily_rate_effective_from: dailyRate.effective_from,
        daily_rate_effective_label: dailyRate.effective_label,
      };
    });

    return NextResponse.json({
      worker: { ...worker, labour_contractor_profiles: contractor || null, current_work_orders: currentWorkOrder || null },
      deployments: deploymentsWithRates,
      wage_rates: wageRates || [],
      documents: documents || [],
      activity: activity || [],
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load labourer.", 500);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, MODULE, "edit");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const current = await loadScopedWorker(access, id);
    if (!current) return jsonError("Labourer not found.", 404);

    const payload = await request.json().catch(() => ({}));
    const status = text(payload.status) || current.status;
    const requestedWorkerType = text(payload.worker_type);
    const skillLevel = text(payload.skill_level);
    const requestedLabourCode = normalizeLabourCode(payload.labour_code);
    const aadhaarAvailable = normalizeText(payload.aadhaar_available || payload.aadhaar_status).toLowerCase();
    const aadhaarInput = payload.aadhaar_number;
    let formattedAadhaar: string | null = optionalFormattedAadhaar(current.aadhaar_number).formatted;
    if (aadhaarAvailable === "no" || aadhaarAvailable === "not_available") {
      formattedAadhaar = null;
    } else if (payload.aadhaar_number !== undefined) {
      const aadhaarText = normalizeText(aadhaarInput);
      if (!aadhaarText) {
        formattedAadhaar = null;
      } else {
        const aadhaarValidation = validateAadhaar(aadhaarInput);
        if (!aadhaarValidation.valid) return jsonError(aadhaarValidation.error);
        formattedAadhaar = aadhaarValidation.formatted;
      }
    }

    if (!isValidActionValue(LABOUR_STATUSES, status)) return jsonError("Invalid labour status.");
    if (payload.status_only === true) {
      if (status === current.status) return NextResponse.json({ labour_worker_id: id, unchanged: true });
      const updatePayload = {
        status,
        updated_at: new Date().toISOString(),
        ...actorFields(access.auth, "updated"),
      };
      const { error } = await access.admin.from("labour_workers").update(updatePayload).eq("id", id);
      if (error) throw error;
      await audit(access, request, {
        moduleCode: MODULE,
        action: "update",
        entityType: "labour_worker",
        recordId: id,
        organizationId: current.organization_id,
        companyId: current.current_company_id,
        siteId: current.current_site_id,
        description: `Changed labourer ${current.labour_code} status from ${current.status} to ${status}.`,
        oldValues: { status: current.status },
        newValues: { status, reason: text(payload.reason) },
      });
      return NextResponse.json({ labour_worker_id: id, status });
    }
    if (requestedWorkerType && requestedWorkerType !== TECHNICAL_WORKER_TYPE) return jsonError("Worker Type is not a supported Labourer Master option.");
    if (skillLevel && !isValidActionValue(SKILL_LEVELS, skillLevel)) return jsonError("Invalid skill level.");
    if (payload.labour_code !== undefined) {
      if (!requestedLabourCode) return jsonError("Labour code is required.");
      const duplicateCode = await assertUniqueLabourCode(access.admin, current.organization_id, requestedLabourCode, id);
      if (duplicateCode) return jsonError(duplicateCode, 409);
      if (requestedLabourCode !== normalizeLabourCode(current.labour_code)) return jsonError("Labour Code cannot be changed.");
    }

    const contractorProfileId = text(payload.current_contractor_profile_id);
    if (!contractorProfileId) return jsonError("Contractor is required.");
    const contractorCheck = await validateContractorProfile(access, current.organization_id, contractorProfileId);
    if ("error" in contractorCheck) return jsonError(contractorCheck.error || "Selected contractor is not available.", 403);
    const workOrderId = text(payload.current_work_order_id);
    if (workOrderId && workOrderId !== current.current_work_order_id) {
      if (!current.current_company_id || !current.current_site_id) return jsonError("Company and site are required before selecting a Labour Work Order.");
      const workOrderCheck = await validateLabourWorkOrderForContractor(access, {
        organizationId: current.organization_id,
        companyId: current.current_company_id,
        siteId: current.current_site_id,
        contractorProfileId,
        workOrderId,
      });
      if ("error" in workOrderCheck) return jsonError(workOrderCheck.error || "Selected Labour Work Order is not available.", 403);
    }
    const labourTradeId = text(payload.labour_trade_id) || text(payload.default_labour_category_id);
    if (!labourTradeId) return jsonError("Labour Category is required.");
    const tradeCheck = await validateTrade(access, current.organization_id, labourTradeId);
    if ("error" in tradeCheck) return jsonError(tradeCheck.error || "Selected Labour Category is not available.", 403);

    const identity = {
      ...normalizeLabourIdentity(payload),
      aadhaar_number: formattedAadhaar,
    };
    const duplicateIdentity = await assertUniqueIdentity(access.admin, current.organization_id, identity, id);
    if (duplicateIdentity) return jsonError(duplicateIdentity, 409);
    const updatePayload = {
      worker_name: text(payload.worker_name) || current.worker_name,
      father_or_husband_name: text(payload.father_or_husband_name),
      gender: text(payload.gender),
      date_of_birth: text(payload.date_of_birth),
      mobile_number: text(payload.mobile_number),
      alternate_mobile_number: text(payload.alternate_mobile_number),
      ...identity,
      bank_account_number: text(payload.bank_account_number),
      bank_ifsc: text(payload.bank_ifsc),
      bank_name: text(payload.bank_name),
      trade: tradeCheck.trade?.trade_name || null,
      labour_trade_id: tradeCheck.trade?.id || null,
      skill_level: skillLevel,
      worker_type: TECHNICAL_WORKER_TYPE,
      date_of_joining: text(payload.date_of_joining),
      date_of_exit: text(payload.date_of_exit),
      status,
      current_contractor_profile_id: contractorCheck.contractor?.id || null,
      current_work_order_id: workOrderId,
      remarks: text(payload.remarks),
      updated_at: new Date().toISOString(),
      ...actorFields(access.auth, "updated"),
    };

    const { error } = await access.admin.from("labour_workers").update(updatePayload).eq("id", id);
    if (error) {
      if (error.code === "23505" && /aadhaar/i.test(error.message || "")) return jsonError("This Aadhaar Number is already registered.", 409);
      throw error;
    }
    const { error: deploymentError } = await access.admin
      .from("labour_deployments")
      .update({
        contractor_profile_id: contractorCheck.contractor?.id || null,
        work_order_id: workOrderId,
        labour_trade_id: tradeCheck.trade?.id || null,
        trade: tradeCheck.trade?.trade_name || null,
        updated_at: new Date().toISOString(),
        ...actorFields(access.auth, "updated"),
      })
      .eq("labour_worker_id", id)
      .eq("status", "active")
      .is("effective_to", null);
    if (deploymentError) throw deploymentError;

    await audit(access, request, {
      moduleCode: MODULE,
      action: "update",
      entityType: "labour_worker",
      recordId: id,
      organizationId: current.organization_id,
      companyId: current.current_company_id,
      siteId: current.current_site_id,
      description: `Updated labourer ${current.labour_code}.`,
      oldValues: current,
      newValues: updatePayload,
    });

    return NextResponse.json({ labour_worker_id: id });
  } catch (error: any) {
    return jsonError(error.message || "Failed to update labourer.", 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, MODULE, "delete");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const worker = await loadScopedWorker(access, id);
    if (!worker) return jsonError("Labourer not found.", 404);

    const operationalReferenceCounts = await Promise.all([
      referenceCount(access.admin.from("labour_attendance").select("id", { count: "exact", head: true }).eq("labour_worker_id", id)),
      referenceCount(access.admin.from("labour_site_ins").select("id", { count: "exact", head: true }).eq("labour_worker_id", id)),
      referenceCount(access.admin.from("labour_site_in_engineer_assignments").select("id", { count: "exact", head: true }).eq("labour_worker_id", id)),
      referenceCount(access.admin.from("labour_work_group_members").select("id", { count: "exact", head: true }).eq("labour_worker_id", id)),
      referenceCount(access.admin.from("labour_wage_rates").select("id", { count: "exact", head: true }).eq("labour_worker_id", id)),
      referenceCount(access.admin.from("labour_wage_lines").select("id", { count: "exact", head: true }).eq("labour_worker_id", id)),
      referenceCount(access.admin.from("labour_advances").select("id", { count: "exact", head: true }).eq("labour_worker_id", id).neq("status", "deleted")),
      referenceCount(access.admin.from("labour_overtime_requests").select("id", { count: "exact", head: true }).eq("labour_worker_id", id)),
    ]);
    if (operationalReferenceCounts.some((count) => count > 0)) {
      return jsonError("This labourer is already in use and cannot be deleted. Mark them Inactive instead.", 409);
    }

    const { error } = await access.admin
      .from("labour_workers")
      .update({ status: "deleted", updated_at: new Date().toISOString(), ...actorFields(access.auth, "updated") })
      .eq("id", id);
    if (error) throw error;

    await audit(access, request, {
      moduleCode: MODULE,
      action: "delete",
      entityType: "labour_worker",
      recordId: id,
      organizationId: worker.organization_id,
      companyId: worker.current_company_id,
      siteId: worker.current_site_id,
      description: `Deleted labourer ${worker.labour_code}.`,
      oldValues: worker,
    });

    return NextResponse.json({ deleted: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to delete labourer.", 500);
  }
}
