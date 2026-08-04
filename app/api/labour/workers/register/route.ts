import { NextResponse } from "next/server";
import {
  actorFields,
  audit,
  jsonError,
  loadScopedWorker,
  normalizeLabourIdentity,
  requireLabourPermission,
  resolveOrganizationId,
  assertSameOrgVendor,
  validateContractorProfile,
  validateLabourCompanySiteIndependent,
  validateLabourWorkOrderForContractor,
  validateTrade,
} from "@/app/api/labour/_shared";
import { isValidActionValue, LABOUR_STATUSES, normalizeIdentifier, normalizeLabourCode, normalizeText } from "@/lib/labour/constants";
import { formatAadhaar, normalizeAadhaar, optionalFormattedAadhaar, validateAadhaar } from "@/lib/utils/aadhaar";

const MODULE = "labour_workers";
const TECHNICAL_WORKER_TYPE = "contractor_labour";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

function normalizeMobile(value: unknown) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits || null;
}

function normalizePersonPart(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function possibleExistingMessage(worker?: any | null) {
  if (!worker) return "A possible existing labourer requires supervisor review.";
  return `Possible existing labourer: ${worker.labour_code || "Existing"} — ${worker.worker_name || "Unnamed labourer"}. Review identity fields.`;
}

function duplicateAadhaarMessage(worker: any, formatted: string) {
  const name = worker?.worker_name ? ` to ${worker.worker_name}` : "";
  const code = worker?.labour_code ? ` (Labour Code: ${worker.labour_code})` : "";
  return `Aadhaar ${formatted} is already registered${name}${code}.`;
}

function aadhaarLookupValues(digits: string, formatted = formatAadhaar(digits)) {
  return Array.from(new Set([
    digits,
    formatted,
    `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8, 12)}`,
  ].filter(Boolean)));
}

async function findAadhaarDuplicate(admin: any, organizationId: string, formatted: string, excludeId?: string | null) {
  const digits = normalizeAadhaar(formatted);
  if (!digits) return null;
  const rpcResult = await admin.rpc("find_labour_worker_by_aadhaar", {
    p_organization_id: organizationId,
    p_aadhaar_digits: digits,
    p_exclude_worker_id: excludeId || null,
  });
  if (!rpcResult.error) return rpcResult.data?.[0] || null;
  let query = admin
    .from("labour_workers")
    .select("id, labour_code, worker_name, aadhaar_number, status")
    .eq("organization_id", organizationId)
    .in("aadhaar_number", aadhaarLookupValues(digits, formatted))
    .limit(1);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

function actorName(access: any) {
  return access.auth.user.user_metadata?.full_name || access.auth.user.user_metadata?.name || access.auth.user.email || "Unknown User";
}

function sameAssignment(current: any, next: {
  companyId: string;
  siteId: string;
  contractorProfileId: string;
  labourTradeId: string;
  workOrderId: string | null;
}) {
  if (!current) return false;
  return (
    current.company_id === next.companyId &&
    current.site_id === next.siteId &&
    current.contractor_profile_id === next.contractorProfileId &&
    current.labour_trade_id === next.labourTradeId &&
    current.work_order_id === next.workOrderId
  );
}

function workerSummary(worker: any, deployment: any | null) {
  return {
    id: worker.id,
    labour_code: worker.labour_code,
    worker_name: worker.worker_name,
    father_or_husband_name: worker.father_or_husband_name,
    date_of_birth: worker.date_of_birth,
    aadhaar_number: worker.aadhaar_number,
    mobile_number: worker.mobile_number,
    status: worker.status,
    current_company_id: deployment?.company_id || worker.current_company_id || null,
    current_site_id: deployment?.site_id || worker.current_site_id || null,
    current_contractor_profile_id: deployment?.contractor_profile_id || worker.current_contractor_profile_id || null,
    current_contractor_vendor_id: deployment?.labour_contractor_profiles?.vendor_id || worker.labour_contractor_profiles?.vendor_id || null,
    current_labour_trade_id: deployment?.labour_trade_id || worker.labour_trade_id || null,
    current_contractor_name: deployment?.labour_contractor_profiles?.vendors?.vendor_name || worker.labour_contractor_profiles?.vendors?.vendor_name || null,
    current_company_name: deployment?.companies?.company_name || worker.companies?.company_name || null,
    current_site_name: deployment?.sites?.site_name || worker.sites?.site_name || null,
    current_category_name: deployment?.labour_trades?.trade_name || worker.labour_trades?.trade_name || worker.trade || null,
    current_effective_from: deployment?.effective_from || null,
    current_wage_rate: deployment?.wage_rate || null,
    registered_on: worker.created_at || null,
  };
}

async function loadCurrentDeployment(admin: any, workerId: string) {
  const { data, error } = await admin
    .from("labour_deployments")
    .select(`
      *,
      companies(company_name, company_code),
      sites(site_name, site_code),
      labour_contractor_profiles(id, vendor_id, contractor_code, vendors(vendor_name)),
      labour_trades(id, trade_name, trade_code)
    `)
    .eq("labour_worker_id", workerId)
    .eq("status", "active")
    .is("effective_to", null)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadRecentDeploymentHistory(admin: any, workerId: string) {
  const { data, error } = await admin
    .from("labour_deployments")
    .select(`
      id, company_id, site_id, contractor_profile_id, labour_trade_id,
      effective_from, effective_to, status, wage_rate,
      companies(company_name, company_code),
      sites(site_name, site_code),
      labour_contractor_profiles(id, vendor_id, contractor_code, vendors(vendor_name)),
      labour_trades(id, trade_name, trade_code)
    `)
    .eq("labour_worker_id", workerId)
    .order("effective_from", { ascending: false })
    .limit(5);
  if (error) throw error;
  return (data || []).map((deployment: any) => ({
    site_name: deployment.sites?.site_name || null,
    company_name: deployment.companies?.company_name || null,
    contractor_name: deployment.labour_contractor_profiles?.vendors?.vendor_name || deployment.labour_contractor_profiles?.contractor_code || null,
    category_name: deployment.labour_trades?.trade_name || null,
    effective_from: deployment.effective_from || null,
    effective_to: deployment.effective_to || null,
    status: deployment.status || null,
    wage_rate: deployment.wage_rate || null,
  }));
}

function normalizeWholeRupeeRate(value: unknown) {
  const textValue = text(value);
  if (!textValue) return { error: "Daily Rate is required." };
  if (!/^\d+$/.test(textValue)) return { error: "Daily Rate must be a non-negative whole rupee amount." };
  const amount = Number(textValue);
  if (!Number.isFinite(amount) || amount < 0) return { error: "Daily Rate must be a non-negative whole rupee amount." };
  return { amount };
}

async function createRegistrationDeployment(access: any, input: {
  workerId: string;
  organizationId: string;
  contractorProfileId: string;
  companyId: string;
  siteId: string;
  workOrderId: string | null;
  labourTradeId: string;
  tradeName?: string | null;
  skillLevel?: string | null;
  commercialModel: "daily_wage" | "contract_basis";
  wageRate: number | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  reason: string;
  actor: { id: string; name: string; email: string | null };
}) {
  const { data: worker, error: workerError } = await access.admin
    .from("labour_workers")
    .select("id")
    .eq("id", input.workerId)
    .eq("organization_id", input.organizationId)
    .neq("status", "deleted")
    .maybeSingle();
  if (workerError) throw workerError;
  if (!worker) throw new Error("Labourer not found.");

  const { data: openDeployment, error: openError } = await access.admin
    .from("labour_deployments")
    .select("*")
    .eq("labour_worker_id", input.workerId)
    .eq("status", "active")
    .is("effective_to", null)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (openError) throw openError;

  const { data: overlapping, error: overlapError } = await access.admin
    .from("labour_deployments")
    .select("id")
    .eq("labour_worker_id", input.workerId)
    .neq("id", openDeployment?.id || "00000000-0000-0000-0000-000000000000")
    .lte("effective_from", input.effectiveTo || "9999-12-31")
    .gte("effective_to", input.effectiveFrom)
    .limit(1);
  if (overlapError) throw overlapError;
  if ((overlapping || []).length) throw new Error("Deployment dates overlap an existing deployment.");

  if (openDeployment?.id) {
    const closeDate = new Date(`${input.effectiveFrom}T00:00:00.000Z`);
    closeDate.setUTCDate(closeDate.getUTCDate() - 1);
    const closeText = closeDate.toISOString().slice(0, 10);
    if (closeText < openDeployment.effective_from) throw new Error("Transfer date must be after the current deployment start date.");
    const { error: closeError } = await access.admin
      .from("labour_deployments")
      .update({
        effective_to: closeText,
        status: "ended",
        updated_at: new Date().toISOString(),
        updated_by: input.actor.id,
        updated_by_name: input.actor.name,
        updated_by_email: input.actor.email,
      })
      .eq("id", openDeployment.id);
    if (closeError) throw closeError;
  }

  const now = new Date().toISOString();
  const { data: deployment, error: deploymentError } = await access.admin
    .from("labour_deployments")
    .insert({
      organization_id: input.organizationId,
      labour_worker_id: input.workerId,
      contractor_profile_id: input.contractorProfileId,
      company_id: input.companyId,
      site_id: input.siteId,
      work_order_id: input.workOrderId,
      manpower_work_order_id: null,
      commercial_model: input.commercialModel,
      trade: input.tradeName || null,
      labour_trade_id: input.labourTradeId,
      skill_level: input.skillLevel || null,
      wage_type: input.commercialModel === "daily_wage" ? "daily" : null,
      wage_rate: input.commercialModel === "daily_wage" ? input.wageRate : null,
      effective_from: input.effectiveFrom,
      effective_to: input.effectiveTo || null,
      status: input.effectiveTo ? "ended" : "active",
      deployment_reason: input.reason,
      transfer_reason: input.reason,
      created_by: input.actor.id,
      created_by_name: input.actor.name,
      created_by_email: input.actor.email,
      updated_by: input.actor.id,
      updated_by_name: input.actor.name,
      updated_by_email: input.actor.email,
      updated_at: now,
    })
    .select("id")
    .single();
  if (deploymentError) throw deploymentError;

  const { error: workerUpdateError } = await access.admin
    .from("labour_workers")
    .update({
      current_contractor_profile_id: input.contractorProfileId,
      current_company_id: input.companyId,
      current_site_id: input.siteId,
      current_work_order_id: input.workOrderId,
      trade: input.tradeName || null,
      labour_trade_id: input.labourTradeId,
      skill_level: input.skillLevel || null,
      status: "active",
      updated_at: now,
      updated_by: input.actor.id,
      updated_by_name: input.actor.name,
      updated_by_email: input.actor.email,
    })
    .eq("id", input.workerId);
  if (workerUpdateError) throw workerUpdateError;

  return deployment.id;
}

async function loadExistingWorker(access: any, organizationId: string, input: {
  aadhaarNumber?: string | null;
  mobileNumber?: string | null;
  workerName?: string | null;
  fatherOrHusbandName?: string | null;
  dateOfBirth?: string | null;
}) {
  const aadhaarValidation = optionalFormattedAadhaar(input.aadhaarNumber);
  const aadhaarNumber = aadhaarValidation.formatted || normalizeIdentifier(input.aadhaarNumber);
  const mobileNumber = normalizeMobile(input.mobileNumber);
  const workerName = normalizePersonPart(input.workerName);
  const fatherName = normalizePersonPart(input.fatherOrHusbandName);
  const dateOfBirth = text(input.dateOfBirth);
  const workerSelect = "*, labour_contractor_profiles(id, vendor_id, contractor_code, vendors(vendor_name)), companies:current_company_id(company_name), sites:current_site_id(site_name), labour_trades:labour_trade_id(id, trade_name, trade_code)";

  if (aadhaarNumber) {
    const digits = normalizeAadhaar(aadhaarNumber);
    const { data, error } = await access.admin
      .from("labour_workers")
      .select(workerSelect)
      .eq("organization_id", organizationId)
      .in("aadhaar_number", aadhaarLookupValues(digits, aadhaarNumber))
      .limit(2);
    if (error) throw error;
    if ((data || []).length === 1) return { worker: data![0], matchType: "aadhaar" as const, confidence: "definite" as const };
    if ((data || []).length > 1) return { conflict: true, matchType: "aadhaar" as const, message: possibleExistingMessage(data?.[0]) };
    return { worker: null, matchType: null, confidence: "none" as const };
  }

  if (workerName && fatherName && (dateOfBirth || mobileNumber)) {
    const { data, error } = await access.admin
      .from("labour_workers")
      .select(workerSelect)
      .eq("organization_id", organizationId)
      .eq("worker_name", normalizeText(input.workerName))
      .neq("status", "deleted")
      .limit(10);
    if (error) throw error;
    const matches = (data || []).filter((worker: any) => (
      normalizePersonPart(worker.worker_name) === workerName &&
      normalizePersonPart(worker.father_or_husband_name) === fatherName &&
      (
        Boolean(dateOfBirth && worker.date_of_birth === dateOfBirth) ||
        Boolean(mobileNumber && normalizeMobile(worker.mobile_number) === mobileNumber)
      )
    ));
    if (matches.length === 1) {
      return {
        worker: matches[0],
        matchType: dateOfBirth && matches[0].date_of_birth === dateOfBirth ? "name_father_dob" as const : "name_father_mobile" as const,
        confidence: "strong" as const,
      };
    }
    if (matches.length > 1) return { conflict: true, matchType: "strong_identity" as const, message: possibleExistingMessage(matches[0]) };
  }

  if (mobileNumber) {
    const { data, error } = await access.admin
      .from("labour_workers")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("mobile_number", mobileNumber)
      .neq("status", "deleted")
      .limit(2);
    if (error) throw error;
    if ((data || []).length > 0) {
      return { weak: true, matchType: "mobile" as const, message: "A labourer with the same mobile number exists. Review identity fields if needed." };
    }
  }

  return { worker: null, matchType: null, confidence: "none" as const };
}

async function assertUniqueLabourCode(admin: any, organizationId: string, labourCode: string) {
  const canonical = normalizeLabourCode(labourCode);
  if (!canonical) return "Labour code is required.";
  const { data, error } = await admin
    .from("labour_workers")
    .select("id, labour_code")
    .eq("organization_id", organizationId)
    .neq("status", "deleted");
  if (error) throw error;
  const duplicate = (data || []).find((worker: any) => normalizeLabourCode(worker.labour_code) === canonical);
  return duplicate ? "A labourer with this code already exists." : null;
}

async function nextLabourCode(admin: any, organizationId: string) {
  const { data, error } = await admin
    .from("labour_workers")
    .select("labour_code")
    .eq("organization_id", organizationId);
  if (error) throw error;
  const max = (data || []).reduce((current: number, worker: any) => {
    const match = String(worker.labour_code || "").trim().toUpperCase().match(/^LAB(\d+)$/);
    if (!match) return current;
    return Math.max(current, Number(match[1]) || 0);
  }, 0);
  return `LAB${String(max + 1).padStart(6, "0")}`;
}

async function ensureContractorProfile(access: any, request: Request, organizationId: string, vendorId: string) {
  const vendorCheck = await assertSameOrgVendor(access, organizationId, vendorId);
  if ("error" in vendorCheck) return { error: vendorCheck.error || "Selected vendor is not available." };

  const { data: existing, error: existingError } = await access.admin
    .from("labour_contractor_profiles")
    .select("id, contractor_status")
    .eq("vendor_id", vendorId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    if (existing.contractor_status !== "active") return { error: "Selected vendor is not active for labour registration." };
    return { contractorProfileId: existing.id };
  }

  const baseCode = `V${vendorId.replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  let contractorCode = baseCode;
  for (let index = 1; index <= 20; index += 1) {
    const { data: duplicate, error: duplicateError } = await access.admin
      .from("labour_contractor_profiles")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("contractor_code", contractorCode)
      .maybeSingle();
    if (duplicateError) throw duplicateError;
    if (!duplicate) break;
    contractorCode = `${baseCode}${index}`;
  }

  const insertPayload = {
    organization_id: organizationId,
    vendor_id: vendorId,
    contractor_code: contractorCode,
    contractor_status: "active",
    remarks: "Compatibility profile created automatically during Labour Registration.",
    ...actorFields(access.auth, "created"),
  };
  const { data, error } = await access.admin
    .from("labour_contractor_profiles")
    .insert(insertPayload)
    .select("id")
    .single();
  if (error) throw error;

  await audit(access, request, {
    moduleCode: "labour_contractors",
    action: "create",
    entityType: "labour_contractor_profile",
    recordId: data.id,
    organizationId,
    description: "Created compatibility labour contractor profile from Vendor Master during Labour Registration.",
    newValues: { vendor_id: vendorId, contractor_code: contractorCode },
  });
  return { contractorProfileId: data.id };
}

export async function GET(request: Request) {
  try {
    const access = await requireLabourPermission(request, MODULE, "view");
    if ("response" in access) return access.response;
    const { searchParams } = new URL(request.url);
    const organizationId = await resolveOrganizationId(access, searchParams.get("organization_id"));
    if (!organizationId) return jsonError("You cannot search labourers outside your organization.", 403);

    const existing = await loadExistingWorker(access, organizationId, {
      aadhaarNumber: searchParams.get("aadhaar_number"),
      mobileNumber: searchParams.get("mobile_number"),
      workerName: searchParams.get("worker_name"),
      fatherOrHusbandName: searchParams.get("father_or_husband_name"),
      dateOfBirth: searchParams.get("date_of_birth"),
    });

    const nextCode = await nextLabourCode(access.admin, organizationId);

    if (existing.conflict) {
      return NextResponse.json({ match: null, match_type: existing.matchType, conflict: true, message: existing.message, next_labour_code: nextCode });
    }
    if (existing.weak) {
      return NextResponse.json({ match: null, match_type: existing.matchType, weak: true, message: existing.message, next_labour_code: nextCode });
    }
    if (!existing.worker) return NextResponse.json({ match: null, next_labour_code: nextCode });

    const [deployment, history] = await Promise.all([
      loadCurrentDeployment(access.admin, existing.worker.id),
      loadRecentDeploymentHistory(access.admin, existing.worker.id),
    ]);
    return NextResponse.json({
      match: {
        ...workerSummary(existing.worker, deployment),
        last_assignment: history[0] || null,
        recent_assignments: history,
      },
      match_type: existing.matchType,
      confidence: existing.confidence,
      message: "Existing labourer found. Saved details have been loaded.",
      next_labour_code: nextCode,
      multiple: false,
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to check existing labourer.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, MODULE, "add");
    if ("response" in access) return access.response;

    const payload = await request.json().catch(() => ({}));
    const organizationId = await resolveOrganizationId(access, payload.organization_id);
    if (!organizationId) return jsonError("You cannot register labour outside your organization.", 403);

    const companyId = text(payload.company_id);
    const siteId = text(payload.site_id);
    const vendorId = text(payload.vendor_id);
    const workOrderId = text(payload.work_order_id);
    let contractorProfileId = text(payload.contractor_profile_id) || text(payload.current_contractor_profile_id);
    const labourTradeId = text(payload.labour_trade_id);
    const effectiveFrom = text(payload.effective_from) || text(payload.date_of_joining);
    const status = text(payload.status) || "active";
    const aadhaarAvailable = normalizeText(payload.aadhaar_available || payload.aadhaar_status).toLowerCase();
    const aadhaarInput = payload.aadhaar_number;
    let formattedAadhaar: string | null = null;
    if (aadhaarAvailable === "yes" || aadhaarAvailable === "available" || normalizeText(aadhaarInput)) {
      const aadhaarValidation = validateAadhaar(aadhaarInput);
      if (!aadhaarValidation.valid) return jsonError(aadhaarValidation.error);
      formattedAadhaar = aadhaarValidation.formatted;
    }
    if (aadhaarAvailable === "no" || aadhaarAvailable === "not_available") {
      formattedAadhaar = null;
    }

    if (!companyId || !siteId) return jsonError("Company and site are required.");
    if (!contractorProfileId && !vendorId) return jsonError("Labour Contractor is required.");
    if (!labourTradeId) return jsonError("Labour Category is required.");
    if (!effectiveFrom) return jsonError("Effective From / Joining Date is required.");
    if (!isValidActionValue(LABOUR_STATUSES, status)) return jsonError("Invalid labour status.");

    const scopeCheck = await validateLabourCompanySiteIndependent(access, organizationId, companyId, siteId);
    if ("error" in scopeCheck) return jsonError(scopeCheck.error || "Selected company/site is not available.", 403);
    const { data: selectedSite } = await access.admin
      .from("sites")
      .select("site_name")
      .eq("id", siteId)
      .maybeSingle();
    const selectedSiteName = selectedSite?.site_name || "selected site";
    if (!contractorProfileId && vendorId) {
      const ensured = await ensureContractorProfile(access, request, organizationId, vendorId);
      if ("error" in ensured) return jsonError(ensured.error || "Selected Labour Contractor is not available.", 403);
      contractorProfileId = ensured.contractorProfileId;
    }
    if (!contractorProfileId) return jsonError("Labour Contractor is required.");
    const contractorCheck = await validateContractorProfile(access, organizationId, contractorProfileId);
    if ("error" in contractorCheck) return jsonError(contractorCheck.error || "Selected contractor is not available.", 403);
    const workOrderCheck = workOrderId
      ? await validateLabourWorkOrderForContractor(access, {
        organizationId,
        companyId,
        siteId,
        contractorProfileId,
        workOrderId,
      })
      : { workOrder: null, commercialModel: "contract_basis" as const, requiresDailyRate: false };
    if ("error" in workOrderCheck) return jsonError(workOrderCheck.error || "Selected Labour Work Order is not available.", 403);
    const commercialModel = workOrderCheck.commercialModel === "daily_wage" ? "daily_wage" : "contract_basis";
    const requiresDailyRate = commercialModel === "daily_wage";
    const requestedCommercialModel = text(payload.commercial_model);
    if (requestedCommercialModel && requestedCommercialModel !== commercialModel) {
      return jsonError("Selected Work Order does not match the submitted payment model.");
    }
    const wageRateCheck = requiresDailyRate ? normalizeWholeRupeeRate(payload.wage_rate) : { amount: null };
    if ((wageRateCheck as any)?.error) return jsonError((wageRateCheck as any).error);
    const wageRate = requiresDailyRate ? ((wageRateCheck as any)?.amount ?? null) : null;
    const tradeCheck = await validateTrade(access, organizationId, labourTradeId);
    if ("error" in tradeCheck) return jsonError(tradeCheck.error || "Selected Labour Category is not available.", 403);

    const existingWorkerId = text(payload.existing_worker_id);
    const existing = existingWorkerId
      ? {
          worker: await loadScopedWorker(access, existingWorkerId),
          matchType: "selected" as const,
        }
      : await loadExistingWorker(access, organizationId, {
          aadhaarNumber: payload.aadhaar_number,
          mobileNumber: payload.mobile_number,
          workerName: payload.worker_name,
          fatherOrHusbandName: payload.father_or_husband_name,
          dateOfBirth: payload.date_of_birth,
        });

    if ((existing as any).conflict) return jsonError("A possible existing labourer requires supervisor review.", 409);
    if (existingWorkerId && !existing.worker) return jsonError("Selected labourer is not available in your scope.", 404);
    if (!existingWorkerId && existing.worker && formattedAadhaar && normalizeAadhaar(existing.worker.aadhaar_number) === normalizeAadhaar(formattedAadhaar)) {
      return jsonError(duplicateAadhaarMessage(existing.worker, formattedAadhaar), 409);
    }
    if (!existing.worker && formattedAadhaar) {
      const duplicate = await findAadhaarDuplicate(access.admin, organizationId, formattedAadhaar);
      if (duplicate) return jsonError(duplicateAadhaarMessage(duplicate, formattedAadhaar), 409);
    }

    const nextAssignment = { companyId, siteId, contractorProfileId, labourTradeId, workOrderId };
    const actor = {
      id: access.auth.user.id,
      name: actorName(access),
      email: access.auth.user.email || null,
    };

    if (existing.worker) {
      const currentDeployment = await loadCurrentDeployment(access.admin, existing.worker.id);
      if (sameAssignment(currentDeployment, nextAssignment)) {
        if (currentDeployment?.commercial_model === "daily_wage" && requiresDailyRate && wageRate !== null && Number(currentDeployment.wage_rate ?? -1) !== wageRate) {
          return jsonError("Daily Rate for an existing labourer cannot be changed through registration. Use Update Daily Rate.", 409);
        }
        if (existing.worker.status !== "active") {
          await access.admin.from("labour_workers").update({
            status: "active",
            ...actorFields(access.auth, "updated"),
            updated_at: new Date().toISOString(),
          }).eq("id", existing.worker.id);
          await audit(access, request, {
            moduleCode: MODULE,
            action: "update",
            entityType: "labour_worker",
            recordId: existing.worker.id,
            organizationId,
            companyId,
            siteId,
            description: `Reactivated labourer ${existing.worker.labour_code} at the selected site.`,
            oldValues: { status: existing.worker.status },
            newValues: { status: "active" },
          });
        }
        return NextResponse.json({
          action: existing.worker.status === "active" ? "already_registered" : "reactivated",
          labour_worker_id: existing.worker.id,
          message: existing.worker.status === "active"
            ? "This labourer is already registered at the selected site."
            : "Labourer reactivated at the selected site.",
          worker: workerSummary({ ...existing.worker, status: "active" }, currentDeployment),
        });
      }

      const deploymentId = await createRegistrationDeployment(access, {
        workerId: existing.worker.id,
        organizationId,
        contractorProfileId,
        companyId,
        siteId,
        labourTradeId,
        tradeName: tradeCheck.trade?.trade_name || null,
        skillLevel: existing.worker.skill_level || null,
        commercialModel,
        wageRate,
        workOrderId,
        effectiveFrom,
        effectiveTo: null,
        reason: text(payload.transfer_reason) || "Transferred through Labour Registration.",
        actor,
      });
      await access.admin.from("labour_workers").update({
        labour_trade_id: labourTradeId,
        trade: tradeCheck.trade?.trade_name || null,
        status: "active",
        ...actorFields(access.auth, "updated"),
        updated_at: new Date().toISOString(),
      }).eq("id", existing.worker.id);

      await audit(access, request, {
        moduleCode: MODULE,
        action: "update",
        entityType: "labour_worker",
        recordId: existing.worker.id,
        organizationId,
        companyId,
        siteId,
        description: `Transferred labourer ${existing.worker.labour_code} through Labour Registration.`,
        oldValues: currentDeployment ? {
          company_id: currentDeployment.company_id,
          site_id: currentDeployment.site_id,
          contractor_profile_id: currentDeployment.contractor_profile_id,
          labour_trade_id: currentDeployment.labour_trade_id,
          effective_from: currentDeployment.effective_from,
          status: existing.worker.status,
        } : null,
        newValues: {
          company_id: companyId,
          site_id: siteId,
          contractor_profile_id: contractorProfileId,
          labour_trade_id: labourTradeId,
          commercial_model: commercialModel,
          wage_rate: wageRate,
          work_order_id: workOrderId,
          effective_from: effectiveFrom,
          deployment_id: deploymentId,
          status: "active",
        },
      });

      return NextResponse.json({
        action: "transferred",
          labour_worker_id: existing.worker.id,
          deployment_id: deploymentId,
        message: `Labourer transferred successfully to ${selectedSiteName}.`,
      });
    }

    const workerName = text(payload.worker_name);
    if (!workerName) return jsonError("Worker name is required.");

    const identity = {
      ...normalizeLabourIdentity(payload),
      aadhaar_number: formattedAadhaar,
    };
    const baseInsertPayload = {
      organization_id: organizationId,
      worker_name: workerName,
      father_or_husband_name: text(payload.father_or_husband_name),
      gender: text(payload.gender),
      mobile_number: normalizeMobile(payload.mobile_number),
      alternate_mobile_number: normalizeMobile(payload.alternate_mobile_number),
      ...identity,
      bank_account_number: text(payload.bank_account_number),
      bank_ifsc: text(payload.bank_ifsc),
      bank_name: text(payload.bank_name),
      trade: tradeCheck.trade?.trade_name || null,
      labour_trade_id: labourTradeId,
      worker_type: TECHNICAL_WORKER_TYPE,
      date_of_joining: effectiveFrom,
      date_of_birth: text(payload.date_of_birth),
      status,
      current_contractor_profile_id: contractorProfileId,
      current_company_id: null,
      current_site_id: null,
      current_work_order_id: workOrderId,
      remarks: text(payload.remarks),
      ...actorFields(access.auth, "created"),
    };

    let worker: { id: string } | null = null;
    let labourCode = "";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      labourCode = await nextLabourCode(access.admin, organizationId);
      const insertPayload = { ...baseInsertPayload, labour_code: labourCode };
      const { data: insertedWorker, error: workerError } = await access.admin.from("labour_workers").insert(insertPayload).select("id").single();
      if (!workerError) {
        worker = insertedWorker;
        break;
      }
      if (workerError.code === "23505" && formattedAadhaar) {
        const duplicate = await findAadhaarDuplicate(access.admin, organizationId, formattedAadhaar);
        if (duplicate) return jsonError(duplicateAadhaarMessage(duplicate, formattedAadhaar), 409);
        if (/aadhaar/i.test(`${workerError.message || ""} ${workerError.details || ""}`)) {
          return jsonError("This Aadhaar Number is already registered.", 409);
        }
      }
      if (workerError.code !== "23505") throw workerError;
    }
    if (!worker) return jsonError("Could not generate a unique Labour Code. Please try again.", 409);

    try {
      const deploymentId = await createRegistrationDeployment(access, {
        workerId: worker.id,
        organizationId,
        contractorProfileId,
        companyId,
        siteId,
        labourTradeId,
        tradeName: tradeCheck.trade?.trade_name || null,
        skillLevel: null,
        commercialModel,
        wageRate,
        workOrderId,
        effectiveFrom,
        effectiveTo: null,
        reason: "Initial assignment from Labour Registration.",
        actor,
      });
      await access.admin.from("labour_workers").update({ labour_trade_id: labourTradeId }).eq("id", worker.id);

      await audit(access, request, {
        moduleCode: MODULE,
        action: "create",
        entityType: "labour_worker",
        recordId: worker.id,
        organizationId,
        companyId,
        siteId,
        description: `Registered labourer ${labourCode} and assigned to ${selectedSiteName}.`,
        newValues: {
          ...baseInsertPayload,
          labour_code: labourCode,
          company_id: companyId,
          site_id: siteId,
          contractor_profile_id: contractorProfileId,
          labour_trade_id: labourTradeId,
          commercial_model: commercialModel,
          wage_rate: wageRate,
          work_order_id: workOrderId,
          effective_from: effectiveFrom,
          deployment_id: deploymentId,
        },
      });

      return NextResponse.json({
        action: "registered",
        labour_worker_id: worker.id,
        deployment_id: deploymentId,
        message: `Labour registered successfully and assigned to ${selectedSiteName}.`,
      });
    } catch (deploymentError) {
      await access.admin.from("labour_workers").delete().eq("id", worker.id);
      throw deploymentError;
    }
  } catch (error: any) {
    return jsonError(error.message || "Failed to register labour.", 500);
  }
}
