import { NextResponse } from "next/server";
import {
  actorFields,
  applyCompanySiteScope,
  audit,
  assertSameOrgVendor,
  jsonError,
  requireLabourPermission,
  resolveOrganizationId,
} from "@/app/api/labour/_shared";
import { CONTRACTOR_STATUSES, isValidActionValue, normalizeIdentifier, normalizeText } from "@/lib/labour/constants";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";

const MODULE = "labour_contractors";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

function primaryContact(contacts: any[] | undefined) {
  const rows = contacts || [];
  return rows.find((contact) => contact.is_primary) || rows[0] || null;
}

function daysUntil(dateValue: string | null | undefined) {
  if (!dateValue) return null;
  const today = new Date();
  const current = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const target = new Date(`${dateValue}T00:00:00+05:30`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.ceil((target.getTime() - current.getTime()) / 86400000);
}

function complianceWarnings(row: any) {
  const warnings: Array<{ tone: "red" | "orange"; label: string }> = [];
  const licenceDays = daysUntil(row.labour_licence_valid_to);
  if (licenceDays !== null && licenceDays < 0) warnings.push({ tone: "red", label: "Expired" });
  else if (licenceDays !== null && licenceDays <= 30) warnings.push({ tone: "orange", label: `Expires in ${licenceDays} days` });
  return warnings;
}

async function loadVendorContacts(admin: any, vendorIds: string[]) {
  if (!vendorIds.length) return new Map<string, any[]>();
  const { data, error } = await admin
    .from("vendor_contacts")
    .select("id, vendor_id, contact_name, contact_number, email, designation, is_primary")
    .in("vendor_id", vendorIds)
    .order("is_primary", { ascending: false });
  if (error) throw error;
  const byVendor = new Map<string, any[]>();
  (data || []).forEach((contact: any) => {
    byVendor.set(contact.vendor_id, [...(byVendor.get(contact.vendor_id) || []), contact]);
  });
  return byVendor;
}

export async function GET(request: Request) {
  try {
    const access = await requireLabourPermission(request, MODULE, "view");
    if ("response" in access) return access.response;
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim();
    const status = searchParams.get("status")?.trim();

    let query = access.admin
      .from("labour_contractor_profiles")
      .select(`
        *,
        vendors(id, vendor_name, pan, gstin, contractor_type, status),
        labour_workers!labour_workers_current_contractor_profile_id_fkey(id, status, current_company_id, current_site_id),
        labour_deployments(id, status, company_id, site_id, commercial_model)
      `)
      .order("created_at", { ascending: false });

    const scoped = applyOrganizationScope(query, access.organizationScope);
    if (!scoped) return NextResponse.json({ contractors: [] });
    query = scoped;
    if (status) query = query.eq("contractor_status", status);

    const { data, error } = await query;
    if (error) throw error;
    const contactByVendor = await loadVendorContacts(access.admin, (data || []).map((row: any) => row.vendor_id).filter(Boolean));
    const contractors = (data || []).map((row: any) => {
      const contact = primaryContact(contactByVendor.get(row.vendor_id));
      const scopedWorkers = (row.labour_workers || []).filter((worker: any) => {
        if (worker.status !== "active") return false;
        const scoped = applyCompanySiteScope({} as any, access.assignments);
        if (scoped === null) return true;
        if (access.assignments.siteIds?.length) return access.assignments.siteIds.includes(worker.current_site_id);
        if (access.assignments.companyIds?.length) return access.assignments.companyIds.includes(worker.current_company_id);
        return false;
      });
      const scopedDeployments = (row.labour_deployments || []).filter((deployment: any) => {
        if (deployment.status !== "active") return false;
        if (access.assignments.siteIds?.length) return access.assignments.siteIds.includes(deployment.site_id);
        if (access.assignments.companyIds?.length) return access.assignments.companyIds.includes(deployment.company_id);
        if (access.assignments.companyIds && access.assignments.siteIds && !access.assignments.companyIds.length && !access.assignments.siteIds.length) return false;
        return true;
      });
      return {
        ...row,
        primary_contact: contact,
        compliance_warnings: complianceWarnings(row),
        active_labour_count: scopedWorkers.length,
        current_site_count: new Set(scopedDeployments.map((deployment: any) => deployment.site_id).filter(Boolean)).size || new Set(scopedWorkers.map((worker: any) => worker.current_site_id).filter(Boolean)).size,
        daily_wage_labour_count: scopedDeployments.filter((deployment: any) => deployment.commercial_model === "daily_wage").length,
        contract_basis_labour_count: scopedDeployments.filter((deployment: any) => deployment.commercial_model === "contract_basis").length,
        labour_workers: undefined,
        labour_deployments: undefined,
      };
    }).filter((row: any) => {
      if (!search) return true;
      const needle = search.toLowerCase();
      return [
        row.contractor_code,
        row.labour_licence_number,
        row.vendors?.vendor_name,
        row.primary_contact?.contact_name,
      ].some((value) => String(value || "").toLowerCase().includes(needle));
    });
    return NextResponse.json({ contractors });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load labour contractors.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, MODULE, "add");
    if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    const organizationId = await resolveOrganizationId(access, payload.organization_id);
    if (!organizationId) return jsonError("You cannot create contractor profiles outside your organization.", 403);
    const vendorId = text(payload.vendor_id);
    const contractorStatus = text(payload.contractor_status) || "active";
    if (!vendorId) return jsonError("Vendor is required.");
    if (!isValidActionValue(CONTRACTOR_STATUSES, contractorStatus)) return jsonError("Invalid contractor status.");

    const vendorCheck = await assertSameOrgVendor(access, organizationId, vendorId);
    if ("error" in vendorCheck) return jsonError(vendorCheck.error || "Selected vendor is not available.", 403);

    const { data: existingProfile, error: existingProfileError } = await access.admin
      .from("labour_contractor_profiles")
      .select("id")
      .eq("vendor_id", vendorId)
      .maybeSingle();
    if (existingProfileError) throw existingProfileError;
    if (existingProfile) return jsonError("Vendor is already enabled as a Labour Contractor.", 409);

    const contractorCode = normalizeIdentifier(payload.contractor_code);
    if (!contractorCode) return jsonError("Contractor code is required.");
    if (contractorCode) {
      const { data: existingCode, error: existingCodeError } = await access.admin
        .from("labour_contractor_profiles")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("contractor_code", contractorCode)
        .maybeSingle();
      if (existingCodeError) throw existingCodeError;
      if (existingCode) return jsonError("Contractor code already exists.", 409);
    }

    const insertPayload = {
      organization_id: organizationId,
      vendor_id: vendorId,
      contractor_code: contractorCode,
      contractor_status: contractorStatus,
      labour_licence_number: text(payload.labour_licence_number),
      labour_licence_valid_from: text(payload.labour_licence_valid_from),
      labour_licence_valid_to: text(payload.labour_licence_valid_to),
      epf_registration_number: text(payload.epf_registration_number),
      esi_registration_number: text(payload.esi_registration_number),
      principal_employer_name: text(payload.principal_employer_name),
      default_supervisor_name: text(payload.default_supervisor_name),
      default_supervisor_phone: text(payload.default_supervisor_phone),
      maximum_labour_capacity: payload.maximum_labour_capacity ? Number(payload.maximum_labour_capacity) : null,
      remarks: text(payload.remarks),
      ...actorFields(access.auth, "created"),
    };

    const { data, error } = await access.admin.from("labour_contractor_profiles").insert(insertPayload).select("id").single();
    if (error) throw error;

    await audit(access, request, {
      moduleCode: MODULE,
      action: "create",
      entityType: "labour_contractor_profile",
      recordId: data.id,
      organizationId,
      description: "Enabled vendor as labour contractor.",
      newValues: insertPayload,
    });

    return NextResponse.json({ contractor_profile_id: data.id });
  } catch (error: any) {
    return jsonError(error.message || "Failed to save labour contractor profile.", 500);
  }
}
