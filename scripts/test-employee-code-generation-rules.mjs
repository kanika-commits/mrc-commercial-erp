import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(new URL("../supabase/migrations/202607310004_system_generated_employee_codes.sql", import.meta.url), "utf8");
const createApi = fs.readFileSync(new URL("../app/api/hr/employees/route.ts", import.meta.url), "utf8");
const editApi = fs.readFileSync(new URL("../app/api/hr/employees/[id]/route.ts", import.meta.url), "utf8");
const employeeForm = fs.readFileSync(new URL("../components/hr/EmployeeForm.tsx", import.meta.url), "utf8");
const detailPage = fs.readFileSync(new URL("../app/hr/employees/[id]/page.tsx", import.meta.url), "utf8");
const newPage = fs.readFileSync(new URL("../app/hr/employees/new/page.tsx", import.meta.url), "utf8");
const importLib = fs.readFileSync(new URL("../lib/hr/employeeImport.ts", import.meta.url), "utf8");
const importPage = fs.readFileSync(new URL("../app/hr/employees/import/page.tsx", import.meta.url), "utf8");
const importExecuteRoute = fs.readFileSync(new URL("../app/api/hr/employee-import/execute/route.ts", import.meta.url), "utf8");
const templateInspect = fs.readFileSync(new URL("../outputs/employee-import-template/ConstructIQ_Employee_Import_Template.xlsx.inspect.ndjson", import.meta.url), "utf8");

assert.match(migration, /create sequence if not exists public\.employee_code_sequence start with 5/i, "employee code sequence must start after reserved MRC0001-MRC0004");
assert.match(migration, /create table if not exists public\.employee_code_reservations/i, "reserved code table must exist");
assert.match(migration, /employee_code_reservations_assignment_consistency/i, "reservation rows must prevent contradictory assignment state");
assert.match(migration, /alter table public\.employee_code_reservations enable row level security/i, "reservation table must have RLS enabled");
assert.match(migration, /revoke all on table public\.employee_code_reservations from authenticated/i, "authenticated clients must not edit reservations directly");
assert.match(migration, /grant all on table public\.employee_code_reservations to service_role/i, "service role must retain reservation access");
for (const code of ["MRC0001", "MRC0002", "MRC0003", "MRC0004"]) {
  assert.ok(migration.includes(`'${code}'`), `${code} must be reserved`);
}
assert.match(migration, /date_of_joining asc nulls last[\s\S]+created_at asc[\s\S]+id asc/i, "existing employee renumbering must be deterministic");
assert.match(migration, /create or replace function public\.next_employee_code\(\)/i, "shared code generation function must exist");
assert.match(migration, /revoke all on function public\.next_employee_code\(\) from authenticated/i, "normal clients must not call next_employee_code directly");
assert.match(migration, /grant execute on function public\.next_employee_code\(\) to service_role/i, "server API must be able to call next_employee_code");
assert.match(migration, /revoke all on function public\.execute_employee_import_row\(uuid, uuid, uuid, text, text\) from authenticated/i, "normal clients must not call employee import RPC directly");
assert.match(migration, /grant execute on function public\.execute_employee_import_row\(uuid, uuid, uuid, text, text\) to service_role/i, "server import API must be able to call employee import RPC");
assert.match(migration, /not public\.is_reserved_employee_code\(v_code\)/i, "generator must skip reserved codes");
assert.match(migration, /where upper\(trim\(employee_code\)\) = upper\(trim\(v_code\)\)/i, "generator must skip already-used codes");
assert.match(migration, /v_employee_code := public\.next_employee_code\(\);/i, "import RPC must generate code server-side");
assert.doesNotMatch(migration, /v_normalized->>'employee_code'/i, "import RPC must not take employee_code from workbook data");

assert.match(createApi, /admin\.rpc\("next_employee_code"\)/, "manual create API must call shared generator");
assert.doesNotMatch(createApi, /requireText\(payload\.employee_code\)/, "manual create must not require employee_code from client");
assert.doesNotMatch(createApi, /employee_code[\s\S]+already exists/i, "manual create must not duplicate-check client-supplied employee_code");
assert.match(createApi, /employee_code: employeeCode/, "manual create must insert generated code");
assert.match(createApi, /employee_id: data\.id, employee_code: data\.employee_code/, "manual create response must return generated code");

assert.match(editApi, /employee_code: existing\.employee_code/, "employee edit must preserve existing employee_code");
assert.doesNotMatch(editApi, /requireText\(payload\.employee_code\)/, "employee edit must ignore submitted employee_code");
assert.doesNotMatch(editApi, /duplicateCode/i, "employee edit must not duplicate-check employee_code changes");

assert.match(employeeForm, /Employee Code will be generated automatically\./, "create form must show generated-code helper");
assert.match(employeeForm, /name="employee_code" value=\{form\.employee_code\} readOnly/, "edit form must render employee_code read-only");
assert.match(detailPage, /Copy Employee Code/, "employee detail must expose copy action for code");
assert.match(newPage, /Generated Employee Code:/, "create success message must include generated code");

assert.doesNotMatch(importLib, /"employee_code",\s*"employee_name",\s*"company_name"/, "import required fields must not include employee_code");
assert.match(importLib, /label: "Legacy Employee Code"[\s\S]+preserveOnly: true/, "legacy code column must be preserve-only");
assert.match(importLib, /admin\.rpc\("next_employee_code"\)/, "TypeScript import helper must generate code through shared RPC");
assert.match(importLib, /if \(!employeeName\)[\s\S]+throw new Error\("Employee name is required\."\);[\s\S]+admin\.rpc\("next_employee_code"\)/, "import helper must generate codes only after required row validation");
assert.match(importLib, /employee_code: employeeCode/, "import helper must never insert NULL employee_code");
assert.match(importLib, /return \{ status: "imported", employeeId: employee\.id, employeeCode: employee\.employee_code/, "import helper must return the generated code");
assert.match(importExecuteRoute, /\.in\("validation_status", \["valid", "warning"\]\)/, "execute route must select only ready validation rows");
assert.match(importExecuteRoute, /\.eq\("import_status", "pending"\)/, "execute route must not consume codes for already-existing or processed rows");
assert.match(importExecuteRoute, /executeImportRow\(admin, auth, batchResult\.batch, row, request\)/, "execute route must use the shared helper that calls next_employee_code");
assert.doesNotMatch(importExecuteRoute, /admin\.rpc\("execute_employee_import_row"/, "execute route must not call stale database RPC that may insert NULL employee_code");
assert.match(importPage, /Generated Employee Code/, "import results must show generated codes");
assert.match(importPage, /Generated automatically/, "import preview must explain code generation");

assert.ok(!templateInspect.includes('"Template Header","Employee Code"'), "official employee import template must not contain Employee Code as an import column");
assert.ok(!templateInspect.includes('"Employee Code","Basic"'), "official employee import column guide must not expose Employee Code as an editable field");
assert.ok(!templateInspect.includes("employee_code"), "official employee import template guide must not contain employee_code");
assert.ok(!templateInspect.includes("EMP001"), "official employee import template must not include a sample employee code");
assert.ok(templateInspect.includes("Employee Code is generated by ERP"), "template validation guide must describe generated employee codes");

console.log("Employee code generation rule tests passed.");
