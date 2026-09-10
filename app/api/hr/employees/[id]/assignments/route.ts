import { NextResponse } from "next/server";
import { canAccessHrEmployee, hrAdminClient } from "@/app/api/hr/employees/_shared";
import { jsonError } from "@/lib/serverProcurementAccess";
import { requirePermission } from "@/lib/serverPermissions";

const MODULE = "hr_employees";

async function loadEmployee(request: Request, id: string, action: string) {
  const auth = await requirePermission(request, MODULE, action);
  if ("response" in auth) return { response: auth.response } as const;
  const admin = hrAdminClient();
  const { data: employee, error } = await admin.from("hr_employees").select("id,organization_id,company_id,site_id,status").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!employee || employee.status === "deleted") return { response: jsonError("Employee was not found.", 404) } as const;
  if (!(await canAccessHrEmployee(admin, auth, employee))) return { response: jsonError("You do not have access to this employee.", 403) } as const;
  return { auth, admin, employee } as const;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const { id } = await context.params; const result = await loadEmployee(request, id, "view"); if ("response" in result) return result.response; const { data, error } = await result.admin.from("hr_employee_company_assignments").select("id,organization_id,employee_id,company_id,designation_id,status,effective_from,effective_to,company:companies(id,company_name),designation:hr_designations(id,designation_name)").eq("employee_id", id).eq("organization_id", result.employee.organization_id).order("status").order("company_id"); if (error) throw error; return NextResponse.json({ assignments: data || [] }); } catch (error: any) { return jsonError(error.message || "Failed to load company assignments.", 500); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const result = await loadEmployee(request, id, "add"); if ("response" in result) return result.response;
    const body = await request.json().catch(() => ({})); const companyId = String(body.company_id || "").trim(); const designationId = String(body.designation_id || "").trim();
    if (!companyId || !designationId) return jsonError("Company and designation are required.", 400);
    const company = await result.admin.from("companies").select("id").eq("id", companyId).eq("organization_id", result.employee.organization_id).eq("status", "active").maybeSingle(); if (company.error) throw company.error; if (!company.data) return jsonError("Selected company is not available for this organization.", 403);
    const designation = await result.admin.from("hr_designations").select("id").eq("id", designationId).eq("organization_id", result.employee.organization_id).eq("status", "active").maybeSingle(); if (designation.error) throw designation.error; if (!designation.data) return jsonError("Selected designation is not available for this organization.", 403);
    const duplicate = await result.admin.from("hr_employee_company_assignments").select("id").eq("employee_id", id).eq("company_id", companyId).eq("status", "active").maybeSingle(); if (duplicate.error) throw duplicate.error; if (duplicate.data) return jsonError("An active assignment already exists for this employee and company.", 409);
    const { data, error } = await result.admin.from("hr_employee_company_assignments").insert({ organization_id: result.employee.organization_id, employee_id: id, company_id: companyId, designation_id: designationId, status: body.status === "inactive" ? "inactive" : "active", effective_from: body.effective_from || null, effective_to: body.effective_to || null }).select("id,organization_id,employee_id,company_id,designation_id,status,effective_from,effective_to,company:companies(id,company_name),designation:hr_designations(id,designation_name)").single(); if (error) throw error; return NextResponse.json({ assignment: data }, { status: 201 });
  } catch (error: any) { return jsonError(error.message || "Failed to create company assignment.", 500); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const result = await loadEmployee(request, id, "edit"); if ("response" in result) return result.response;
    const body = await request.json().catch(() => ({})); const assignmentId = String(body.assignment_id || "").trim(); if (!assignmentId) return jsonError("Assignment is required.", 400);
    const updates: Record<string, unknown> = {}; for (const key of ["company_id", "designation_id", "status", "effective_from", "effective_to"]) if (Object.prototype.hasOwnProperty.call(body, key)) updates[key] = body[key] || null;
    if (updates.company_id) { const company = await result.admin.from("companies").select("id").eq("id", updates.company_id).eq("organization_id", result.employee.organization_id).eq("status", "active").maybeSingle(); if (company.error) throw company.error; if (!company.data) return jsonError("Selected company is not available for this organization.", 403); }
    if (updates.designation_id) { const designation = await result.admin.from("hr_designations").select("id").eq("id", updates.designation_id).eq("organization_id", result.employee.organization_id).eq("status", "active").maybeSingle(); if (designation.error) throw designation.error; if (!designation.data) return jsonError("Selected designation is not available for this organization.", 403); }
    if (updates.status === "active" && updates.company_id) { const duplicate = await result.admin.from("hr_employee_company_assignments").select("id").eq("employee_id", id).eq("company_id", updates.company_id).eq("status", "active").neq("id", assignmentId).maybeSingle(); if (duplicate.error) throw duplicate.error; if (duplicate.data) return jsonError("An active assignment already exists for this employee and company.", 409); }
    const { data, error } = await result.admin.from("hr_employee_company_assignments").update(updates).eq("id", assignmentId).eq("employee_id", id).eq("organization_id", result.employee.organization_id).select("id,organization_id,employee_id,company_id,designation_id,status,effective_from,effective_to,company:companies(id,company_name),designation:hr_designations(id,designation_name)").single(); if (error) throw error; return NextResponse.json({ assignment: data });
  } catch (error: any) { return jsonError(error.message || "Failed to update company assignment.", 500); }
}
