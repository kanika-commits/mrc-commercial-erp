import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const registry = fs.readFileSync(path.join(root, "lib/releasedModuleRegistry.ts"), "utf8");

const required = [
  "dashboard",
  "work_orders",
  "wo_approval",
  "ra_bills",
  "debit_notes",
  "ra_approval",
  "invoices",
  "itc_claims",
  "payments",
  "companies",
  "sites",
  "vendors",
  "company_bank_accounts",
  "hr_employees",
  "hr_employee_import",
  "reimbursements",
  "hr_departments",
  "hr_designations",
  "organizations",
  "users",
  "roles",
  "permissions",
];

const forbidden = [
  "labour_",
  "/labour",
  "/hr/attendance",
  "/hr/attendance-approval",
  "/settings/policies/employee-attendance",
  "\"/reports\"",
  "/reports/builder",
  "store_management",
  "/modules/store-management",
  "/modules/support",
];

for (const item of required) {
  if (!registry.includes(item)) {
    throw new Error(`Released registry is missing ${item}.`);
  }
}

for (const item of forbidden) {
  if (item.startsWith("/") || item === "\"/reports\"") continue;
  if (registry.includes(item)) {
    throw new Error(`Released registry includes forbidden module token ${item}.`);
  }
}

for (const route of ["/labour", "/hr/attendance", "/hr/attendance-approval", "/reports", "/modules/store-management", "/modules/support"]) {
  if (!registry.includes(route)) {
    throw new Error(`Unreleased route ${route} must be explicitly denied.`);
  }
}

if (!registry.includes("/modules/reports")) {
  throw new Error("/modules/reports compatibility route must remain listed.");
}

for (const token of ["RELEASED_COMPATIBILITY_LAUNCHER_GROUPS", "\"/modules/contract-management\"", "\"purchase\"", "\"project_management\"", "\"accounts\""]) {
  if (!registry.includes(token)) {
    throw new Error(`Released registry must define compatibility launcher mapping ${token}.`);
  }
}

console.log("Release 1 module registry rules passed.");
