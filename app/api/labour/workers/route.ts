import { NextResponse } from "next/server";
import {
  actorFields,
  applyLabourWorkerScope,
  audit,
  jsonError,
  normalizeLabourIdentity,
  requireLabourPermission,
  resolveOrganizationId,
  validateContractorProfile,
  validateTrade,
} from "@/app/api/labour/_shared";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";
import {
  isValidActionValue,
  LABOUR_STATUSES,
  normalizeLabourCode,
  normalizeText,
  SKILL_LEVELS,
} from "@/lib/labour/constants";
import { createPrivateStorageAdapter } from "@/lib/storage/privateStorage";

const MODULE = "labour_workers";
const TECHNICAL_WORKER_TYPE = "contractor_labour";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

function uniqueIds(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

async function assertUniqueIdentity(admin: any, organizationId: string, values: Record<string, string | null>, excludeId?: string) {
  for (const [column, value] of Object.entries(values)) {
    if (!value) continue;
    let query = admin
      .from("labour_workers")
      .select("id")
      .eq("organization_id", organizationId)
      .eq(column, value)
      .neq("status", "deleted")
      .limit(1);
    if (excludeId) query = query.neq("id", excludeId);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (data) {
      const label = column === "aadhaar_number" ? "Aadhaar" : column === "uan_number" ? "UAN" : "ESI";
      return `${label} number already exists for another labourer.`;
    }
  }
  return null;
}

async function assertUniqueLabourCode(admin: any, organizationId: string, labourCode: string, excludeId?: string) {
  const canonical = normalizeLabourCode(labourCode);
  if (!canonical) return "Labour code is required.";
  let query = admin
    .from("labour_workers")
    .select("id, labour_code")
    .eq("organization_id", organizationId)
    .neq("status", "deleted");
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query;
  if (error) throw error;
  const duplicate = (data || []).find((worker: any) => normalizeLabourCode(worker.labour_code) === canonical);
  return duplicate ? "A labourer with this code already exists." : null;
}

export async function GET(request: Request) {
  try {
    const access = await requireLabourPermission(request, MODULE, "view");
    if ("response" in access) return access.response;

    const { searchParams } = new URL(request.url);
    const page = Math.max(Number(searchParams.get("page") || "1"), 1);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") || "25"), 1), 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const search = searchParams.get("search")?.trim();
    const status = searchParams.get("status")?.trim();
    const companyId = searchParams.get("company_id")?.trim();
    const siteId = searchParams.get("site_id")?.trim();
    const contractorId = searchParams.get("contractor_profile_id")?.trim();
    const labourTradeId = searchParams.get("labour_trade_id")?.trim();

    let query = access.admin
      .from("labour_workers")
      .select(`
        id, organization_id, labour_code, worker_name, father_or_husband_name,
        mobile_number, aadhaar_number, uan_number, esi_number, trade, skill_level,
        labour_trade_id, worker_type, date_of_joining, date_of_exit, status, current_contractor_profile_id,
        current_company_id, current_site_id, current_work_order_id, created_at
      `, { count: "exact" })
      .neq("status", "deleted")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true });

    const orgScoped = applyOrganizationScope(query, access.organizationScope);
    if (!orgScoped) return NextResponse.json({ workers: [], total: 0, page, limit });
    query = orgScoped;

    query = applyLabourWorkerScope(query, access.assignments);
    if (!query) {
      return NextResponse.json({ workers: [], total: 0, page, limit });
    }

    if (companyId) query = query.eq("current_company_id", companyId);
    if (siteId) query = query.eq("current_site_id", siteId);
    if (contractorId) query = query.eq("current_contractor_profile_id", contractorId);
    if (labourTradeId) query = query.eq("labour_trade_id", labourTradeId);
    if (status) query = query.eq("status", status);
    if (search) {
      query = query.or(`labour_code.ilike.%${search}%,worker_name.ilike.%${search}%,father_or_husband_name.ilike.%${search}%,mobile_number.ilike.%${search}%,aadhaar_number.ilike.%${search}%`);
    }

    const { data, error, count } = await query.range(from, to);
    if (error) throw error;
    const workers = data || [];
    const workerIds = workers.map((worker: any) => worker.id);
    const contractorIds = uniqueIds(workers.map((worker: any) => worker.current_contractor_profile_id));
    const tradeIds = uniqueIds(workers.map((worker: any) => worker.labour_trade_id));
    const companyIds = uniqueIds(workers.map((worker: any) => worker.current_company_id));
    const siteIds = uniqueIds(workers.map((worker: any) => worker.current_site_id));
    const workOrderIds = uniqueIds(workers.map((worker: any) => worker.current_work_order_id));

    let contractorsById = new Map<string, any>();
    if (contractorIds.length) {
      const { data: contractors } = await access.admin
        .from("labour_contractor_profiles")
        .select("id, contractor_code, vendors(vendor_name)")
        .in("id", contractorIds);
      contractorsById = new Map((contractors || []).map((contractor: any) => [contractor.id, contractor]));
    }

    let tradesById = new Map<string, any>();
    if (tradeIds.length) {
      const { data: trades } = await access.admin
        .from("labour_trades")
        .select("id, trade_name, trade_code")
        .in("id", tradeIds);
      tradesById = new Map((trades || []).map((trade: any) => [trade.id, trade]));
    }

    let companiesById = new Map<string, any>();
    if (companyIds.length) {
      const { data: companies } = await access.admin
        .from("companies")
        .select("id, company_name, company_code")
        .in("id", companyIds);
      companiesById = new Map((companies || []).map((company: any) => [company.id, company]));
    }

    let sitesById = new Map<string, any>();
    if (siteIds.length) {
      const { data: sites } = await access.admin
        .from("sites")
        .select("id, site_name, site_code")
        .in("id", siteIds);
      sitesById = new Map((sites || []).map((site: any) => [site.id, site]));
    }

    let workOrdersById = new Map<string, any>();
    if (workOrderIds.length) {
      const { data: workOrders } = await access.admin
        .from("work_orders")
        .select("id, wo_number, wo_type, status, approval_status, is_deleted")
        .in("id", workOrderIds);
      workOrdersById = new Map((workOrders || []).map((workOrder: any) => [workOrder.id, workOrder]));
    }

    let deploymentsByWorker = new Map<string, any[]>();
    if (workerIds.length) {
      const { data: deployments } = await access.admin
        .from("labour_deployments")
        .select("id, labour_worker_id, contractor_profile_id, company_id, site_id, work_order_id, labour_trade_id, skill_level, wage_rate, commercial_model, wage_type, effective_from, effective_to, status, companies(company_name, company_code), sites(site_name, site_code), work_orders(id, wo_number, wo_type, status, approval_status, is_deleted), manpower_work_orders(manpower_wo_number, title), labour_trades(trade_name, trade_code)")
        .in("labour_worker_id", workerIds)
        .eq("status", "active")
        .is("effective_to", null)
        .order("effective_from", { ascending: false });
      for (const deployment of deployments || []) {
        const current = deploymentsByWorker.get(deployment.labour_worker_id) || [];
        current.push(deployment);
        deploymentsByWorker.set(deployment.labour_worker_id, current);
      }
    }

    let photosByWorker = new Map<string, { url: string; original_file_name?: string | null }>();
    if (workerIds.length) {
      const { data: photos, error: photosError } = await access.admin
        .from("labour_documents")
        .select("labour_worker_id, storage_bucket, storage_key, original_file_name")
        .in("labour_worker_id", workerIds)
        .eq("document_type", "Photo")
        .eq("is_active", true);
      if (photosError) throw photosError;
      if (photos?.length) {
        const storage = createPrivateStorageAdapter(access.admin);
        const signedPhotos = await Promise.all((photos || []).map(async (photo: any) => {
          try {
            const url = await storage.createSignedReadUrl({ bucket: photo.storage_bucket, key: photo.storage_key });
            return { ...photo, url };
          } catch {
            return null;
          }
        }));
        photosByWorker = new Map(
          signedPhotos
            .filter(Boolean)
            .map((photo: any) => [photo.labour_worker_id, { url: photo.url, original_file_name: photo.original_file_name }]),
        );
      }
    }

    return NextResponse.json({
      workers: workers.map((worker: any) => {
        const contractor = contractorsById.get(worker.current_contractor_profile_id) || null;
        const trade = tradesById.get(worker.labour_trade_id) || null;
        const company = companiesById.get(worker.current_company_id) || null;
        const site = sitesById.get(worker.current_site_id) || null;
        const workOrder = workOrdersById.get(worker.current_work_order_id) || null;
        const currentDeployments = deploymentsByWorker.get(worker.id) || [];
        const deployment = currentDeployments[0] || null;
        const linkedWorkOrder = deployment?.work_orders || (deployment?.work_order_id ? workOrdersById.get(deployment.work_order_id) : null);
        const approvedDailyWageWorkOrder = Boolean(
          linkedWorkOrder &&
          linkedWorkOrder.wo_type === "Daily Wage" &&
          linkedWorkOrder.status === "active" &&
          linkedWorkOrder.approval_status === "approved" &&
          linkedWorkOrder.is_deleted === false,
        );
        const dailyRateUpdateEligible = Boolean(
          worker.status === "active" &&
          currentDeployments.length === 1 &&
          deployment &&
          (deployment.commercial_model === "daily_wage" || approvedDailyWageWorkOrder),
        );
        const photo = photosByWorker.get(worker.id) || null;
        const assignmentNumber = deployment
          ? deployment.commercial_model === "daily_wage"
            ? deployment.manpower_work_orders?.manpower_wo_number || null
            : deployment.work_orders?.wo_number || null
          : workOrder?.wo_number || null;
        return {
          ...worker,
          labour_contractor_profiles: contractor,
          labour_trades: trade,
          companies: company,
          sites: site,
          work_orders: workOrder,
          current_deployment: deployment,
          contractor_name: contractor?.vendors?.vendor_name || null,
          labour_category_name: trade?.trade_name || worker.trade || null,
          current_company_name: deployment?.companies?.company_name || company?.company_name || null,
          current_site_name: deployment?.sites?.site_name || site?.site_name || null,
          current_assignment_number: assignmentNumber,
          current_payment_model: deployment?.commercial_model || null,
          current_work_order_type: linkedWorkOrder?.wo_type || null,
          current_deployment_count: currentDeployments.length,
          daily_rate_update_eligible: dailyRateUpdateEligible,
          daily_rate_conversion_required: dailyRateUpdateEligible && deployment?.commercial_model !== "daily_wage",
          photo_url: photo?.url || null,
          photo_file_name: photo?.original_file_name || null,
        };
      }),
      count: count || 0,
      total: count || 0,
      page,
      limit,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.max(Math.ceil((count || 0) / limit), 1),
      },
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load labourers.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, MODULE, "add");
    if ("response" in access) return access.response;

    const payload = await request.json().catch(() => ({}));
    const organizationId = await resolveOrganizationId(access, payload.organization_id);
    if (!organizationId) return jsonError("You cannot create labourers outside your organization.", 403);

    const labourCode = normalizeLabourCode(payload.labour_code);
    const workerName = text(payload.worker_name);
    const status = text(payload.status) || "active";
    const requestedWorkerType = text(payload.worker_type);
    const skillLevel = text(payload.skill_level);
    const contractorProfileId = text(payload.current_contractor_profile_id) || text(payload.contractor_profile_id);
    const labourTradeId = text(payload.labour_trade_id) || text(payload.default_labour_category_id);

    if (!labourCode) return jsonError("Labour code is required.");
    if (!workerName) return jsonError("Worker name is required.");
    if (requestedWorkerType && requestedWorkerType !== TECHNICAL_WORKER_TYPE) return jsonError("Worker Type is not a supported Labourer Master option.");
    if (!contractorProfileId) return jsonError("Contractor is required.");
    if (!labourTradeId) return jsonError("Labour Category is required.");
    if (!isValidActionValue(LABOUR_STATUSES, status)) return jsonError("Invalid labour status.");
    if (skillLevel && !isValidActionValue(SKILL_LEVELS, skillLevel)) return jsonError("Invalid skill level.");

    const contractorCheck = await validateContractorProfile(access, organizationId, contractorProfileId);
    if ("error" in contractorCheck) return jsonError(contractorCheck.error || "Selected contractor is not available.", 403);
    const tradeCheck = await validateTrade(access, organizationId, labourTradeId);
    if ("error" in tradeCheck) return jsonError(tradeCheck.error || "Selected Labour Category is not available.", 403);

    const identity = normalizeLabourIdentity(payload);
    const duplicateIdentity = await assertUniqueIdentity(access.admin, organizationId, identity);
    if (duplicateIdentity) return jsonError(duplicateIdentity, 409);

    const duplicateCode = await assertUniqueLabourCode(access.admin, organizationId, labourCode);
    if (duplicateCode) return jsonError(duplicateCode, duplicateCode.includes("already exists") ? 409 : 400);

    const insertPayload = {
      organization_id: organizationId,
      labour_code: labourCode,
      worker_name: workerName,
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
      current_company_id: null,
      current_site_id: null,
      current_work_order_id: null,
      remarks: text(payload.remarks),
      ...actorFields(access.auth, "created"),
    };

    const { data, error } = await access.admin.from("labour_workers").insert(insertPayload).select("id").single();
    if (error) throw error;

    await audit(access, request, {
      moduleCode: MODULE,
      action: "create",
      entityType: "labour_worker",
      recordId: data.id,
      organizationId,
      description: `Created labourer ${labourCode}.`,
      newValues: insertPayload,
    });

    return NextResponse.json({ labour_worker_id: data.id });
  } catch (error: any) {
    return jsonError(error.message || "Failed to create labourer.", 500);
  }
}
