import { NextResponse } from "next/server";
import { actorFields, audit, jsonError, requireLabourPermission } from "@/app/api/labour/_shared";
import { boolValue, dateText, numberOrNull, timeText } from "@/lib/labour/v2";
import { normalizeText } from "@/lib/labour/constants";
import { applyOrganizationScope, isInOrganizationScope } from "@/lib/serverOrganizationScope";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

const AUDITED_POLICY_FIELDS = [
  "attendance_system",
  "shift_start_time",
  "shift_end_time",
  "auto_lock_basis",
  "auto_lock_delay_hours",
  "backdated_window_days",
  "max_daily_ot_minutes",
  "require_normal_work_photo",
  "require_ot_start_photo",
  "require_ot_end_photo",
  "status",
];

function comparableValue(value: unknown) {
  return value === undefined ? null : value;
}

function changedValues(oldRow: Record<string, any> | null, newRow: Record<string, any>) {
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  for (const field of AUDITED_POLICY_FIELDS) {
    if (!oldRow || comparableValue(oldRow[field]) !== comparableValue(newRow[field])) {
      oldValues[field] = oldRow ? comparableValue(oldRow[field]) : null;
      newValues[field] = comparableValue(newRow[field]);
    }
  }
  return { oldValues, newValues, changedFields: Object.keys(newValues) };
}

function maximumDailyOtMinutes(value: unknown): { minutes: number | null; error?: never } | { minutes?: never; error: string } {
  const hours = numberOrNull(value);
  if (hours === null) return { minutes: null };
  if (hours < 0 || hours > 24 || !Number.isInteger(hours)) {
    return { error: "Maximum Daily OT must be a whole number of hours between 0 and 24." };
  }
  return { minutes: hours * 60 };
}

function attendanceSystemValue(value: unknown) {
  const next = text(value);
  if (!next) return null;
  if (next === "standard" || next === "site_in_engineer") return next;
  return "__invalid__";
}

async function loadPolicyLookups(access: Awaited<ReturnType<typeof requireLabourPermission>>) {
  if ("response" in access) return { companies: [], sites: [] };
  let companyQuery = applyOrganizationScope(
    access.admin.from("companies").select("id, organization_id, company_name, company_code, status").eq("status", "active").order("company_name"),
    access.organizationScope,
  );
  const siteBaseQuery = applyOrganizationScope(
    access.admin.from("sites").select("id, organization_id, company_id, site_name, site_code, status").eq("status", "active").order("site_name"),
    access.organizationScope,
  );

  if (companyQuery && access.assignments.companyIds?.length) {
    companyQuery = companyQuery.in("id", access.assignments.companyIds);
  } else if (companyQuery && access.assignments.companyIds && !access.assignments.companyIds.length) {
    companyQuery = null;
  }

  let siteQuery = siteBaseQuery;
  if (siteQuery && access.assignments.siteIds?.length) {
    siteQuery = siteQuery.in("id", access.assignments.siteIds);
  } else if (siteQuery && access.assignments.siteIds && !access.assignments.siteIds.length && access.assignments.companyIds && !access.assignments.companyIds.length) {
    siteQuery = null;
  }

  const [companies, sites] = await Promise.all([
    companyQuery ? companyQuery : Promise.resolve({ data: [], error: null }),
    siteQuery ? siteQuery : Promise.resolve({ data: [], error: null }),
  ]);
  if (companies.error) throw companies.error;
  if (sites.error) throw sites.error;
  return { companies: companies.data || [], sites: sites.data || [] };
}

async function resolvePolicyScope(
  access: Exclude<Awaited<ReturnType<typeof requireLabourPermission>>, { response: Response }>,
  requestedOrganizationId: string | null,
  companyId: string,
  siteId: string,
) {
  const [{ data: company, error: companyError }, { data: site, error: siteError }] = await Promise.all([
    access.admin
      .from("companies")
      .select("id, organization_id, status")
      .eq("id", companyId)
      .maybeSingle(),
    access.admin
      .from("sites")
      .select("id, organization_id, company_id, status")
      .eq("id", siteId)
      .maybeSingle(),
  ]);
  if (companyError) throw companyError;
  if (siteError) throw siteError;
  if (!company || !isInOrganizationScope(access.organizationScope, company.organization_id)) {
    return { error: "Selected company is not available." };
  }
  if (requestedOrganizationId && requestedOrganizationId !== company.organization_id) {
    return { error: "Selected company is not available." };
  }
  if (!site || site.organization_id !== company.organization_id) {
    return { error: "Selected site is not available for this organization." };
  }
  if (access.assignments.companyIds && !access.assignments.companyIds.includes(companyId)) {
    return { error: "Selected company is outside your assigned scope." };
  }
  if (access.assignments.siteIds && !access.assignments.siteIds.includes(siteId)) {
    return { error: "Selected site is outside your assigned scope." };
  }
  return { organizationId: company.organization_id, company, site };
}

