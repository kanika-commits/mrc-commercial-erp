import fs from "fs";
import path from "path";
import ts from "typescript";
import Module from "module";
import { createRequire } from "module";

const root = process.cwd();
const originalResolve = Module._resolveFilename;

Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    request = path.join(root, request.slice(2));
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

Module._extensions[".ts"] = function loadTs(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  module._compile(output, filename);
};

const require = createRequire(import.meta.url);
const {
  parseEmployeeWorkbook,
  mappingFromHeaders,
  normalizeImportRow,
  validateNormalizedRow,
  isImportableEmployeeRow,
  buildImportComplianceRows,
  buildImportSalaryPreview,
  importRecordValue,
  parseImportSalaryAmount,
} = require("../lib/hr/employeeImport.ts");

const workbookPath =
  process.argv[2] || "/Users/kanikapuri/Downloads/salary_statement_converted.xlsx";
const parsed = parseEmployeeWorkbook(fs.readFileSync(workbookPath));
const mapping = mappingFromHeaders(parsed.headers);
const retainedRows = parsed.rows.filter((candidate) => isImportableEmployeeRow(candidate.raw, mapping));
const skippedRows = parsed.rows.length - retainedRows.length;

const employeeNameHeader = parsed.headers.find((header) => header.includes("NAME")) || "NAME";
const employeeCodeHeader = parsed.headers.find((header) => header.includes("EMPLOYEE NO")) || parsed.headers[0];

const totalRaw = { [employeeNameHeader]: "TOTAL" };
const grandTotalRaw = { [employeeNameHeader]: "GRAND TOTAL" };
const blankRaw = Object.fromEntries(parsed.headers.map((header) => [header, ""]));
const genuineRaw = rowRawFromFields({
  employee_code: "TEST001",
  employee_name: "Test Employee",
  site_name: "HEAD OFFICE DASUYA",
  department_name: "ACCOUNT DEPARTMENT",
  designation_name: "ACCOUNTANT",
});

if (isImportableEmployeeRow(totalRaw, mapping)) throw new Error("TOTAL row should be skipped.");
if (isImportableEmployeeRow(grandTotalRaw, mapping)) throw new Error("GRAND TOTAL row should be skipped.");
if (isImportableEmployeeRow(blankRaw, mapping)) throw new Error("Blank footer row should be skipped.");
if (!isImportableEmployeeRow(genuineRaw, mapping)) throw new Error("Genuine employee row should be retained.");

const row = parsed.rows.find((candidate) => {
  const normalized = normalizeImportRow(candidate.raw, mapping);
  return String(normalized.employee_code || "").trim() === "1200";
});

if (!row) {
  throw new Error("Employee code 1200 was not found in the import workbook.");
}

const normalized = normalizeImportRow(row.raw, mapping);
const validation = validateNormalizedRow(normalized, {
  companies: [{ id: "company", organization_id: "org", company_name: normalized.company_name }],
  sites: [{ id: "site", organization_id: "org", company_id: "company", site_name: normalized.site_name }],
  departments: [{ id: "department", organization_id: "org", department_name: normalized.department_name }],
  designations: [{ id: "designation", organization_id: "org", designation_name: normalized.designation_name }],
});

const mappedValidation = validateNormalizedRow(
  normalizeImportRow(genuineRaw, mapping),
  {
    companies: [{ id: "company", organization_id: "org", company_name: "MRC Infracon Limited.", company_code: "MRC" }],
    sites: [{ id: "site", organization_id: "org", company_id: "company", site_name: "Head Office", site_code: "HO" }],
    departments: [{ id: "department", organization_id: "org", department_name: "Account Department", department_code: "ACCOUNT_DEPARTMENT" }],
    designations: [{ id: "designation", organization_id: "org", designation_name: "Accountant", designation_code: "ACCOUNTANT" }],
  },
  {
    __master_mappings: {
      sites: { "head office dasuya": "site" },
      departments: { "account department": "department" },
      designations: { "accountant": "designation" },
    },
  },
);

if (mappedValidation.errors.some((error) => /was not found|different company/i.test(error))) {
  throw new Error(`Expected saved master mappings to resolve, got ${mappedValidation.errors.join("; ")}`);
}

