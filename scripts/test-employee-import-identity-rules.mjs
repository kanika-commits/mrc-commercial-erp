import fs from "fs";
import path from "path";
import ts from "typescript";
import Module from "module";
import { createRequire } from "module";

const root = process.cwd();
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, isMain, options);
};
Module._extensions[".ts"] = function loadTs(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  module._compile(output, filename);
};

const require = createRequire(import.meta.url);
const {
  normalizeIdentityPhone,
  normalizeIdentityEmail,
  resolveExistingEmployeeIdentity,
  normalizeImportRow,
  validateNormalizedRow,
} = require("../lib/hr/employeeImport.ts");

if (normalizeIdentityPhone("+91 96227-01555") !== "9622701555") throw new Error("Indian phone normalization failed.");
if (normalizeIdentityEmail("  Person@Example.COM ") !== "person@example.com") throw new Error("Email normalization failed.");

const base = { organization_id: "org-a", matched_company_id: "company-a", matched_site_id: "site-a", normalized_data: { employee_name: "Test", phone: "+91 96227-01555" } };
const sameContext = resolveExistingEmployeeIdentity(base, [{ id: "employee-a", organization_id: "org-a", company_id: "company-a", site_id: "site-a", status: "active", personal_phone: "9622701555" }]);
if (sameContext.kind !== "match") throw new Error("Same-context cross-field phone match should resolve existing employee.");

const otherSite = resolveExistingEmployeeIdentity(base, [{ id: "employee-b", organization_id: "org-a", company_id: "company-a", site_id: "site-b", status: "active", phone: "9622701555" }]);
if (otherSite.kind !== "review") throw new Error("Cross-site identity match must require review.");

const otherOrganization = resolveExistingEmployeeIdentity(base, [{ id: "employee-c", organization_id: "org-b", company_id: "company-a", site_id: "site-a", status: "active", phone: "9622701555" }]);
if (otherOrganization.kind !== "none") throw new Error("Identity must not cross organization boundaries.");

const conflict = resolveExistingEmployeeIdentity({ ...base, normalized_data: { phone: "9622701555", email: "a@example.com" } }, [
  { id: "employee-a", organization_id: "org-a", company_id: "company-a", site_id: "site-a", status: "active", phone: "9622701555" },
  { id: "employee-b", organization_id: "org-a", company_id: "company-a", site_id: "site-a", email: "a@example.com" },
]);
if (conflict.kind !== "review") throw new Error("Conflicting phone/email identities must require review.");

const nameOnly = resolveExistingEmployeeIdentity({ ...base, normalized_data: { employee_name: "Same Name" } }, [{ id: "employee-a", organization_id: "org-a", company_id: "company-a", site_id: "site-a", employee_name: "Same Name", status: "active" }]);
if (nameOnly.kind !== "none") throw new Error("Name alone must not match.");

const inactive = resolveExistingEmployeeIdentity(base, [{ id: "employee-a", organization_id: "org-a", company_id: "company-a", site_id: "site-a", status: "deleted", phone: "9622701555" }]);
if (inactive.kind !== "review") throw new Error("Inactive identity must require review.");

const duplicatePhone = resolveExistingEmployeeIdentity(base, [
  { id: "employee-a", organization_id: "org-a", company_id: "company-a", site_id: "site-a", phone: "9622701555" },
  { id: "employee-b", organization_id: "org-a", company_id: "company-a", site_id: "site-a", personal_phone: "9622701555" },
]);
if (duplicatePhone.kind !== "review") throw new Error("Ambiguous phone identity must require review.");

const dateMapping = { DOB: "date_of_birth", Joining: "date_of_joining" };
const invalidDates = normalizeImportRow({ DOB: "0036-02-10", Joining: "0023-01-09" }, dateMapping);
const dateValidation = validateNormalizedRow(invalidDates, { companies: [], sites: [], departments: [], designations: [] });
if (!dateValidation.errors.some((error) => error.includes("could not be safely interpreted"))) throw new Error("Malformed years must be rejected.");
const validDates = normalizeImportRow({ DOB: "10/02/1936", Joining: "09/01/2023" }, dateMapping);
if (validDates.date_of_birth !== "1936-02-10" || validDates.date_of_joining !== "2023-01-09") throw new Error("Four-digit DD/MM/YYYY dates should remain deterministic.");

console.log("Employee import identity/date rules passed.");
