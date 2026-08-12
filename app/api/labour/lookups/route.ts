import { NextResponse } from "next/server";
import {
  applyCompanySiteScope,
  jsonError,
  loadEligibleDeployments,
  loadResolvedLabourSitePairs,
  requireLabourPermission,
  resolveSiteAttendanceSystem,
  validateLabourCompanySiteIndependent,
  validateLabourOperationalCompanySite,
} from "@/app/api/labour/_shared";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";
import { todayInIst } from "@/lib/labour/operations";

function dateText(value: string | null) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : todayInIst();
}

async function loadCommercialWorkOrdersForDeployment(access: any, input: {
  organizationId: string | null;
  companyId: string | null;
  siteId: string | null;
  contractorProfileId: string | null;
}) {
  if (!input.companyId || !input.siteId || !input.contractorProfileId) return [];

  const [{ data: company, error: companyError }, { data: site, error: siteError }] = await Promise.all([
    access.admin.from("companies").select("id, organization_id, status").eq("id", input.companyId).maybeSingle(),
    access.admin.from("sites").select("id, organization_id, status").eq("id", input.siteId).maybeSingle(),
  ]);
  if (companyError) throw companyError;
  if (siteError) throw siteError;
  const organizationId = input.organizationId || company?.organization_id || null;
  if (!company || !site || !organizationId || company.organization_id !== organizationId || site.organization_id !== organizationId) return [];

  const { data: contractor, error: contractorError } = await access.admin
    .from("labour_contractor_profiles")
    .select("id, organization_id, vendor_id, contractor_status")
    .eq("id", input.contractorProfileId)
    .maybeSingle();
  if (contractorError) throw contractorError;
  if (!contractor || contractor.organization_id !== organizationId || contractor.contractor_status !== "active") return [];
  if (!contractor.vendor_id) throw new Error("This labourer's contractor is not linked to a Vendor record.");

  const { data: links, error: linksError } = await access.admin
    .from("work_order_vendors")
    .select("work_order_id")
    .eq("vendor_id", contractor.vendor_id);
  if (linksError) throw linksError;
  const workOrderIds = Array.from(new Set((links || []).map((link: any) => link.work_order_id).filter(Boolean)));
  if (!workOrderIds.length) return [];

  let query = access.admin
    .from("work_orders")
    .select("id, organization_id, company_id, site_id, wo_number, wo_type, status, approval_status")
    .in("id", workOrderIds)
    .eq("organization_id", organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("status", "active")
    .eq("approval_status", "approved")
    .order("wo_number");
  query = applyCompanySiteScope(query, access.assignments);
  if (!query) return [];
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadWorkOrderContractorsForCompanySite(access: any, input: {
  organizationId: string | null;
  companyId: string | null;
  siteId: string | null;
}) {
  if (!input.companyId || !input.siteId) return { vendors: [], contractors: [] };

  const scopeCheck = await validateLabourCompanySiteIndependent(access, input.organizationId, input.companyId, input.siteId);
  if ("error" in scopeCheck) throw new Error(scopeCheck.error || "Selected company/site is not available.");
  const organizationId = scopeCheck.organizationId;

  let workOrderQuery = access.admin
    .from("work_orders")
    .select("id, organization_id, company_id, site_id, wo_number, status, approval_status")
    .eq("organization_id", organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("status", "active")
    .order("wo_number");
  workOrderQuery = applyCompanySiteScope(workOrderQuery, access.assignments);
  if (!workOrderQuery) return { vendors: [], contractors: [] };

  const { data: workOrders, error: workOrderError } = await workOrderQuery;
  if (workOrderError) throw workOrderError;
  const workOrderIds = Array.from(new Set((workOrders || []).map((workOrder: any) => workOrder.id).filter(Boolean)));
  const { data: links, error: linksError } = workOrderIds.length
    ? await access.admin
      .from("work_order_vendors")
      .select("vendor_id, work_order_id")
      .in("work_order_id", workOrderIds)
    : { data: [], error: null };
  if (linksError) throw linksError;

  let manpowerWorkOrderQuery = access.admin
    .from("manpower_work_orders")
    .select("id, organization_id, company_id, site_id, contractor_profile_id, manpower_wo_number, status")
    .eq("organization_id", organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .in("status", ["draft", "pending", "submitted", "approved"])
    .order("manpower_wo_number");
  manpowerWorkOrderQuery = applyCompanySiteScope(manpowerWorkOrderQuery, access.assignments);
  const { data: manpowerWorkOrders, error: manpowerWorkOrderError } = manpowerWorkOrderQuery
    ? await manpowerWorkOrderQuery
    : { data: [], error: null };
  if (manpowerWorkOrderError) throw manpowerWorkOrderError;

  const directProfileIds = Array.from(new Set((manpowerWorkOrders || []).map((workOrder: any) => workOrder.contractor_profile_id).filter(Boolean)));
  const commercialVendorIds = Array.from(new Set((links || []).map((link: any) => link.vendor_id).filter(Boolean)));

  const [profilesByVendorResult, profilesByIdResult] = await Promise.all([
    commercialVendorIds.length
      ? applyOrganizationScope(
        access.admin
          .from("labour_contractor_profiles")
          .select("id, organization_id, vendor_id, contractor_code, contractor_status, vendors(vendor_name, pan, gstin)")
          .in("vendor_id", commercialVendorIds)
          .eq("contractor_status", "active")
          .order("contractor_code"),
        access.organizationScope,
      )
      : Promise.resolve({ data: [], error: null }),
    directProfileIds.length
      ? applyOrganizationScope(
        access.admin
          .from("labour_contractor_profiles")
          .select("id, organization_id, vendor_id, contractor_code, contractor_status, vendors(vendor_name, pan, gstin)")
          .in("id", directProfileIds)
          .eq("contractor_status", "active")
          .order("contractor_code"),
        access.organizationScope,
      )
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (profilesByVendorResult?.error) throw profilesByVendorResult.error;
  if (profilesByIdResult?.error) throw profilesByIdResult.error;

  const profileMap = new Map<string, any>();
  for (const contractor of [...(profilesByVendorResult?.data || []), ...(profilesByIdResult?.data || [])]) {
    if (contractor?.id) profileMap.set(contractor.id, contractor);
  }
  const profileVendorIds = Array.from(profileMap.values()).map((contractor: any) => contractor.vendor_id).filter(Boolean);
  const vendorIds = Array.from(new Set([...commercialVendorIds, ...profileVendorIds]));
  if (!vendorIds.length) return { vendors: [], contractors: [] };

  const vendorQuery = applyOrganizationScope(
    access.admin
      .from("vendors")
      .select("id, organization_id, vendor_name, pan, gstin, status")
      .in("id", vendorIds)
      .eq("status", "active")
      .order("vendor_name"),
    access.organizationScope,
  );
  const vendorsResult = vendorQuery ? await vendorQuery : { data: [], error: null };
  if (vendorsResult.error) throw vendorsResult.error;
  const vendors = vendorsResult.data || [];

  return {
    vendors,
    contractors: vendors.map((vendor: any) => ({
      id: vendor.id,
      vendor_id: vendor.id,
      contractor_code: null,
      contractor_status: vendor.status,
      vendors: vendor,
    })).sort((a: any, b: any) =>
      String(a?.vendors?.vendor_name || "").localeCompare(String(b?.vendors?.vendor_name || "")),
    ),
  };
}

async function loadLabourWorkOrdersForVendor(access: any, input: {
  organizationId: string | null;
  companyId: string | null;
  siteId: string | null;
  vendorId: string | null;
}) {
  if (!input.companyId || !input.siteId || !input.vendorId) return [];
  const scopeCheck = await validateLabourCompanySiteIndependent(access, input.organizationId, input.companyId, input.siteId);
  if ("error" in scopeCheck) throw new Error(scopeCheck.error || "Selected company/site is not available.");

  const { data: links, error: linksError } = await access.admin
    .from("work_order_vendors")
    .select("work_order_id")
    .eq("vendor_id", input.vendorId);
  if (linksError) throw linksError;
  const workOrderIds = Array.from(new Set((links || []).map((link: any) => link.work_order_id).filter(Boolean)));
  if (!workOrderIds.length) return [];

  let workOrderQuery = access.admin
    .from("work_orders")
    .select("id, organization_id, company_id, site_id, wo_number, wo_type, status, approval_status")
    .in("id", workOrderIds)
    .eq("organization_id", scopeCheck.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("status", "active")
    .order("wo_number");
  workOrderQuery = applyCompanySiteScope(workOrderQuery, access.assignments);
  if (!workOrderQuery) return [];
  const { data: workOrders, error: workOrderError } = await workOrderQuery;
  if (workOrderError) throw workOrderError;

  const siteIds = Array.from(new Set((workOrders || []).map((workOrder: any) => workOrder.site_id).filter(Boolean)));
  const { data: sites, error: sitesError } = siteIds.length
    ? await access.admin.from("sites").select("id, site_name, site_code").in("id", siteIds)
    : { data: [], error: null };
  if (sitesError) throw sitesError;
  const siteMap = new Map((sites || []).map((site: any) => [site.id, site]));
  return (workOrders || []).map((workOrder: any) => ({
    ...workOrder,
    commercial_model: workOrder.wo_type === "Daily Wage" ? "daily_wage" : "contract_basis",
    requires_daily_rate: workOrder.wo_type === "Daily Wage",
    sites: siteMap.get(workOrder.site_id) || null,
  }));
}

async function loadDeploymentContractorsForCompanySiteDate(access: any, input: {
  organizationId: string | null;
  companyId: string | null;
  siteId: string | null;
  effectiveDate: string;
}) {
  if (!input.companyId || !input.siteId) return { contractors: [] };
  const scopeCheck = await validateLabourCompanySiteIndependent(access, input.organizationId, input.companyId, input.siteId);
  if ("error" in scopeCheck) throw new Error(scopeCheck.error || "Selected company/site is not available.");
  const deployments = await loadEligibleDeployments(access, {
    organizationId: scopeCheck.organizationId,
    companyId: input.companyId,
    siteId: input.siteId,
    contractorProfileId: null,
    attendanceDate: input.effectiveDate,
  });
  const contractorMap = new Map<string, any>();
  for (const deployment of deployments) {
    const contractor = Array.isArray(deployment.labour_contractor_profiles) ? deployment.labour_contractor_profiles[0] : deployment.labour_contractor_profiles;
    if (contractor?.id) contractorMap.set(contractor.id, contractor);
  }
  return {
    contractors: Array.from(contractorMap.values()).sort((a: any, b: any) =>
      String(a?.vendors?.vendor_name || a?.contractor_code || "").localeCompare(String(b?.vendors?.vendor_name || b?.contractor_code || "")),
    ),
  };
}

async function loadSiteInContractorsForCompanySiteDate(access: any, input: {
  organizationId: string | null;
  companyId: string | null;
  siteId: string | null;
  attendanceDate: string;
}) {
  if (!input.companyId || !input.siteId) return { contractors: [] };
  const scopeCheck = await validateLabourCompanySiteIndependent(access, input.organizationId, input.companyId, input.siteId);
  if ("error" in scopeCheck) throw new Error(scopeCheck.error || "Selected company/site is not available.");
  let siteInQuery = access.admin
    .from("labour_site_ins")
    .select("contractor_profile_id")
    .eq("organization_id", scopeCheck.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("site_in_date", input.attendanceDate)
    .eq("status", "active");
  siteInQuery = applyCompanySiteScope(siteInQuery, access.assignments);
  if (!siteInQuery) return { contractors: [] };
  const { data: siteIns, error: siteInError } = await siteInQuery;
  if (siteInError) throw siteInError;
  const contractorProfileIds = Array.from(new Set((siteIns || []).map((row: any) => row.contractor_profile_id).filter(Boolean)));
  if (!contractorProfileIds.length) return { contractors: [] };
  const contractorsQuery = applyOrganizationScope(
    access.admin
      .from("labour_contractor_profiles")
      .select("id, organization_id, vendor_id, contractor_code, contractor_status, vendors(vendor_name, pan, gstin)")
      .in("id", contractorProfileIds)
      .eq("contractor_status", "active")
      .order("contractor_code"),
    access.organizationScope,
  );
  const contractorsResult = contractorsQuery ? await contractorsQuery : { data: [], error: null };
  if (contractorsResult.error) throw contractorsResult.error;
  return {
    contractors: (contractorsResult.data || []).sort((a: any, b: any) =>
      String(a?.vendors?.vendor_name || a?.contractor_code || "").localeCompare(String(b?.vendors?.vendor_name || b?.contractor_code || "")),
    ),
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const purpose = searchParams.get("purpose");
    const permissionModule = purpose === "labour_attendance" ? "labour_attendance" : purpose === "labour_site_in" ? "labour_site_in" : "labour_workers";
    const access = await requireLabourPermission(request, permissionModule, "view");
    if ("response" in access) return access.response;
    const attendanceDate = dateText(searchParams.get("attendance_date") || searchParams.get("site_in_date") || searchParams.get("date"));
    const selectedContractorProfileId = searchParams.get("contractor_profile_id")?.trim() || null;
    const selectedCompanyId = searchParams.get("company_id")?.trim() || null;
    const selectedSiteId = searchParams.get("site_id")?.trim() || null;
    const selectedVendorId = searchParams.get("vendor_id")?.trim() || null;

    if (purpose === "labour_workspace") {
      const pairs = await loadResolvedLabourSitePairs(access);
      const selectedPair = selectedCompanyId && selectedSiteId
        ? pairs.company_site_pairs.find((pair) => pair.company_id === selectedCompanyId && pair.site_id === selectedSiteId)
        : null;
      return NextResponse.json({
        ...pairs,
        work_orders: [],
        vendors: [],
        contractors: [],
        trades: [],
        manpower_work_orders: [],
        attendance_system: selectedPair
          ? {
            status: selectedPair.attendance_system === "unconfigured" ? "missing_configuration" : "configured",
            value: selectedPair.attendance_system === "unconfigured" ? null : selectedPair.attendance_system,
            message: selectedPair.attendance_system === "unconfigured" ? "Attendance system is not configured for this site." : null,
          }
          : null,
      });
    }

    let companyQuery = applyOrganizationScope(
      access.admin.from("companies").select("id, organization_id, company_name, company_code, status").eq("status", "active").order("company_name"),
      access.organizationScope,
    );
    const siteQuery = applyOrganizationScope(
      access.admin.from("sites").select("id, organization_id, company_id, site_name, site_code, status").eq("status", "active").order("site_name"),
      access.organizationScope,
    );
    const workOrderQuery = applyOrganizationScope(
      access.admin.from("work_orders").select("id, organization_id, company_id, site_id, wo_number, status, approval_status").eq("status", "active").order("wo_number"),
      access.organizationScope,
    );
    const vendorQuery = applyOrganizationScope(
      access.admin.from("vendors").select("id, organization_id, vendor_name, pan, gstin, status").eq("status", "active").order("vendor_name"),
      access.organizationScope,
    );
    const contractorQuery = applyOrganizationScope(
      access.admin.from("labour_contractor_profiles").select("id, organization_id, vendor_id, contractor_code, contractor_status, vendors(vendor_name, pan, gstin)").order("contractor_code"),
      access.organizationScope,
    );
    const tradeQuery = applyOrganizationScope(
      access.admin.from("labour_trades").select("id, organization_id, trade_name, trade_code, status").eq("status", "active").order("trade_name"),
      access.organizationScope,
    );
    const manpowerWorkOrderQuery = applyOrganizationScope(
      access.admin.from("manpower_work_orders").select("id, organization_id, company_id, site_id, contractor_profile_id, manpower_wo_number, title, status, effective_from, effective_to, manpower_work_order_rates(id, labour_trade_id, daily_rate, effective_from, effective_to, status)").in("status", purpose === "labour_deployment" ? ["approved"] : ["approved", "submitted", "draft"]).order("manpower_wo_number"),
      access.organizationScope,
    );

    if (purpose === "labour_attendance") {
      const configuredPairs = await loadResolvedLabourSitePairs(access);
      const companies = configuredPairs.companies;
      const sites = configuredPairs.sites;
      const tradeMap = new Map<string, any>();
      const workOrderMap = new Map<string, any>();
      const manpowerWorkOrderMap = new Map<string, any>();
      let deployments: any[] = [];
      let siteInContractors: { contractors: any[] } = { contractors: [] };
      let attendanceSystem: any = null;
      let reopenedAttendanceDates: string[] = [];

      if (selectedCompanyId && selectedSiteId) {
        const scopeCheck = await validateLabourOperationalCompanySite(access, null, selectedCompanyId, selectedSiteId);
        if ("error" in scopeCheck) return jsonError(scopeCheck.error || "Selected company/site is not available.", 403);
        const system = await resolveSiteAttendanceSystem(access, { organizationId: scopeCheck.organizationId, companyId: selectedCompanyId, siteId: selectedSiteId });
        attendanceSystem = system.ok
          ? { status: "configured", value: system.attendanceSystem }
          : { status: system.reason, value: null, message: system.message };
        if (system.ok && system.attendanceSystem === "standard") {
          const { data: periods, error: periodsError } = await access.admin
            .from("labour_attendance_periods")
            .select("summary")
            .eq("organization_id", scopeCheck.organizationId)
            .eq("company_id", selectedCompanyId)
            .eq("site_id", selectedSiteId)
            .eq("originating_attendance_system", "standard");
          if (periodsError) throw periodsError;
          reopenedAttendanceDates = Array.from(new Set((periods || []).flatMap((period: any) =>
            Object.entries(period.summary?.date_statuses || {})
              .filter(([, value]: [string, any]) => value?.status === "reopened")
              .map(([date]) => date),
          ))).filter((date): date is string => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
        }
        deployments = await loadEligibleDeployments(access, {
          organizationId: scopeCheck.organizationId,
          companyId: selectedCompanyId,
          siteId: selectedSiteId,
          contractorProfileId: null,
          attendanceDate,
        });
        if (system.ok && system.attendanceSystem === "standard") {
          const contractorMap = new Map<string, any>();
          for (const deployment of deployments) {
            const contractor = Array.isArray(deployment.labour_contractor_profiles) ? deployment.labour_contractor_profiles[0] : deployment.labour_contractor_profiles;
            if (contractor?.id) contractorMap.set(contractor.id, contractor);
          }
          siteInContractors = {
            contractors: Array.from(contractorMap.values()).sort((a: any, b: any) =>
              String(a?.vendors?.vendor_name || a?.contractor_code || "").localeCompare(String(b?.vendors?.vendor_name || b?.contractor_code || "")),
            ),
          };
        } else if (system.ok && system.attendanceSystem === "site_in_engineer") {
          siteInContractors = await loadSiteInContractorsForCompanySiteDate(access, {
            organizationId: scopeCheck.organizationId,
            companyId: selectedCompanyId,
            siteId: selectedSiteId,
            attendanceDate,
          });
        }
      }

      for (const deployment of deployments) {
        const trade = Array.isArray(deployment.labour_trades) ? deployment.labour_trades[0] : deployment.labour_trades;
        const workOrder = Array.isArray(deployment.work_orders) ? deployment.work_orders[0] : deployment.work_orders;
        const manpowerWorkOrder = Array.isArray(deployment.manpower_work_orders) ? deployment.manpower_work_orders[0] : deployment.manpower_work_orders;
        if (trade?.id && trade.status === "active") tradeMap.set(trade.id, trade);
        if (workOrder?.id && workOrder.status === "active") workOrderMap.set(workOrder.id, workOrder);
        if (manpowerWorkOrder?.id && manpowerWorkOrder.status === "approved") manpowerWorkOrderMap.set(manpowerWorkOrder.id, manpowerWorkOrder);
      }

      const byName = (field: string) => (a: any, b: any) => String(a?.[field] || "").localeCompare(String(b?.[field] || ""));
      return NextResponse.json({
        companies: companies.sort(byName("company_name")),
        sites: sites.sort(byName("site_name")),
        company_site_pairs: configuredPairs.company_site_pairs,
        work_orders: Array.from(workOrderMap.values()).sort(byName("wo_number")),
        vendors: [],
        contractors: siteInContractors.contractors,
        reopened_attendance_dates: reopenedAttendanceDates,
        attendance_system: attendanceSystem,
        trades: Array.from(tradeMap.values()).sort(byName("trade_name")),
        manpower_work_orders: Array.from(manpowerWorkOrderMap.values()).sort(byName("manpower_wo_number")),
      });
    }

    if (companyQuery && access.assignments.siteIds?.length) {
      const siteCompanyQuery = applyOrganizationScope(
        access.admin.from("sites").select("company_id").in("id", access.assignments.siteIds),
        access.organizationScope,
      );
      const { data: scopedSites, error: scopedSitesError } = siteCompanyQuery ? await siteCompanyQuery : { data: [], error: null };
      if (scopedSitesError) throw scopedSitesError;
      const companyIds = Array.from(new Set((scopedSites || []).map((site: any) => site.company_id).filter(Boolean)));
      companyQuery = companyIds.length ? companyQuery.in("id", companyIds) : null;
    } else if (companyQuery && access.assignments.companyIds?.length) {
      companyQuery = companyQuery.in("id", access.assignments.companyIds);
    } else if (companyQuery && access.assignments.companyIds && !access.assignments.companyIds.length) {
      companyQuery = null;
    }
    let scopedSiteQuery = siteQuery;
    if (purpose === "manpower_work_order" || purpose === "labour_deployment" || purpose === "labour_registration" || purpose === "labour_site_in") {
      if (scopedSiteQuery && access.assignments.siteIds?.length) {
        scopedSiteQuery = scopedSiteQuery.in("id", access.assignments.siteIds);
      } else if (scopedSiteQuery && access.assignments.siteIds && !access.assignments.siteIds.length && access.assignments.companyIds && !access.assignments.companyIds.length) {
        scopedSiteQuery = null;
      }
    } else {
      scopedSiteQuery = siteQuery && applyCompanySiteScope(siteQuery, access.assignments, "company_id", "id");
    }
    const scopedWorkOrderQuery = workOrderQuery && applyCompanySiteScope(workOrderQuery, access.assignments);

    const scopedManpowerWorkOrderQuery = manpowerWorkOrderQuery && applyCompanySiteScope(manpowerWorkOrderQuery, access.assignments);
    const organizationId = Array.isArray(access.organizationScope) ? access.organizationScope[0] : null;
    const commercialWorkOrdersPromise = purpose === "labour_deployment"
      ? loadCommercialWorkOrdersForDeployment(access, {
        organizationId,
        companyId: selectedCompanyId,
        siteId: selectedSiteId,
        contractorProfileId: selectedContractorProfileId,
      })
      : Promise.resolve(null);
    const workOrderContractorsPromise = purpose === "labour_registration"
      ? loadWorkOrderContractorsForCompanySite(access, {
        organizationId,
        companyId: selectedCompanyId,
        siteId: selectedSiteId,
      })
      : Promise.resolve(null);
    const labourWorkOrdersPromise = purpose === "labour_registration"
      ? loadLabourWorkOrdersForVendor(access, {
        organizationId,
        companyId: selectedCompanyId,
        siteId: selectedSiteId,
        vendorId: selectedVendorId,
      })
      : Promise.resolve(null);
    const attendanceSystemPromise = (purpose === "labour_site_in" || purpose === "labour_registration") && selectedCompanyId && selectedSiteId
      ? (async () => {
        const scopeCheck = await validateLabourOperationalCompanySite(access, organizationId, selectedCompanyId, selectedSiteId);
        if ("error" in scopeCheck) return { status: "scope_error", value: null, message: scopeCheck.error || "Selected company/site is not available." };
        const system = await resolveSiteAttendanceSystem(access, {
          organizationId: scopeCheck.organizationId,
          companyId: selectedCompanyId,
          siteId: selectedSiteId,
        });
        return system.ok
          ? { status: "configured", value: system.attendanceSystem }
          : { status: system.reason, value: null, message: system.message };
      })()
      : Promise.resolve(null);
    const operationalPairsPromise = purpose === "labour_registration" || purpose === "labour_site_in"
      ? loadResolvedLabourSitePairs(access)
      : Promise.resolve(null);
    const siteInContractorsPromise = purpose === "labour_site_in"
      ? loadDeploymentContractorsForCompanySiteDate(access, {
        organizationId,
        companyId: selectedCompanyId,
        siteId: selectedSiteId,
        effectiveDate: attendanceDate,
      })
      : Promise.resolve(null);

    const [companies, sites, workOrders, vendors, contractors, trades, manpowerWorkOrders, commercialWorkOrders, workOrderContractors, labourWorkOrders, siteInContractors, attendanceSystem, operationalPairs] = await Promise.all([
      companyQuery ? companyQuery : Promise.resolve({ data: [], error: null }),
      scopedSiteQuery ? scopedSiteQuery : Promise.resolve({ data: [], error: null }),
      scopedWorkOrderQuery ? scopedWorkOrderQuery : Promise.resolve({ data: [], error: null }),
      vendorQuery ? vendorQuery : Promise.resolve({ data: [], error: null }),
      contractorQuery ? contractorQuery : Promise.resolve({ data: [], error: null }),
      tradeQuery ? tradeQuery : Promise.resolve({ data: [], error: null }),
      scopedManpowerWorkOrderQuery ? scopedManpowerWorkOrderQuery : Promise.resolve({ data: [], error: null }),
      commercialWorkOrdersPromise,
      workOrderContractorsPromise,
      labourWorkOrdersPromise,
      siteInContractorsPromise,
      attendanceSystemPromise,
      operationalPairsPromise,
    ]);

    for (const result of [companies, sites, workOrders, vendors, contractors, trades, manpowerWorkOrders]) {
      if (result.error) throw result.error;
    }

    return NextResponse.json({
      companies: operationalPairs ? operationalPairs.companies : companies.data || [],
      sites: operationalPairs ? operationalPairs.sites : sites.data || [],
      company_site_pairs: operationalPairs ? operationalPairs.company_site_pairs : [],
      work_orders: purpose === "labour_deployment" && commercialWorkOrders !== null ? commercialWorkOrders : workOrders.data || [],
      labour_work_orders: labourWorkOrders || [],
      vendors: workOrderContractors ? workOrderContractors.vendors : vendors.data || [],
      contractors: siteInContractors ? siteInContractors.contractors : workOrderContractors ? workOrderContractors.contractors : contractors.data || [],
      attendance_system: attendanceSystem,
      trades: trades.data || [],
      manpower_work_orders: manpowerWorkOrders.data || [],
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load labour lookups.", 500);
  }
}