const complianceChecks = buildImportComplianceRows({
  passport_number: "0",
  uan_number: "'",
  pan_number: "ABCDE1234F",
});
if (complianceChecks.some((row) => row.recordType === "Passport")) {
  throw new Error("Passport value 0 should not create a compliance record.");
}
if (complianceChecks.some((row) => row.recordType === "UAN")) {
  throw new Error("UNI/UAN apostrophe placeholder should not create a compliance record.");
}
if (!complianceChecks.some((row) => row.recordType === "PAN")) {
  throw new Error("Genuine PAN should create a compliance record.");
}

if (parseImportSalaryAmount("") !== null) throw new Error("Blank salary should parse to null.");
if (parseImportSalaryAmount("0") !== null) throw new Error("Zero placeholder salary should parse to null.");
if (importRecordValue("0") !== null) throw new Error("Record value 0 should be treated as placeholder.");

const noSalaryRows = buildImportSalaryPreview({
  date_of_joining: "2024-01-01",
  joining_salary: "0",
  joining_net_salary: "0",
  gross_salary: "",
  net_salary: "",
});
if (noSalaryRows.length !== 0) throw new Error("Zero-placeholder salary should not create salary rows.");

const joiningSalaryRows = buildImportSalaryPreview({
  date_of_joining: "2024-01-01",
  joining_salary: "25000",
  joining_net_salary: "22000",
});
if (joiningSalaryRows.length !== 1 || joiningSalaryRows[0].revision_type !== "joining_salary") {
  throw new Error("Genuine joining salary should create one joining salary row.");
}

const currentSalaryRows = buildImportSalaryPreview({
  date_of_joining: "2024-01-01",
  gross_salary: "30000",
  net_salary: "27000",
  current_salary_effective_date: "2025-01-01",
});
if (currentSalaryRows.length !== 1 || currentSalaryRows[0].status !== "current") {
  throw new Error("Genuine current salary should create one current salary row.");
}

const currentOnlySalaryRows = buildImportSalaryPreview({
  date_of_joining: "2024-07-15",
  joining_salary: "0",
  joining_net_salary: "0",
  gross_salary: "18596",
  net_salary: "17268",
  current_salary_effective_date: "2025-04-01",
});
if (
  currentOnlySalaryRows.length !== 1 ||
  currentOnlySalaryRows[0].revision_type !== "joining_salary" ||
  currentOnlySalaryRows[0].gross_salary !== 18596 ||
  currentOnlySalaryRows[0].status !== "current"
) {
  throw new Error("Zero joining salary with genuine current salary should create one current salary row.");
}

const duplicateCurrentSalaryRows = buildImportSalaryPreview({
  date_of_joining: "2026-04-01",
  joining_salary: "18000",
  joining_net_salary: "18000",
  joining_salary_effective_date: "2026-04-01",
  gross_salary: "18000",
  net_salary: "18000",
  current_salary_effective_date: "2026-04-01",
});
if (duplicateCurrentSalaryRows.length !== 1 || duplicateCurrentSalaryRows[0].status !== "current") {
  throw new Error("Identical joining/current salary on the same date should not create a duplicate revision.");
}

if (normalized.date_of_birth !== "2026-01-01") {
  throw new Error(`Expected employee 1200 DOB to normalize to 2026-01-01, got ${normalized.date_of_birth}`);
}

if (!validation.errors.some((error) => error.includes("Date of birth"))) {
  throw new Error("Expected employee 1200 DOB to be a blocking validation error.");
}

console.log(
  JSON.stringify(
    {
      employee_code: normalized.employee_code,
      raw_rows: parsed.rows.length,
      skipped_rows: skippedRows,
      retained_rows: retainedRows.length,
      raw_dob: Object.entries(row.raw).find(([header]) => header.includes("DATE OF BIRTH"))?.[1],
      normalized_dob: normalized.date_of_birth,
      validation_errors: validation.errors,
      mapped_master_validation_errors: mappedValidation.errors,
    },
    null,
    2,
  ),
);

function rowRawFromFields(values) {
  const raw = Object.fromEntries(parsed.headers.map((header) => [header, ""]));
  for (const [header, field] of Object.entries(mapping)) {
    if (field && Object.prototype.hasOwnProperty.call(values, field)) {
      raw[header] = values[field];
    }
  }
  raw[employeeCodeHeader] ||= values.employee_code || "";
  raw[employeeNameHeader] ||= values.employee_name || "";
  return raw;
}
