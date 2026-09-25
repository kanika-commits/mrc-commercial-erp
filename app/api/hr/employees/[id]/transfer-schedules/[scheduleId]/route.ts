import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";
import { insertErpAuditLog } from "@/lib/serverAudit";

function adminClient() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!); }
export async function DELETE(request: Request, context: { params: Promise<{ id: string; scheduleId: string }> }) {
  const auth = await requirePermission(request, "hr_employees", "edit");
  if ("response" in auth) return auth.response;
  const { id, scheduleId } = await context.params;
  const admin = adminClient();
  const { data: employee, error: employeeError } = await admin.from("hr_employees").select("organization_id").eq("id", id).maybeSingle();
  if (employeeError) return NextResponse.json({ error: employeeError.message }, { status: 500 });
  if (!employee) return NextResponse.json({ error: "Employee was not found." }, { status: 404 });
  const { data, error } = await admin.rpc("cancel_hr_employee_transfer", { p_schedule_id: scheduleId, p_organization_id: employee.organization_id, p_actor_id: auth.user.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  await insertErpAuditLog(admin, auth.user, { organizationId: employee.organization_id, moduleCode: "hr_employees", entityType: "hr_employee_transfer_schedule", recordId: scheduleId, action: "delete", description: "Scheduled employee transfer cancelled.", newValues: data, source: "api" }, request);
  return NextResponse.json({ scheduled_transfer: data });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string; scheduleId: string }> }) {
  const auth = await requirePermission(request, "hr_employees", "edit");
  if ("response" in auth) return auth.response;
  const { id, scheduleId } = await context.params;
  const payload = await request.json().catch(() => ({}));
  const effectiveDate = String(payload.effective_date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) return NextResponse.json({ error: "A valid future effective date is required." }, { status: 400 });
  const admin = adminClient();
  const { data: employee, error: employeeError } = await admin.from("hr_employees").select("organization_id").eq("id", id).maybeSingle();
  if (employeeError) return NextResponse.json({ error: employeeError.message }, { status: 500 });
  if (!employee) return NextResponse.json({ error: "Employee was not found." }, { status: 404 });
  const { data, error } = await admin.rpc("reschedule_hr_employee_transfer", { p_schedule_id: scheduleId, p_organization_id: employee.organization_id, p_effective_date: effectiveDate, p_actor_id: auth.user.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  await insertErpAuditLog(admin, auth.user, { organizationId: employee.organization_id, moduleCode: "hr_employees", entityType: "hr_employee_transfer_schedule", recordId: scheduleId, action: "update", description: "Scheduled employee transfer rescheduled.", newValues: data, source: "api" }, request);
  return NextResponse.json({ scheduled_transfer: data });
}
