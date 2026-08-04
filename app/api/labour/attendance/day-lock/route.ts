import { NextResponse } from "next/server";
import {
  actorFields,
  audit,
  getActiveAttendancePolicy,
  getActiveMusterConfiguration,
  getDayLock,
  jsonError,
  requireLabourPermission,
  resolveSiteAttendanceSystem,
  validateLabourCompanySiteIndependent,
  validateContractorProfile,
} from "@/app/api/labour/_shared";
import { IST_TIME_ZONE, isoDate, labourDayEndLockCutoff, labourPolicyLockCutoff, todayInIst } from "@/lib/labour/operations";
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

function formatIstTime(value: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(value).toUpperCase();
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_attendance_approval", "approve");
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
    if (attendanceDate > todayInIst()) return jsonError("Future labour attendance cannot be locked.");

    const scopeCheck = await validateLabourCompanySiteIndependent(access, requestedOrganizationId, companyId, siteId);
    if ("error" in scopeCheck) return jsonError(scopeCheck.error || "Selected company/site is not available.", 403);
    const organizationId = scopeCheck.organizationId;
    const system = await resolveSiteAttendanceSystem(access, { organizationId, companyId, siteId });
    if (!system.ok) return jsonError(system.message, 403);
    if (system.attendanceSystem === "site_in_engineer") return jsonError("This site uses Site-In & Engineer Daily Labour. Use Site-In and Engineer Daily Labour for attendance.", 403);
    const contractorCheck = await resolveContractorProfileId(access, organizationId, requestedContractorProfileId, contractorVendorId);
    if ("error" in contractorCheck) return jsonError(contractorCheck.error || "Selected contractor is not available.", 403);
    const contractorProfileId = contractorCheck.contractorProfileId;
    const configuration = await getActiveMusterConfiguration(access, { organizationId, companyId, siteId });
    const policy = configuration ? null : await getActiveAttendancePolicy(access, { organizationId, companyId, siteId });
    if (!configuration && !policy) return jsonError("Configure Muster Configuration before locking attendance for this site.", 403);
    const lockCutoff = configuration
      ? labourDayEndLockCutoff({ attendanceDate, delayHours: configuration.attendance_lock_hours, timezone: IST_TIME_ZONE })
      : labourPolicyLockCutoff({
          attendanceDate,
          shiftEndTime: policy.shift_end_time,
          delayHours: policy.auto_lock_delay_hours,
          timezone: policy.timezone || IST_TIME_ZONE,
        });
    if (!lockCutoff) return jsonError("Configure Attendance lock hours before locking attendance for this site.", 403);
    if (new Date().getTime() < lockCutoff.getTime()) {
      return jsonError(`Attendance can be locked after ${formatIstTime(lockCutoff)} IST as per the Attendance Policy.`, 403);
    }

    const existing = await getDayLock(access, { organizationId, companyId, siteId, contractorProfileId, attendanceDate });
    const payloadBase = {
      organization_id: organizationId,
      company_id: companyId,
      site_id: siteId,
      contractor_profile_id: contractorProfileId,
      attendance_date: attendanceDate,
      is_locked: true,
      locked_at: new Date().toISOString(),
      lock_reason: reason,
      updated_at: new Date().toISOString(),
      ...actorFields(access.auth, "locked" as any),
    };
    const { error } = existing
      ? await access.admin.from("labour_attendance_day_locks").update(payloadBase).eq("id", existing.id)
      : await access.admin.from("labour_attendance_day_locks").insert(payloadBase);
    if (error) throw error;
    await audit(access, request, {
      moduleCode: "labour_attendance_approval",
      action: "approve",
      entityType: "labour_attendance_day_lock",
      recordId: existing?.id || null,
      organizationId,
      companyId,
      siteId,
      description: `Locked labour attendance day ${attendanceDate}.`,
      newValues: { contractor_profile_id: contractorProfileId, source: "manual" },
    });
    return NextResponse.json({ locked: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to lock labour attendance day.", 500);
  }
}
