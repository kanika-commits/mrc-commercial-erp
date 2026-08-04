import { NextResponse } from "next/server";
import { applyCompanySiteScope, jsonError, requireLabourPermission } from "@/app/api/labour/_shared";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";
import { csvEscape, maskAadhaar } from "@/lib/labour/constants";

export async function GET(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_workers", "export");
    if ("response" in access) return access.response;
    let query = access.admin
      .from("labour_workers")
      .select(`
        labour_code, worker_name, father_or_husband_name, mobile_number,
        aadhaar_number, uan_number, esi_number, trade, skill_level,
        date_of_joining, date_of_exit, status,
        labour_contractor_profiles:current_contractor_profile_id(vendors(vendor_name)),
        companies:current_company_id(company_name),
        sites:current_site_id(site_name),
        work_orders:current_work_order_id(wo_number)
      `)
      .neq("status", "deleted")
      .order("worker_name");
    const orgScoped = applyOrganizationScope(query, access.organizationScope);
    if (!orgScoped) return new NextResponse("", { headers: { "content-type": "text/csv" } });
    const scoped = applyCompanySiteScope(orgScoped, access.assignments, "current_company_id", "current_site_id");
    if (!scoped) return new NextResponse("", { headers: { "content-type": "text/csv" } });
    const { data, error } = await scoped;
    if (error) throw error;
    const headers = ["Labour Code", "Worker Name", "Father/Husband Name", "Mobile", "Aadhaar", "UAN", "ESI", "Contractor", "Company", "Site", "Work Order", "Labour Category", "Skill Level", "Joining Date", "Exit Date", "Status"];
    const lines = [
      headers.map(csvEscape).join(","),
      ...(data || []).map((row: any) => [
        row.labour_code,
        row.worker_name,
        row.father_or_husband_name,
        row.mobile_number,
        maskAadhaar(row.aadhaar_number),
        row.uan_number,
        row.esi_number,
        row.labour_contractor_profiles?.vendors?.vendor_name,
        row.companies?.company_name,
        row.sites?.site_name,
        row.work_orders?.wo_number,
        row.trade,
        row.skill_level,
        row.date_of_joining,
        row.date_of_exit,
        row.status,
      ].map(csvEscape).join(",")),
    ];
    return new NextResponse(lines.join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename=\"labour-master.csv\"`,
      },
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to export labour master.", 500);
  }
}
