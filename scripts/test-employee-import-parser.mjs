import fs from "fs";
import path from "path";
import ts from "typescript";
import Module from "module";
import { createRequire } from "module";

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(text);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

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
  assertEmployeeWorkbookColumnIntegrity,
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
assertEmployeeWorkbookColumnIntegrity(parsed);
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
const cleanedWorkbookRaw = {
  "Employee Code": "MRC1212",
  "Full Name": "ABHISHEK KUMAR",
  "Company Name": "MRC INFRACON LIMITED",
  "Site Name": "BALANCE WORK OF CONSTRUCTION OF HEADQUARTER BUILDING (GLC)",
  Department: "ELECTRICAL DEPARTMENT",
  Designation: "ELECTRICAL ENGINEER",
  "Joining Date": "07 Apr 2026",
  "Reporting Manager": "",
  Status: "1",
};
const cleanedHeaders = Object.keys(cleanedWorkbookRaw);
const unsafeSavedMapping = {
  "Full Name": "employee_name",
  "Joining Date": "reporting_manager_name",
  Status: "reporting_manager_name",
  "__master_mappings": {
    designations: { "store kepeer": "store-keeper" },
  },
};
const cleanedMapping = mappingFromHeaders(cleanedHeaders, unsafeSavedMapping);
const cleanedNormalized = normalizeImportRow(cleanedWorkbookRaw, cleanedMapping);

if (cleanedMapping["Full Name"] !== "employee_name") throw new Error("Full Name should map to Employee Name.");
if (cleanedMapping["Joining Date"] !== "date_of_joining") throw new Error("Joining Date canonical mapping must not be overwritten by stale saved mappings.");
if (cleanedMapping.Status === "reporting_manager_name") throw new Error("Status must not be mapped to Reporting Manager by stale mappings.");
if (cleanedNormalized.employee_name !== "ABHISHEK KUMAR") throw new Error("Employee name should survive saved mapping application.");
if (cleanedNormalized.date_of_joining !== "2026-04-07") throw new Error("DD Mon YYYY Joining Date should parse to ISO date.");
if (cleanedNormalized.reporting_manager_name) throw new Error("Blank Reporting Manager should remain blank.");
if (String(cleanedNormalized.reporting_manager_name || "").match(/31|40|48|57|65|73|80/)) {
  throw new Error("Reporting Manager must not receive numeric values from unrelated columns.");
}
if (cleanedMapping.__master_mappings?.designations?.["store kepeer"] !== "store-keeper") {
  throw new Error("Saved Store Keeper master mapping should be preserved for only that source value.");
}

const cleanedWorkbookPath = "/Users/kanikapuri/Downloads/Employee_Import_Cleaned.xlsx";
if (fs.existsSync(cleanedWorkbookPath)) {
  const cleanedParsed = parseEmployeeWorkbook(fs.readFileSync(cleanedWorkbookPath));
  assertEmployeeWorkbookColumnIntegrity(cleanedParsed);
  const cleanedRow2 = cleanedParsed.rows.find((candidate) => candidate.rowNumber === 2);
  if (!cleanedRow2) throw new Error("Cleaned employee import row 2 should be parsed.");
  if (cleanedParsed.headerColumns.Gender !== 9) throw new Error(`Expected Gender in worksheet column 9, got ${cleanedParsed.headerColumns.Gender}`);
  if (cleanedParsed.headerColumns["Personal Email"] !== 11) throw new Error(`Expected Personal Email in worksheet column 11, got ${cleanedParsed.headerColumns["Personal Email"]}`);
  if (cleanedParsed.headerColumns["Joining Date"] !== 12) throw new Error(`Expected Joining Date in worksheet column 12, got ${cleanedParsed.headerColumns["Joining Date"]}`);
  if (cleanedParsed.headerColumns["Reporting Manager"] !== 13) throw new Error(`Expected Reporting Manager in worksheet column 13, got ${cleanedParsed.headerColumns["Reporting Manager"]}`);
  if (cleanedRow2.raw["Full Name"] !== "ABHISHEK KUMAR") throw new Error("Cleaned row 2 full name should stay in its source column.");
  if (cleanedRow2.raw["Joining Date"] !== "07 Apr 2026") throw new Error("Cleaned row 2 joining date should stay in Joining Date.");
  if (cleanedRow2.raw["Reporting Manager"] !== "") throw new Error("Cleaned row 2 blank Reporting Manager should remain blank.");
  if (cleanedRow2.raw.Gender !== "") throw new Error("Cleaned row 2 blank Gender should not receive a neighboring value.");
  if (cleanedRow2.raw["Personal Email"] !== "") throw new Error("Cleaned row 2 blank Personal Email should not receive a neighboring value.");
  for (const header of cleanedParsed.headers) {
    if (cleanedRow2.rawSourceColumns?.[header] !== cleanedParsed.headerColumns[header]) {
      throw new Error(`Cleaned row 2 ${header} did not preserve its worksheet source column.`);
    }
  }
}

