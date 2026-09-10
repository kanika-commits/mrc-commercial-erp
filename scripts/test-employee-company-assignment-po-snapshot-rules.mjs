import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/202609100016_hr_employee_company_assignments_po_approver_snapshot.sql", "utf8");
const pdf = fs.readFileSync("app/api/procurement/purchase-orders/[id]/pdf/route.ts", "utf8");
const signature = fs.readFileSync("lib/hr/employeeSignature.ts", "utf8");
const assignmentsApi = fs.readFileSync("app/api/hr/employees/[id]/assignments/route.ts", "utf8");
const employeeEdit = fs.readFileSync("app/hr/employees/[id]/edit/page.tsx", "utf8");

const checks = [
  [migration.includes("create table if not exists public.hr_employee_company_assignments"), "assignment table exists"],
  [migration.includes("organization_id uuid not null") && migration.includes("employee_id uuid not null") && migration.includes("company_id uuid not null") && migration.includes("designation_id uuid not null"), "assignment scope fields exist"],
  [migration.includes("employee_id, company_id") && migration.includes("where status = 'active'"), "duplicate active assignment is blocked"],
  [migration.includes("e.organization_id = new.organization_id") && migration.includes("c.organization_id = new.organization_id") && migration.includes("d.organization_id = new.organization_id"), "cross-organization assignment is blocked"],
  [migration.includes("insert into public.hr_employee_company_assignments") && migration.includes("from public.hr_employees e"), "existing assignments are backfilled"],
  [migration.includes("add column if not exists approved_by_designation_name") && migration.includes("add column if not exists approved_signature_profile_id"), "approval snapshot columns exist"],
  [migration.includes("No active designation is configured for this employee under the selected PO company."), "missing company assignment blocks approval"],
  [migration.includes("a.company_id = v_po.company_id") && migration.includes("a.organization_id = v_po.organization_id"), "approval resolves assignment by PO company and organization"],
  [pdf.includes("row.approved_by_designation_name") && pdf.includes("row.approved_by_company_name"), "PDF prefers frozen approval snapshot"],
  [pdf.includes("data.approved_signature_profile_id"), "PDF passes frozen signature reference"],
  [signature.includes("signatureProfileId") && signature.includes("eq(\"id\", input.signatureProfileId)"), "signature lookup can use frozen profile reference"],
  [assignmentsApi.includes("export async function GET") && assignmentsApi.includes("export async function POST") && assignmentsApi.includes("export async function PATCH"), "assignment list/create/update APIs exist"],
  [assignmentsApi.includes("organization_id",) && assignmentsApi.includes("Selected company is not available for this organization") && assignmentsApi.includes("Selected designation is not available for this organization"), "assignment API enforces organization ownership"],
  [employeeEdit.includes("Company Assignments") && employeeEdit.includes("+ Add Company Assignment") && employeeEdit.includes("Inactivate"), "employee edit exposes assignment management"],
  [employeeEdit.includes("const refreshed = await apiFetch(`/api/hr/employees/${params.id}/assignments`)") , "assignment mutations refetch persisted state"],
];

for (const [ok, label] of checks) if (!ok) throw new Error(`FAIL: ${label}`);
console.log("PASS: employee company assignment and PO approver snapshot rules");