export async function GET(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_attendance_policy", "view");
    if ("response" in access) return access.response;
    const { searchParams } = new URL(request.url);
    const companyId = text(searchParams.get("company_id"));
    const siteId = text(searchParams.get("site_id"));
    let query = access.admin.from("labour_site_attendance_policies").select("*, companies(company_name), sites(site_name)").order("effective_from", { ascending: false });
    const scoped = applyOrganizationScope(query, access.organizationScope);
    if (!scoped) return NextResponse.json({ policies: [] });
    query = scoped;
    if (companyId) query = query.eq("company_id", companyId);
    if (siteId) query = query.eq("site_id", siteId);
    let activityQuery: any = access.admin
      .from("erp_audit_logs")
      .select("id, action, description, old_values, new_values, company_id, site_id, record_id, created_by_name, created_by_email, created_at")
      .eq("module_code", "labour_attendance_policy")
      .eq("entity_type", "labour_site_attendance_policy")
      .order("created_at", { ascending: false });
    const scopedActivityQuery = applyOrganizationScope(activityQuery, access.organizationScope);
    if (!scopedActivityQuery) return NextResponse.json({ policies: [], activity_logs: [] });
    activityQuery = scopedActivityQuery;
    if (access.assignments.siteIds?.length) {
      activityQuery = activityQuery.in("site_id", access.assignments.siteIds);
    } else if (access.assignments.companyIds?.length) {
      activityQuery = activityQuery.in("company_id", access.assignments.companyIds);
    } else if (access.assignments.siteIds && !access.assignments.siteIds.length && access.assignments.companyIds && !access.assignments.companyIds.length) {
      activityQuery = null;
    }

    const [{ data, error }, { data: activityLogs, error: activityError }] = await Promise.all([
      query,
      activityQuery ? activityQuery : Promise.resolve({ data: [], error: null }),
    ]);
    if (error) throw error;
    if (activityError) throw activityError;
    const lookups = await loadPolicyLookups(access);
    const policyIds = new Set((data || []).map((policy: any) => policy.id));
    return NextResponse.json({ policies: data || [], activity_logs: (activityLogs || []).filter((log: any) => policyIds.has(log.record_id)), ...lookups });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load attendance policies.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_attendance_policy", "edit");
    if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    const requestedOrganizationId = text(payload.organization_id);
    const companyId = text(payload.company_id);
    const siteId = text(payload.site_id);
    const effectiveFrom = dateText(payload.effective_from) || new Date().toISOString().slice(0, 10);
    if (!companyId || !siteId) return jsonError("Company and site are required.");
    const scopeCheck = await resolvePolicyScope(access, requestedOrganizationId, companyId, siteId);
    if ("error" in scopeCheck) return jsonError(scopeCheck.error || "Selected company/site is not available.", 403);
    const organizationId = scopeCheck.organizationId;
    const otLimit = maximumDailyOtMinutes(payload.max_daily_ot_hours);
    if (otLimit.error) return jsonError(otLimit.error);
    const attendanceSystem = attendanceSystemValue(payload.attendance_system);
    if (attendanceSystem === "__invalid__") return jsonError("Attendance System is not supported.");
    const shiftStartTime = timeText(payload.shift_start_time);
    const shiftEndTime = timeText(payload.shift_end_time);

    const { data: existing, error: existingError } = await access.admin
      .from("labour_site_attendance_policies")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("company_id", companyId)
      .eq("site_id", siteId)
      .eq("status", "active")
      .is("effective_to", null)
      .maybeSingle();
    if (existingError) throw existingError;

    const nextPayload = {
      organization_id: organizationId,
      company_id: companyId,
      site_id: siteId,
      attendance_system: attendanceSystem,
      timezone: text(payload.timezone) || "Asia/Kolkata",
      shift_start_time: shiftStartTime,
      shift_end_time: shiftEndTime,
      attendance_entry_cutoff: timeText(payload.attendance_entry_cutoff),
      normal_work_photo_cutoff: timeText(payload.normal_work_photo_cutoff),
      overtime_submission_cutoff: timeText(payload.overtime_submission_cutoff),
      overtime_approval_cutoff: timeText(payload.overtime_approval_cutoff),
      auto_lock_time: timeText(payload.auto_lock_time),
      auto_lock_basis: text(payload.auto_lock_basis) || "after_shift_end",
      auto_lock_delay_hours: Math.max(0, Math.min(168, Math.round(Number(payload.auto_lock_delay_hours ?? 4)))),
      backdated_window_days: numberOrNull(payload.backdated_window_days) || 0,
      max_daily_ot_minutes: otLimit.minutes,
      max_monthly_ot_minutes: numberOrNull(payload.max_monthly_ot_minutes),
      minimum_ot_minutes: numberOrNull(payload.minimum_ot_minutes),
      require_normal_work_photo: boolValue(payload.require_normal_work_photo),
      require_ot_start_photo: boolValue(payload.require_ot_start_photo),
      require_ot_end_photo: boolValue(payload.require_ot_end_photo),
      status: "active",
      effective_from: effectiveFrom,
    };

    let result;
    if (existing) {
      result = await access.admin.from("labour_site_attendance_policies").update({
        ...nextPayload,
        ...actorFields(access.auth, "updated"),
        updated_at: new Date().toISOString(),
      }).eq("id", existing.id).select("id").single();
    } else {
      result = await access.admin.from("labour_site_attendance_policies").insert({
        ...nextPayload,
        ...actorFields(access.auth, "created"),
      }).select("id").single();
    }
    if (result.error) throw result.error;
    const changes = changedValues(existing, nextPayload);
    if (!existing || changes.changedFields.length) {
      const reason = text(payload.reason);
      await audit(access, request, {
        moduleCode: "labour_attendance_policy",
        action: existing ? "update" : "create",
        entityType: "labour_site_attendance_policy",
        recordId: result.data.id,
        organizationId,
        companyId,
        siteId,
        description: existing ? "Updated labour attendance policy." : "Created labour attendance policy.",
        oldValues: existing ? { ...changes.oldValues, reason } : null,
        newValues: { ...changes.newValues, reason },
      });
    }
    return NextResponse.json({ policy_id: result.data.id });
  } catch (error: any) {
    return jsonError(error.message || "Failed to save attendance policy.", 500);
  }
}
