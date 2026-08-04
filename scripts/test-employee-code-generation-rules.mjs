import assert from "node:assert/strict";
import fs from "node:fs";

const createApi = fs.readFileSync(new URL("../app/api/hr/employees/route.ts", import.meta.url), "utf8");
const editApi = fs.readFileSync(new URL("../app/api/hr/employees/[id]/route.ts", import.meta.url), "utf8");
const employeeForm = fs.readFileSync(new URL("../components/hr/EmployeeForm.tsx", import.meta.url), "utf8");
const detailPage = fs.readFileSync(new URL("../app/hr/employees/[id]/page.tsx", import.meta.url), "utf8");
const newPage = fs.readFileSync(new URL("../app/hr/employees/new/page.tsx", import.meta.url), "utf8");
const importLib = fs.readFileSync(new URL("../lib/hr/employeeImport.ts", import.meta.url), "utf8");
const importPage = fs.readFileSync(new URL("../app/hr/employees/import/page.tsx", import.meta.url), "utf8");
const importExecuteRoute = fs.readFileSync(new URL("../app/api/hr/employee-import/execute/route.ts", import.meta.url), "utf8");

assert.match(createApi, /admin\.rpc\("next_employee_code"\)/, "manual create API should use the shared employee-code generator when available");
assert.match(createApi, /Employee code generator is not available\. Apply the employee-code migration before creating employees\./, "manual create must fail safely when the employee-code migration is not available");
assert.doesNotMatch(createApi, /const employeeCode = requireText\(payload\.employee_code\)/, "manual create must not require employee_code from the client");
assert.doesNotMatch(createApi, /Employee code is required\./, "manual create must not show the legacy client-code requirement");
assert.doesNotMatch(createApi, /employee_code[\s\S]+already exists/i, "manual create must not duplicate-check client-supplied employee_code");
assert.match(createApi, /employee_code: employeeCode/, "manual create must insert the generated code");
assert.match(createApi, /employee_id: data\.id, employee_code: data\.employee_code/, "manual create response must return generated code");

assert.match(editApi, /employee_code: existing\.employee_code/, "employee edit must preserve existing employee_code");
assert.doesNotMatch(editApi, /const employeeCode = requireText\(payload\.employee_code\)/, "employee edit must ignore submitted employee_code");
assert.doesNotMatch(editApi, /employee_code[\s\S]+already exists/i, "employee edit must not duplicate-check employee_code changes");

assert.match(employeeForm, /Employee Code will be generated automatically\./, "create form must show generated-code helper");
assert.match(employeeForm, /name="employee_code" value=\{form\.employee_code\} readOnly/, "edit form must render employee_code read-only");
assert.match(detailPage, /Copy Employee Code/, "employee detail must expose copy action for code");
assert.match(newPage, /Generated Employee Code:/, "create success message must include generated code");

assert.match(importLib, /admin\.rpc\("next_employee_code"\)/, "employee import helper should generate codes through the shared RPC");
assert.match(importLib, /Employee code generator is not available\. Apply the employee-code migration before importing employees\./, "employee import must fail safely when the employee-code migration is unavailable");
assert.match(importLib, /employee_code: employeeCode/, "employee import helper must never insert NULL employee_code");
assert.match(importLib, /return \{ status: "imported", employeeId: employee\.id, employeeCode: employee\.employee_code/, "employee import helper must return generated code");
assert.match(importExecuteRoute, /executeImportRow\(admin, auth, batchResult\.batch, row, request\)/, "execute route must use the app-side helper that calls next_employee_code");
assert.doesNotMatch(importExecuteRoute, /admin\.rpc\("execute_employee_import_row"/, "execute route must not call stale database import RPC");
assert.match(importExecuteRoute, /\.in\("validation_status", \["valid", "warning"\]\)/, "execute route must select only ready validation rows");
assert.match(importExecuteRoute, /\.eq\("import_status", "pending"\)/, "execute route must not consume codes for already-existing or processed rows");
assert.match(importPage, /Generated Employee Code/, "import results must show generated codes");
assert.match(importPage, /Generated automatically/, "import preview must explain code generation");

console.log("Employee code generation rule tests passed.");
