import { NextResponse } from "next/server";
import {
  actorFields,
  audit,
  getDayLock,
  hasAttendanceOverrideAuthority,
  jsonError,
  requireLabourPermission,
  resolveSiteAttendanceSystem,
  validateLabourCompanySiteIndependent,
  validateContractorProfile,
} from "@/app/api/labour/_shared";
import { isoDate } from "@/lib/labour/operations";
import { normalizeText } from "@/lib/labour/constants";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

async function resolveContractorProfileId(access: any, organizationId: string, profileId?: string | null, vendorId?: string | null): Promise<{ contractorProfileId: string | null } | { error: string }> {
  const directId = text(profileId);
  if (directId) {
    const contractorCheck = await validateContractorProfile(access, organizationId, directId);
    if ("error" in contractorCheck) return { error: contractorCheck.error || "Selected contractor is not available." };
    return { contractorProfileId: directId };
  }
  const selectedVendorId = text(vendorId);
  if (!selectedVendorId) return { contractorProfileId: null };
  const { data: profiles, error } = await access.admin
    .from("labour_contractor_profiles")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("vendor_id", selectedVendorId)
    .eq("contractor_status", "active")
    .order("contractor_code");
  if (error) throw error;
  if (!(profiles || []).length) return { error: "Selected contractor is not available." };
  return { contractorProfileId: profiles[0].id };
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_attendance_unlock", "approve");
    if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    const requestedOrganizationId = text(payload.organization_id) || (Array.isArray(access.organizationScope) ? access.organizationScope[0] : null);
    const companyId = text(payload.company_id);
    const siteId = text(payload.site_id);
    const attendanceDate = isoDate(payload.attendance_date);
    const requestedContractorProfileId = text(payload.contractor_profile_id);
    const contractorVendorId = text(payload.contractor_vendor_id);
    const reason = text(payload.reason);
    if (!companyId) return jsonError("Company is required.");
    if (!siteId) return jsonError("Site is required.");
    if (!payload.attendance_date) return jsonError("Attendance date is required.");
    if (!attendanceDate) return jsonError("Attendance date must be in YYYY-MM-DD format.");
    if (!reason || reason.length < 10) return jsonError("Enter a reason of at least 10 characters to unlock attendance.");

    const scopeCheck = await validateLabourCompanySiteIndependent(access, requestedOrganizationId, companyId, siteId);
    if ("error" in scopeCheck) return jsonError(scopeCheck.error || "Selected company/site is not available.", 403);
    const organizationId = scopeCheck.organizationId;
    const system = await resolveSiteAttendanceSystem(access, { organizationId, companyId, siteId });
    if (!system.ok) return jsonError(system.message, 403);
    if (system.attendanceSystem === "site_in_engineer") return jsonError("This site uses Site-In & Engineer Daily Labour. Use Site-In and Engineer Daily Labour for attendance.", 403);
    const contractorCheck = await resolveContractorProfileId(access, organizationId, requestedContractorProfileId, contractorVendorId);
    if ("error" in contractorCheck) return jsonError(contractorCheck.error || "Selected contractor is not available.", 403);
    const contractorProfileId = contractorCheck.contractorProfileId;
    if (!(await hasAttendanceOverrideAuthority(access, { organizationId, companyId, siteId }))) {
      return jsonError("You are not assigned as Attendance override authority for this Site.", 403);
    }
    const existing = await getDayLock(access, { organizationId, companyId, siteId, contractorProfileId, attendanceDate });
    if (!existing?.is_locked) return jsonError("This labour attendance day is not locked.");

    const updatePayload = {
      is_locked: false,
      unlocked_at: new Date().toISOString(),
      unlock_reason: reason,
      updated_at: new Date().toISOString(),
      ...actorFields(access.auth, "unlocked" as any),
    };
    const { error } = await access.admin.from("labour_attendance_day_locks").update(updatePayload).eq("id", existing.id);
    if (error) throw error;
    await audit(access, request, {
      moduleCode: "labour_attendance_unlock",
      action: "approve",
      entityType: "labour_attendance_day_lock",
      recordId: existing.id,
      organizationId,
      companyId,
      siteId,
      description: `Unlocked labour attendance day ${attendanceDate}.`,
      oldValues: existing,
      newValues: updatePayload,
    });
    return NextResponse.json({ unlocked: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to unlock labour attendance day.", 500);
  }
}