const sparseWorkbook = createStoredZip({
  "xl/workbook.xml": `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Employee Import" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
  "xl/worksheets/sheet1.xml": `<worksheet><sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Employee Code</t></is></c><c r="B1" t="inlineStr"><is><t>Employee Full Name</t></is></c><c r="I1" t="inlineStr"><is><t>Gender</t></is></c><c r="K1" t="inlineStr"><is><t>Personal Email</t></is></c><c r="L1" t="inlineStr"><is><t>Joining Date</t></is></c><c r="M1" t="inlineStr"><is><t>Reporting Manager</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>MRC1212</t></is></c><c r="B2" t="inlineStr"><is><t>ABHISHEK KUMAR</t></is></c><c r="I2" s="29"/><c r="K2" s="30"/><c r="L2" t="inlineStr"><is><t>07 Apr 2026</t></is></c><c r="M2" s="31"/></row>
  </sheetData></worksheet>`,
});
const sparseParsed = parseEmployeeWorkbook(sparseWorkbook);
assertEmployeeWorkbookColumnIntegrity(sparseParsed);
const sparseRow2 = sparseParsed.rows[0];
const sparseMapping = mappingFromHeaders(sparseParsed.headers);
const sparseNormalized = normalizeImportRow(sparseRow2.raw, sparseMapping);
if (sparseParsed.headerColumns.Gender !== 9) throw new Error("Sparse fixture should preserve Gender as physical column I.");
if (sparseParsed.headerColumns["Personal Email"] !== 11) throw new Error("Sparse fixture should preserve Personal Email as physical column K.");
if (sparseParsed.headerColumns["Joining Date"] !== 12) throw new Error("Sparse fixture should preserve Joining Date as physical column L.");
if (sparseParsed.headerColumns["Reporting Manager"] !== 13) throw new Error("Sparse fixture should preserve Reporting Manager as physical column M.");
if (sparseRow2.raw.Gender !== "") throw new Error("Self-closing styled blank Gender cell must remain blank, not style id 29.");
if (sparseRow2.raw["Personal Email"] !== "") throw new Error("Self-closing styled blank Personal Email cell must remain blank, not style id 30.");
if (sparseRow2.raw["Reporting Manager"] !== "") throw new Error("Self-closing styled blank Reporting Manager cell must remain blank, not style id 31.");
if (sparseRow2.raw["Joining Date"] !== "07 Apr 2026") throw new Error("Joining Date after sparse blank cells must not be lost.");
if (sparseNormalized.date_of_joining !== "2026-04-07") throw new Error("Sparse fixture Joining Date should normalize to 2026-04-07.");
if (sparseNormalized.reporting_manager_name) throw new Error("Sparse fixture Reporting Manager should remain blank after mapping.");

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

const duplicateDesignationValidation = validateNormalizedRow(
  {
    employee_code: "TEST002",
    employee_name: "Duplicate Designation",
    company_name: "MRC Infracon Limited.",
    site_name: "Head Office",
    department_name: "Account Department",
    designation_name: "COOK",
    date_of_joining: "2026-04-07",
  },
  {
    companies: [{ id: "company", organization_id: "org", company_name: "MRC Infracon Limited.", company_code: "MRC" }],
    sites: [{ id: "site", organization_id: "org", company_id: "company", site_name: "Head Office", site_code: "HO" }],
    departments: [{ id: "department", organization_id: "org", department_name: "Account Department", department_code: "ACCOUNT_DEPARTMENT" }],
    designations: [
      { id: "cook-1", organization_id: "org", designation_name: "COOK", designation_code: "COOK" },
      { id: "cook-2", organization_id: "org", designation_name: "COOK", designation_code: "COOK_HELPER" },
    ],
  },
);
if (!duplicateDesignationValidation.errors.includes('Designation "COOK" matches multiple designations.')) {
  throw new Error(`Expected duplicate designation error, got ${duplicateDesignationValidation.errors.join("; ")}`);
}
if (duplicateDesignationValidation.errors.some((error) => error.includes('Designation "COOK" was not found.'))) {
  throw new Error(`Duplicate designation must not also be reported as not found: ${duplicateDesignationValidation.errors.join("; ")}`);
}

const duplicateManagerValidation = validateNormalizedRow(
  {
    employee_code: "TEST003",
    employee_name: "Duplicate Manager",
    company_name: "MRC Infracon Limited.",
    site_name: "Head Office",
    department_name: "Account Department",
    designation_name: "Accountant",
    date_of_joining: "2026-04-07",
    reporting_manager_name: "RAHUL",
  },
  {
    companies: [{ id: "company", organization_id: "org", company_name: "MRC Infracon Limited.", company_code: "MRC" }],
    sites: [{ id: "site", organization_id: "org", company_id: "company", site_name: "Head Office", site_code: "HO" }],
    departments: [{ id: "department", organization_id: "org", department_name: "Account Department", department_code: "ACCOUNT_DEPARTMENT" }],
    designations: [{ id: "designation", organization_id: "org", designation_name: "Accountant", designation_code: "ACCOUNTANT" }],
    employees: [
      { id: "manager-1", organization_id: "org", employee_name: "RAHUL", employee_code: "MGR1" },
      { id: "manager-2", organization_id: "org", employee_name: "RAHUL", employee_code: "MGR2" },
    ],
  },
);
if (!duplicateManagerValidation.errors.includes('Reporting Manager "RAHUL" matches multiple employees.')) {
  throw new Error(`Expected duplicate reporting manager error, got ${duplicateManagerValidation.errors.join("; ")}`);
}
if (duplicateManagerValidation.errors.some((error) => error.includes('Reporting Manager "RAHUL" was not found.'))) {
  throw new Error(`Duplicate reporting manager must not also be reported as not found: ${duplicateManagerValidation.errors.join("; ")}`);
}

const duplicateMasters = {
  companies: [
    { id: "company-1", organization_id: "org", company_name: "MRC", company_code: "MRC1" },
    { id: "company-2", organization_id: "org", company_name: "MRC", company_code: "MRC2" },
  ],
  sites: [
    { id: "site-1", organization_id: "org", company_id: "company-1", site_name: "HEAD OFFICE", site_code: "HO1" },
    { id: "site-2", organization_id: "org", company_id: "company-1", site_name: "HEAD OFFICE", site_code: "HO2" },
  ],
  departments: [
    { id: "department-1", organization_id: "org", department_name: "KITCHEN", department_code: "KITCHEN1" },
    { id: "department-2", organization_id: "org", department_name: "KITCHEN", department_code: "KITCHEN2" },
  ],
  designations: [
    { id: "cook-1", organization_id: "org", designation_name: "COOK", designation_code: "COOK" },
    { id: "cook-2", organization_id: "org", designation_name: "COOK", designation_code: "COOK_HELPER" },
  ],
  employees: [
    { id: "manager-1", organization_id: "org", employee_name: "RAHUL", employee_code: "MGR1" },
    { id: "manager-2", organization_id: "org", employee_name: "RAHUL", employee_code: "MGR2" },
  ],
};
const mappedDuplicateMastersValidation = validateNormalizedRow(
  {
    employee_code: "TEST004",
    employee_name: "Mapped Duplicate Masters",
    company_name: "MRC",
    site_name: "HEAD OFFICE",
    department_name: "KITCHEN",
    designation_name: "COOK",
    date_of_joining: "2026-04-07",
    reporting_manager_name: "RAHUL",
  },
  duplicateMasters,
  {
    __master_mappings: {
      companies: { mrc: "company-1" },
      sites: { "head office": "site-1" },
      departments: { kitchen: "department-1" },
      designations: { cook: "cook-1" },
      reporting_managers: { rahul: "manager-1" },
    },
  },
);
if (mappedDuplicateMastersValidation.errors.some((error) => /matches multiple|was not found/i.test(error))) {
  throw new Error(`Saved master mappings should bypass ambiguity lookup, got ${mappedDuplicateMastersValidation.errors.join("; ")}`);
}
if (mappedDuplicateMastersValidation.matches.designation_id !== "cook-1") {
  throw new Error(`Expected mapped COOK designation id cook-1, got ${mappedDuplicateMastersValidation.matches.designation_id}`);
}
if (mappedDuplicateMastersValidation.matches.reporting_manager_id !== "manager-1") {
  throw new Error(`Expected mapped reporting manager id manager-1, got ${mappedDuplicateMastersValidation.matches.reporting_manager_id}`);
}

const independentCompanySiteValidation = validateNormalizedRow(
  {
    employee_name: "Independent Site Employee",
    company_name: "MRC Infracon Limited",
    site_name: "ITOB, Gurugram",
    department_name: "Account Department",
    designation_name: "Accountant",
    date_of_joining: "2026-04-07",
  },
  {
    companies: [
      { id: "mrc", organization_id: "org", company_name: "MRC Infracon Limited", company_code: "MRC" },
      { id: "glc", organization_id: "org", company_name: "GLC", company_code: "GLC" },
    ],
    sites: [
      { id: "itob-null", organization_id: "org", company_id: null, site_name: "ITOB, Gurugram", site_code: "ITOB" },
    ],
    departments: [{ id: "department", organization_id: "org", department_name: "Account Department", department_code: "ACCOUNT_DEPARTMENT" }],
    designations: [{ id: "designation", organization_id: "org", designation_name: "Accountant", designation_code: "ACCOUNTANT" }],
  },
);
if (independentCompanySiteValidation.errors.length > 0) {
  throw new Error(`Independent active company/site should validate, got ${independentCompanySiteValidation.errors.join("; ")}`);
}
if (independentCompanySiteValidation.matches.company_id !== "mrc" || independentCompanySiteValidation.matches.site_id !== "itob-null") {
  throw new Error("Independent company/site validation must preserve selected company and selected site IDs.");
}

const differentSiteCompanyValidation = validateNormalizedRow(
  {
    employee_name: "Cross Company Site Employee",
    company_name: "MRC Infracon Limited",
    site_name: "Shared Site",
    department_name: "Account Department",
    designation_name: "Accountant",
    date_of_joining: "2026-04-07",
  },
  {
    companies: [
      { id: "mrc", organization_id: "org", company_name: "MRC Infracon Limited", company_code: "MRC" },
      { id: "glc", organization_id: "org", company_name: "GLC", company_code: "GLC" },
    ],
    sites: [
      { id: "shared", organization_id: "org", company_id: "glc", site_name: "Shared Site", site_code: "SHARED" },
    ],
    departments: [{ id: "department", organization_id: "org", department_name: "Account Department", department_code: "ACCOUNT_DEPARTMENT" }],
    designations: [{ id: "designation", organization_id: "org", designation_name: "Accountant", designation_code: "ACCOUNTANT" }],
  },
);
if (differentSiteCompanyValidation.errors.some((error) => /different company|not available for this company/i.test(error))) {
  throw new Error(`Employee Import must not use sites.company_id ownership validation: ${differentSiteCompanyValidation.errors.join("; ")}`);
}
if (differentSiteCompanyValidation.errors.length > 0) {
  throw new Error(`Different/null site.company_id should not block Employee Import, got ${differentSiteCompanyValidation.errors.join("; ")}`);
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
