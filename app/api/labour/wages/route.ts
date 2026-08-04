import { NextResponse } from "next/server";
import {
  actorFields,
  audit,
  findOrCreateAttendancePeriod,
  jsonError,
  requireLabourPermission,
  validateCompanySite,
  validateContractorProfile,
} from "@/app/api/labour/_shared";
import { monthStart } from "@/lib/labour/operations";
import { csvEscape, normalizeText } from "@/lib/labour/constants";
import { applyCompanySiteScope } from "@/app/api/labour/_shared";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

export async function GET(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_wages", "view");
    if ("response" in access) return access.response;
    const { searchParams } = new URL(request.url);
    const exportCsv = searchParams.get("export") === "csv";
    let query = access.admin
      .from("labour_wage_periods")
      .select("*, companies(company_name), sites(site_name), labour_contractor_profiles(contractor_code, vendors(vendor_name))")
      .order("period_month", { ascending: false });
    const scoped = applyOrganizationScope(query, access.organizationScope);
    if (!scoped) return NextResponse.json({ wage_periods: [] });
    query = scoped;
    const scopedByAssignment = applyCompanySiteScope(query, access.assignments);
    if (!scopedByAssignment) return NextResponse.json({ wage_periods: [] });
    query = scopedByAssignment;
    if (searchParams.get("company_id")) query = query.eq("company_id", searchParams.get("company_id"));
    if (searchParams.get("site_id")) query = query.eq("site_id", searchParams.get("site_id"));
    if (searchParams.get("month")) query = query.eq("period_month", monthStart(searchParams.get("month")));
    const { data, error } = await query;
    if (error) throw error;
    if (exportCsv) {
      const rows = ["Month,Company,Site,Contractor,Status,Workers,Gross,Advance,Net"];
      for (const row of data || []) {
        rows.push([
          row.period_month,
          row.companies?.company_name,
          row.sites?.site_name,
          row.labour_contractor_profiles?.vendors?.vendor_name || "No Contractor",
          row.status,
          row.summary?.worker_count || 0,
          row.summary?.gross_wages || 0,
          row.summary?.advance_recovery || 0,
          row.summary?.net_wages || 0,
        ].map(csvEscape).join(","));
      }
      return new NextResponse(rows.join("\n"), {
        headers: { "content-type": "text/csv", "content-disposition": "attachment; filename=labour-wage-register.csv" },
      });
    }
    return NextResponse.json({ wage_periods: data || [] });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load labour wages.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_wages", "add");
    if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    const organizationId = text(payload.organization_id) || (Array.isArray(access.organizationScope) ? access.organizationScope[0] : null);
    const companyId = text(payload.company_id);
    const siteId = text(payload.site_id);
    const periodMonth = monthStart(payload.month);
    const contractorProfileId = text(payload.contractor_profile_id);
    if (!organizationId || !companyId || !siteId || !periodMonth) return jsonError("Company, site and month are required.");
    const scopeCheck = await validateCompanySite(access, organizationId, companyId, siteId);
    if ("error" in scopeCheck) return jsonError(scopeCheck.error || "Selected company/site is not available.", 403);
    const contractorCheck = await validateContractorProfile(access, organizationId, contractorProfileId);
    if ("error" in contractorCheck) return jsonError(contractorCheck.error || "Selected contractor is not available.", 403);
    const attendancePeriod = await findOrCreateAttendancePeriod(access, { organizationId, companyId, siteId, contractorProfileId, periodMonth, originatingAttendanceSystem: "standard" });
    let query = access.admin.from("labour_wage_periods").select("*").eq("attendance_period_id", attendancePeriod.id);
    const { data: existing, error: existingError } = await query.maybeSingle();
    if (existingError) throw existingError;
    if (existing) return NextResponse.json({ wage_period_id: existing.id });
    const insertPayload = {
      attendance_period_id: attendancePeriod.id,
      organization_id: organizationId,
      company_id: companyId,
      site_id: siteId,
      contractor_profile_id: contractorProfileId,
      period_month: periodMonth,
      status: "draft",
      ...actorFields(access.auth, "created"),
    };
    const { data, error } = await access.admin.from("labour_wage_periods").insert(insertPayload).select("id").single();
    if (error) throw error;
    await audit(access, request, {
      moduleCode: "labour_wages",
      action: "create",
      entityType: "labour_wage_period",
      recordId: data.id,
      organizationId,
      companyId,
      siteId,
      description: "Created labour wage period.",
      newValues: insertPayload,
    });
    return NextResponse.json({ wage_period_id: data.id });
  } catch (error: any) {
    return jsonError(error.message || "Failed to create wage period.", 500);
  }
}
