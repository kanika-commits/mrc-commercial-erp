import { createHash } from "crypto";
import { inflateRawSync } from "zlib";
import type { ServerPermissionContext } from "@/lib/serverPermissions";
import {
  isGlobalScope,
  isInOrganizationScope,
  loadActorOrganizationScope,
} from "@/lib/serverOrganizationScope";
import { insertErpAuditLog } from "@/lib/serverAudit";
import { parseSalaryAmount, SALARY_AMOUNT_FIELDS } from "@/lib/hr/salaryHistory";

type ServiceClient = any;

export const HR_EMPLOYEE_IMPORT_MODULE = "hr_employee_import";

export type ImportMasterData = {
  companies: any[];
  sites: any[];
  departments: any[];
  designations: any[];
};

export type ParsedWorkbookRow = {
  sheetName: string;
  rowNumber: number;
  raw: Record<string, string>;
};

export type ImportMapping = Record<string, any>;
export type ImportMasterMappingGroup = Record<string, string>;
export type ImportMasterMappings = {
  companies?: ImportMasterMappingGroup;
  sites?: ImportMasterMappingGroup;
  departments?: ImportMasterMappingGroup;
  designations?: ImportMasterMappingGroup;
};

export const MASTER_MAPPING_KEY = "__master_mappings";

export type EmployeeImportColumn = {
  field: string;
  label: string;
  category: "employee" | "personal" | "employment" | "compliance" | "bank" | "salary" | "legacy";
  aliases: string[];
  preserveOnly?: boolean;
};

export const EMPLOYEE_IMPORT_COLUMNS: EmployeeImportColumn[] = [
  { field: "source_serial_no", label: "SrNo", category: "legacy", aliases: ["srno", "sr no", "serial no"], preserveOnly: true },
  { field: "employee_code", label: "Employee Code", category: "employee", aliases: ["employee code", "employee no.", "employee no", "emp code"] },
  { field: "employee_title", label: "Employee Title", category: "personal", aliases: ["employee title", "title"] },
  { field: "work_id", label: "Work ID", category: "legacy", aliases: ["work id"], preserveOnly: true },
  { field: "employee_name", label: "Employee Name", category: "employee", aliases: ["employee name", "name"] },
  { field: "company_name", label: "Company Name", category: "employment", aliases: ["company name", "company"] },
  { field: "site_name", label: "Branch/Site Name", category: "employment", aliases: ["branch name", "site name", "site", "branch"] },
  { field: "department_name", label: "Department Name", category: "employment", aliases: ["department name", "department"] },
  { field: "designation_name", label: "Designation Name", category: "employment", aliases: ["designation name", "designation"] },
  { field: "shift", label: "Shift", category: "employment", aliases: ["shift name", "shift"] },
  { field: "father_name", label: "Father/Husband Name", category: "personal", aliases: ["father/husband name", "father husband name", "father name"] },
  { field: "mother_name", label: "Mother Name", category: "personal", aliases: ["mother name"] },
  { field: "spouse_name", label: "Spouse Name", category: "personal", aliases: ["spouse name"] },
  { field: "date_of_birth", label: "Date of Birth", category: "personal", aliases: ["date of birth", "dob"] },
  { field: "gender", label: "Gender", category: "personal", aliases: ["emp gender", "gender"] },
  { field: "blood_group", label: "Blood Group", category: "personal", aliases: ["blood group"] },
  { field: "marital_status", label: "Marital Status", category: "personal", aliases: ["marriage status", "marital status"] },
  { field: "marriage_anniversary", label: "Marriage Anniversary", category: "personal", aliases: ["marriage anniversary"] },
  { field: "current_address_line1", label: "Local Address", category: "personal", aliases: ["local address"] },
  { field: "current_address_city", label: "Local City", category: "personal", aliases: ["local city"] },
  { field: "personal_phone", label: "Local Mobile No", category: "employee", aliases: ["local mobile no", "mobile", "personal phone", "personal number"] },
  { field: "personal_email", label: "Local Email ID", category: "employee", aliases: ["local email id", "personal email"] },
  { field: "permanent_address_line1", label: "Permanent Address", category: "personal", aliases: ["permanet address", "permanent address"] },
  { field: "permanent_address_city", label: "Permanent City", category: "personal", aliases: ["permanet city", "permanent city"] },
  { field: "permanent_mobile_no", label: "Permanent Mobile No", category: "legacy", aliases: ["permanet mobile no", "permanent mobile no"], preserveOnly: true },
  { field: "permanent_email_id", label: "Permanent Email ID", category: "legacy", aliases: ["permanet email id", "permanent email id"], preserveOnly: true },
  { field: "interview_date", label: "Interview Date", category: "legacy", aliases: ["interview date"], preserveOnly: true },
  { field: "date_of_joining", label: "Joining Date", category: "employment", aliases: ["joining date", "date of joining"] },
  { field: "is_confirmed", label: "Is Confirm", category: "employment", aliases: ["is confirm"], preserveOnly: true },
  { field: "confirmation_date", label: "Confirm Date", category: "employment", aliases: ["confirm date", "confirmation date"] },
  { field: "reporting_manager_name", label: "Reporting Employee Name", category: "employment", aliases: ["reporting employee name", "reporting manager", "reporting manager name"] },
  { field: "reporting_local_mobile", label: "Reporting Local Mobile", category: "legacy", aliases: ["reporting local mobile"], preserveOnly: true },
  { field: "reporting_permanent_mobile", label: "Reporting Permanent Mobile", category: "legacy", aliases: ["reporting permanent mobile"], preserveOnly: true },
  { field: "driving_license_number", label: "Driving License No", category: "compliance", aliases: ["driving license no", "driving licence no"] },
  { field: "driving_license_valid_till", label: "Driving License Valid Till", category: "compliance", aliases: ["driving license valid till", "driving licence valid till"] },
  { field: "passport_number", label: "Passport No", category: "compliance", aliases: ["passport no"] },
  { field: "passport_issue_country", label: "Passport Issue Country", category: "compliance", aliases: ["passport issue country"] },
  { field: "passport_issue_date", label: "Passport Issue Date", category: "compliance", aliases: ["passport issue date"] },
  { field: "passport_expiry_date", label: "Passport Expiry Date", category: "compliance", aliases: ["passport expiry date"] },
  { field: "bank_account_number", label: "Bank A/C No", category: "bank", aliases: ["bank a/c no", "bank account no", "bank account number"] },
  { field: "bank_name", label: "Bank Name", category: "bank", aliases: ["bank name"] },
  { field: "bank_ifsc", label: "Bank IFSC", category: "bank", aliases: ["bank ifsc", "ifsc"] },
  { field: "pf_number", label: "PF No", category: "compliance", aliases: ["pf no", "pf"] },
  { field: "pf_joining_date", label: "PF Joining Date", category: "compliance", aliases: ["pf joining date"] },
  { field: "pan_number", label: "PAN No", category: "compliance", aliases: ["pan no", "pan"] },
  { field: "esi_number", label: "ESIC No", category: "compliance", aliases: ["esic no", "esi no", "esi", "esic"] },
  { field: "aadhaar_number", label: "Aadhaar No", category: "compliance", aliases: ["adhar no", "aadhaar no", "aadhar no", "aadhaar", "aadhar"] },
  { field: "voter_id", label: "Voter ID", category: "compliance", aliases: ["voter id"] },
  { field: "uan_number", label: "UNI/UAN No", category: "compliance", aliases: ["uni no", "uan no", "uan"] },
  { field: "branch_from_date", label: "Branch From Date", category: "employment", aliases: ["branch from date"] },
  { field: "branch_to_date", label: "Branch To Date", category: "employment", aliases: ["branch to date"] },
  { field: "is_active", label: "Is Active", category: "employment", aliases: ["is active"], preserveOnly: true },
  { field: "inactive_mode", label: "Inactive Mode", category: "employment", aliases: ["inactive mode"], preserveOnly: true },
  { field: "resign_date_legacy", label: "Resign Date", category: "employment", aliases: ["resign date"], preserveOnly: true },
  { field: "date_of_exit", label: "Relieving Date", category: "employment", aliases: ["relieving date"] },
  { field: "company_address1", label: "Company Address 1", category: "legacy", aliases: ["company address1", "company address 1"], preserveOnly: true },
  { field: "company_address2", label: "Company Address 2", category: "legacy", aliases: ["company address2", "company address 2"], preserveOnly: true },
  { field: "company_address3", label: "Company Address 3", category: "legacy", aliases: ["company address3", "company address 3"], preserveOnly: true },
  { field: "company_city", label: "Company City", category: "legacy", aliases: ["company city"], preserveOnly: true },
  { field: "branch_address1", label: "Branch Address 1", category: "legacy", aliases: ["branch address1", "branch address 1"], preserveOnly: true },
  { field: "branch_address2", label: "Branch Address 2", category: "legacy", aliases: ["branch address2", "branch address 2"], preserveOnly: true },
  { field: "branch_address3", label: "Branch Address 3", category: "legacy", aliases: ["branch address3", "branch address 3"], preserveOnly: true },
  { field: "branch_city", label: "Branch City", category: "legacy", aliases: ["branch city"], preserveOnly: true },
  { field: "joining_salary", label: "Joining Salary", category: "salary", aliases: ["joining salary"] },
  { field: "joining_salary_words", label: "Joining Salary Words", category: "salary", aliases: ["joining sal word"], preserveOnly: true },
  { field: "joining_net_salary", label: "Joining Net Salary", category: "salary", aliases: ["joining net salary"] },
  { field: "joining_net_salary_words", label: "Joining Net Salary Words", category: "salary", aliases: ["joining net sal word"], preserveOnly: true },
  { field: "joining_salary_effective_date", label: "Joining Salary Effective Date", category: "salary", aliases: ["joining appr date"] },
  { field: "gross_salary", label: "Current Salary", category: "salary", aliases: ["current salary", "gross salary"] },
  { field: "current_salary_words", label: "Current Salary Words", category: "salary", aliases: ["current sal word"], preserveOnly: true },
  { field: "net_salary", label: "Current Net Salary", category: "salary", aliases: ["current net salary", "net salary"] },
  { field: "current_net_salary_words", label: "Current Net Salary Words", category: "salary", aliases: ["current net sal word"], preserveOnly: true },
  { field: "current_salary_effective_date", label: "Current Salary Effective Date", category: "salary", aliases: ["current appr date"] },
  { field: "employment_type", label: "Employee Type", category: "employment", aliases: ["employee type", "employment type"] },
  { field: "resignation_date", label: "Resignation Date", category: "employment", aliases: ["resignation date"] },
  { field: "notice_period_from", label: "Notice From", category: "employment", aliases: ["notice from"] },
  { field: "notice_period_to", label: "Notice To", category: "employment", aliases: ["notice to"] },
  { field: "exit_remark", label: "Resign Remark", category: "employment", aliases: ["resign remark"] },
  { field: "remarks", label: "Employee Remark", category: "employee", aliases: ["emp remark"] },
  { field: "legacy_remark", label: "Remark", category: "legacy", aliases: ["remark"], preserveOnly: true },
];

const FIELD_BY_ALIAS = new Map<string, EmployeeImportColumn>();
const FIELD_BY_NAME = new Map<string, EmployeeImportColumn>();

for (const column of EMPLOYEE_IMPORT_COLUMNS) {
  FIELD_BY_NAME.set(column.field, column);
  for (const alias of column.aliases) {
    FIELD_BY_ALIAS.set(normalizeKey(alias), column);
  }
}

const DEFAULT_MAPPING: ImportMapping = {
  "employee no.": "employee_code",
  "employee no": "employee_code",
  "employee code": "employee_code",
  "emp code": "employee_code",
  "name": "employee_name",
  "employee name": "employee_name",
  "designation": "designation_name",
  "department": "department_name",
  "site name": "site_name",
  "site": "site_name",
  "company": "company_name",
  "company name": "company_name",
  "email": "email",
  "work email": "email",
  "personal email": "personal_email",
  "phone": "phone",
  "mobile": "phone",
  "work number": "phone",
  "personal phone": "personal_phone",
  "personal number": "personal_phone",
  "date of joining": "date_of_joining",
  "joining date": "date_of_joining",
  "employment type": "employment_type",
  "employee type": "employment_type",
  "gender": "gender",
  "date of birth": "date_of_birth",
  "dob": "date_of_birth",
  "gross salary": "gross_salary",
  "basic salary": "basic_salary",
  "net salary": "net_salary",
  "ctc": "ctc",
  "pan": "pan_number",
  "aadhaar": "aadhaar_number",
  "aadhar": "aadhaar_number",
  "uan": "uan_number",
  "esi": "esi_number",
  "esic": "esi_number",
  "pf": "pf_number",
};

const REQUIRED_FIELDS = ["employee_code", "employee_name", "site_name", "department_name", "designation_name"];
const DATE_FIELDS = new Set([
  "date_of_joining",
  "date_of_birth",
  "confirmation_date",
  "marriage_anniversary",
  "interview_date",
  "driving_license_valid_till",
  "passport_issue_date",
  "passport_expiry_date",
  "pf_joining_date",
  "branch_from_date",
  "branch_to_date",
  "resign_date_legacy",
  "date_of_exit",
  "joining_salary_effective_date",
  "current_salary_effective_date",
  "resignation_date",
  "notice_period_from",
  "notice_period_to",
]);
const COMPLIANCE_FIELDS: Record<string, string> = {
  pan_number: "PAN",
  aadhaar_number: "Aadhaar",
  uan_number: "UAN",
  esi_number: "ESI",
  pf_number: "PF",
  passport_number: "Passport",
  driving_license_number: "Driving Licence",
  voter_id: "Voter ID",
  bank_account_number: "Bank Account",
};

const PLACEHOLDER_IMPORT_VALUES = new Set([
  "",
  "'",
  "’",
  "0",
  "-",
  "na",
  "n/a",
  "nil",
  "none",
  "null",
  "not available",
]);

function normalizeKey(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function headerBaseName(value: unknown) {
  const text = String(value || "").trim();
  const parts = text.split("|").map((part) => part.trim()).filter(Boolean);
  return parts[parts.length - 1] || text;
}

export function normalizedHeaderName(value: unknown) {
  return normalizeKey(headerBaseName(value));
}

function normalizeLookup(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function masterMappingKey(value: unknown) {
  return normalizeLookup(value);
}

function textValue(value: unknown) {
  const text = String(value ?? "").trim();
  if (text === "'" || text === "’") return null;
  return text || null;
}

export function isPlaceholderImportValue(value: unknown) {
  return PLACEHOLDER_IMPORT_VALUES.has(String(value ?? "").trim().toLowerCase());
}

export function importRecordValue(value: unknown) {
  if (isPlaceholderImportValue(value)) return null;
  return textValue(value);
}

export function parseImportSalaryAmount(value: unknown) {
  if (isPlaceholderImportValue(value)) return null;
  return parseSalaryAmount(value);
}

function hashValue(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function xmlDecode(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function readZipEntries(buffer: Buffer) {
  const entries = new Map<string, Buffer>();
  const eocdSignature = 0x06054b50;
  let eocdOffset = -1;

  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 66000); offset -= 1) {
    if (buffer.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset === -1) throw new Error("Invalid XLSX file: zip directory was not found.");

  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  let offset = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;

  while (offset < end) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

    let data: Buffer;
    if (method === 0) {
      data = compressed;
    } else if (method === 8) {
      data = inflateRawSync(compressed, { finishFlush: 2 });
    } else {
      throw new Error(`Unsupported XLSX compression method ${method} for ${fileName}.`);
    }

    if (uncompressedSize > 0 && data.length !== uncompressedSize) {
      data = Buffer.from(data);
    }

    entries.set(fileName, data);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function readXml(entries: Map<string, Buffer>, path: string) {
  const data = entries.get(path);
  return data ? data.toString("utf8") : "";
}

function parseSharedStrings(xml: string) {
  const strings: string[] = [];
  const itemRegex = /<si\b[\s\S]*?<\/si>/g;
  const textRegex = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  const items = xml.match(itemRegex) || [];

  for (const item of items) {
    const parts: string[] = [];
    let match: RegExpExecArray | null;
    textRegex.lastIndex = 0;
    while ((match = textRegex.exec(item))) {
      parts.push(xmlDecode(match[1] || ""));
    }
    strings.push(parts.join(""));
  }

  return strings;
}

function parseRelationships(xml: string) {
  const rels = new Map<string, string>();
  const regex = /<Relationship\b([^>]*)\/>/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(xml))) {
    const attrs = match[1] || "";
    const id = attrs.match(/\bId="([^"]+)"/)?.[1];
    const target = attrs.match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) rels.set(id, target.replace(/^\//, ""));
  }

  return rels;
}

function parseWorkbookSheets(xml: string, rels: Map<string, string>) {
  const sheets: { name: string; path: string }[] = [];
  const regex = /<sheet\b([^>]*)\/>/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(xml))) {
    const attrs = match[1] || "";
    const name = xmlDecode(attrs.match(/\bname="([^"]+)"/)?.[1] || "");
    const relId = attrs.match(/\br:id="([^"]+)"/)?.[1];
    const target = relId ? rels.get(relId) : null;
    if (name && target) {
      sheets.push({
        name,
        path: target.startsWith("xl/") ? target : `xl/${target}`,
      });
    }
  }

  return sheets;
}

function columnIndex(cellRef: string) {
  const letters = (cellRef.match(/[A-Z]+/i)?.[0] || "").toUpperCase();
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

function parseSheetRows(xml: string, sharedStrings: string[]) {
  const rows: { rowNumber: number; values: string[] }[] = [];
  const rowRegex = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(xml))) {
    const rowAttrs = rowMatch[1] || "";
    const rowNumber = Number(rowAttrs.match(/\br="(\d+)"/)?.[1] || rows.length + 1);
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    cellRegex.lastIndex = 0;

    while ((cellMatch = cellRegex.exec(rowMatch[2] || ""))) {
      const attrs = cellMatch[1] || "";
      const body = cellMatch[2] || "";
      const ref = attrs.match(/\br="([^"]+)"/)?.[1] || "";
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] || "";
      const index = ref ? columnIndex(ref) : cells.length;
      const inlineText = body.match(/<is\b[\s\S]*?<t(?:\s[^>]*)?>([\s\S]*?)<\/t>[\s\S]*?<\/is>/)?.[1];
      const value = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let text = "";

      if (inlineText !== undefined) text = xmlDecode(inlineText);
      else if (type === "s" && value !== undefined) text = sharedStrings[Number(value)] || "";
      else if (value !== undefined) text = xmlDecode(value);

      cells[index] = String(text || "").trim();
    }

    if (cells.some(Boolean)) rows.push({ rowNumber, values: cells });
  }

  return rows;
}

function looksLikeHeader(values: string[]) {
  const normalized = values.map(normalizedHeaderName);
  const hits = normalized.filter((value) => DEFAULT_MAPPING[value] || FIELD_BY_ALIAS.has(value)).length;
  return hits >= 3 && normalized.some((value) => ["employee no.", "employee no", "employee code", "name", "employee name"].includes(value));
}

export function parseEmployeeWorkbook(buffer: Buffer): { rows: ParsedWorkbookRow[]; headers: string[]; sheetName: string } {
  const entries = readZipEntries(buffer);
  const sharedStrings = parseSharedStrings(readXml(entries, "xl/sharedStrings.xml"));
  const rels = parseRelationships(readXml(entries, "xl/_rels/workbook.xml.rels"));
  const sheets = parseWorkbookSheets(readXml(entries, "xl/workbook.xml"), rels);

  for (const sheet of sheets) {
    const sheetRows = parseSheetRows(readXml(entries, sheet.path), sharedStrings);
    const headerRowIndex = sheetRows.findIndex((row) => looksLikeHeader(row.values));
    if (headerRowIndex === -1) continue;

    const headers = sheetRows[headerRowIndex].values.map((value) => String(value || "").trim());
    const rows = sheetRows
      .slice(headerRowIndex + 1)
      .map((row) => {
        const raw: Record<string, string> = {};
        headers.forEach((header, index) => {
          if (header) raw[header] = String(row.values[index] || "").trim();
        });
        return { sheetName: sheet.name, rowNumber: row.rowNumber, raw };
      })
      .filter((row) => Object.values(row.raw).some(Boolean));

    return { rows, headers: headers.filter(Boolean), sheetName: sheet.name };
  }

  throw new Error("No employee sheet with recognizable headers was found.");
}

function excelSerialToDate(value: string) {
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial < 1 || serial > 60000) return null;
  const date = new Date(Date.UTC(1899, 11, 30));
  date.setUTCDate(date.getUTCDate() + Math.floor(serial));
  return date.toISOString().slice(0, 10);
}

export function isSentinelDate(value: unknown) {
  const text = String(value || "").trim().toLowerCase();
  return [
    "01 jan 1900",
    "01-jan-1900",
    "01/01/1900",
    "1900-01-01",
    "01 jan 1970",
    "01-jan-1970",
    "01/01/1970",
    "1970-01-01",
    "01 jan 2038",
    "01-jan-2038",
    "01/01/2038",
    "2038-01-01",
  ].includes(text);
}

function normalizeDate(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (isSentinelDate(text)) return null;
  const serialDate = excelSerialToDate(text);
  if (serialDate && isSentinelDate(serialDate)) return null;
  if (serialDate) return serialDate;
  const monthNames: Record<string, string> = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };
  const monthNameMatch = text.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{2,4})$/);
  if (monthNameMatch) {
    const month = monthNames[monthNameMatch[2].slice(0, 3).toLowerCase()];
    const year = monthNameMatch[3].length === 2 ? `20${monthNameMatch[3]}` : monthNameMatch[3];
    if (month) {
      const iso = `${year}-${month}-${monthNameMatch[1].padStart(2, "0")}`;
      return isSentinelDate(iso) ? null : iso;
    }
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const iso = parsed.toISOString().slice(0, 10);
    return isSentinelDate(iso) ? null : iso;
  }
  const match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (!match) return text;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  const iso = `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return isSentinelDate(iso) ? null : iso;
}

export function mappingFromHeaders(headers: string[], overrides: ImportMapping = {}) {
  const mapping: ImportMapping = {};
  for (const header of headers) {
    const normalized = normalizedHeaderName(header);
    mapping[header] =
      overrides[header] ||
      overrides[normalized] ||
      FIELD_BY_ALIAS.get(normalized)?.field ||
      DEFAULT_MAPPING[normalized] ||
      "";
  }
  return mapping;
}

export function normalizeImportRow(raw: Record<string, string>, mapping: ImportMapping) {
  const normalized: Record<string, unknown> = {};

  for (const [header, value] of Object.entries(raw)) {
    const targetValue = mapping[header] || mapping[normalizedHeaderName(header)] || "";
    const target = typeof targetValue === "string" ? targetValue : "";
    if (!target) continue;
    normalized[target] = DATE_FIELDS.has(target) ? normalizeDate(value) : textValue(value);
  }

  if (!normalized.employment_type) normalized.employment_type = "full_time";
  if (!normalized.status) normalized.status = "active";
  if (normalized.current_address_line1 && !normalized.current_address) normalized.current_address = normalized.current_address_line1;
  if (normalized.permanent_address_line1 && !normalized.permanent_address) normalized.permanent_address = normalized.permanent_address_line1;
  // Head Office workbook local contact fields are the employee's personal contact.
  // Permanent contact fields are preserve-only, used only as a fallback when local contact is blank.
  if (!normalized.personal_phone && normalized.permanent_mobile_no) normalized.personal_phone = normalized.permanent_mobile_no;
  if (!normalized.personal_email && normalized.permanent_email_id) normalized.personal_email = normalized.permanent_email_id;

  return normalized;
}

export function getImportMasterMappings(mapping: Record<string, any> | null | undefined): ImportMasterMappings {
  const value = mapping?.[MASTER_MAPPING_KEY];
  return value && typeof value === "object" ? value : {};
}

function findById(rows: any[], id: unknown) {
  const needle = String(id || "").trim();
  if (!needle) return null;
  return rows.find((row) => row.id === needle) || null;
}

export function applyMasterMappingsToNormalized(
  normalized: Record<string, any>,
  masters: ImportMasterData,
  mapping: Record<string, any> | null | undefined,
) {
  const masterMappings = getImportMasterMappings(mapping);
  const next = { ...normalized };

  const company = findById(masters.companies, masterMappings.companies?.[masterMappingKey(next.company_name)]);
  if (company) next.company_name = company.company_name;

  const site = findById(masters.sites, masterMappings.sites?.[masterMappingKey(next.site_name)]);
  if (site) {
    next.site_name = site.site_name;
    const siteCompany = findById(masters.companies, site.company_id);
    if (siteCompany && !company) next.company_name = siteCompany.company_name;
  }

  const department = findById(masters.departments, masterMappings.departments?.[masterMappingKey(next.department_name)]);
  if (department) next.department_name = department.department_name;

  const designation = findById(masters.designations, masterMappings.designations?.[masterMappingKey(next.designation_name)]);
  if (designation) next.designation_name = designation.designation_name;

  return next;
}

export function isImportableEmployeeRow(raw: Record<string, string>, mapping: ImportMapping) {
  const normalized = normalizeImportRow(raw, mapping);
  const employeeName = normalizeLookup(normalized.employee_name);
  const employeeCode = normalizeLookup(normalized.employee_code);
  const summaryLabels = new Set(["total", "grand total", "sub total", "subtotal"]);
  const hasEmployeeIdentity = Boolean(employeeName || employeeCode);
  const hasAssignmentIdentity = Boolean(
    textValue(normalized.site_name) ||
      textValue(normalized.department_name) ||
      textValue(normalized.designation_name) ||
      textValue(normalized.date_of_joining),
  );

  if (!hasEmployeeIdentity && !hasAssignmentIdentity) return false;
  if (summaryLabels.has(employeeName) || summaryLabels.has(employeeCode)) return false;
  if (/^(grand\s+)?total\b/.test(employeeName) || /^(grand\s+)?total\b/.test(employeeCode)) return false;
  if (employeeName.includes("grand total") || employeeCode.includes("grand total")) return false;

  return true;
}

export async function loadImportMasterData(admin: ServiceClient, auth: ServerPermissionContext): Promise<ImportMasterData> {
  const organizationScope = await loadActorOrganizationScope(admin, auth);
  const companyQuery = admin.from("companies").select("id, organization_id, company_name, company_code, status").order("company_name");
  const siteQuery = admin.from("sites").select("id, organization_id, company_id, site_name, site_code, status").order("site_name");
  const departmentQuery = admin.from("hr_departments").select("id, organization_id, department_name, department_code, status").order("department_name");
  const designationQuery = admin.from("hr_designations").select("id, organization_id, department_id, designation_name, designation_code, status").order("designation_name");

  const scopedCompanyQuery = isGlobalScope(organizationScope) ? companyQuery : companyQuery.in("organization_id", organizationScope);
  const scopedSiteQuery = isGlobalScope(organizationScope) ? siteQuery : siteQuery.in("organization_id", organizationScope);
  const scopedDepartmentQuery = isGlobalScope(organizationScope) ? departmentQuery : departmentQuery.in("organization_id", organizationScope);
  const scopedDesignationQuery = isGlobalScope(organizationScope) ? designationQuery : designationQuery.in("organization_id", organizationScope);

  const [companies, sites, departments, designations] = await Promise.all([
    scopedCompanyQuery,
    scopedSiteQuery,
    scopedDepartmentQuery,
    scopedDesignationQuery,
  ]);

  for (const result of [companies, sites, departments, designations]) {
    if (result.error) throw result.error;
  }

  return {
    companies: (companies.data || []).filter((row: any) => row.status !== "deleted"),
    sites: (sites.data || []).filter((row: any) => row.status !== "deleted"),
    departments: (departments.data || []).filter((row: any) => row.status !== "deleted"),
    designations: (designations.data || []).filter((row: any) => row.status !== "deleted"),
  };
}

function findUnique(rows: any[], value: unknown, nameFields: string[], codeFields: string[] = []) {
  const needle = normalizeLookup(value);
  if (!needle) return { match: null, ambiguous: false };
  const matches = rows.filter((row) =>
    [...nameFields, ...codeFields].some((field) => normalizeLookup(row[field]) === needle),
  );
  return { match: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1 };
}

export function validateNormalizedRow(
  normalized: Record<string, any>,
  masters: ImportMasterData,
  mapping?: Record<string, any> | null,
) {
  const errors: string[] = [];
  const warnings: string[] = [];
  normalized = applyMasterMappingsToNormalized(normalized, masters, mapping);
  const matches: Record<string, string | null> = {
    company_id: null,
    site_id: null,
    department_id: null,
    designation_id: null,
  };

  for (const field of REQUIRED_FIELDS) {
    if (!textValue(normalized[field])) errors.push(`${field.replace(/_/g, " ")} is required.`);
  }

  const today = new Date().toISOString().slice(0, 10);
  if (normalized.date_of_birth && String(normalized.date_of_birth) > today) {
    errors.push("Date of birth cannot be in the future.");
  }
  if (
    normalized.date_of_birth &&
    normalized.date_of_joining &&
    String(normalized.date_of_birth) > String(normalized.date_of_joining)
  ) {
    errors.push("Date of birth cannot be after joining date.");
  }

  const siteLookup = findUnique(masters.sites, normalized.site_name, ["site_name"], ["site_code"]);
  if (siteLookup.ambiguous) errors.push(`Site "${normalized.site_name}" matches multiple sites.`);
  if (!siteLookup.match) errors.push(`Site "${normalized.site_name || "-"}" was not found.`);
  if (siteLookup.match) {
    matches.site_id = siteLookup.match.id;
    matches.company_id = siteLookup.match.company_id || null;
  }

  if (normalized.company_name) {
    const companyLookup = findUnique(masters.companies, normalized.company_name, ["company_name"], ["company_code"]);
    if (companyLookup.ambiguous) errors.push(`Company "${normalized.company_name}" matches multiple companies.`);
    if (!companyLookup.match) errors.push(`Company "${normalized.company_name}" was not found.`);
    if (companyLookup.match) {
      if (matches.company_id && companyLookup.match.id !== matches.company_id) {
        errors.push("Selected site belongs to a different company.");
      }
      matches.company_id = companyLookup.match.id;
    }
  }

  if (!matches.company_id) {
    warnings.push("Company could not be resolved from the row; it will be derived from the matched site if available.");
  }

  const departmentLookup = findUnique(masters.departments, normalized.department_name, ["department_name"], ["department_code"]);
  if (departmentLookup.ambiguous) errors.push(`Department "${normalized.department_name}" matches multiple departments.`);
  if (!departmentLookup.match) errors.push(`Department "${normalized.department_name || "-"}" was not found.`);
  if (departmentLookup.match) matches.department_id = departmentLookup.match.id;

  const designationLookup = findUnique(masters.designations, normalized.designation_name, ["designation_name"], ["designation_code"]);
  if (designationLookup.ambiguous) errors.push(`Designation "${normalized.designation_name}" matches multiple designations.`);
  if (!designationLookup.match) errors.push(`Designation "${normalized.designation_name || "-"}" was not found.`);
  if (designationLookup.match) matches.designation_id = designationLookup.match.id;

  for (const field of SALARY_AMOUNT_FIELDS) {
    if (normalized[field] !== null && normalized[field] !== undefined && normalized[field] !== "") {
      try {
        normalized[field] = parseSalaryAmount(normalized[field]);
      } catch (error: any) {
        errors.push(`${field.replace(/_/g, " ")}: ${error.message}`);
      }
    }
  }

  return {
    errors,
    warnings,
    matches,
    normalized,
    mappingStatus: errors.some((error) => /was not found|matches multiple|different company/i.test(error)) ? "needs_review" : "mapped",
    validationStatus: errors.length > 0 ? "invalid" : warnings.length > 0 ? "warning" : "valid",
  };
}

export function summarizeRows(rows: { validation_status?: string; import_status?: string }[]) {
  return rows.reduce(
    (summary, row) => {
      summary.total += 1;
      if (row.validation_status === "valid" || row.validation_status === "warning") summary.ready += 1;
      if (row.validation_status === "invalid") summary.invalid += 1;
      if (row.import_status === "imported") summary.imported += 1;
      if (row.import_status === "failed") summary.failed += 1;
      if (row.import_status === "skipped") summary.skipped += 1;
      return summary;
    },
    { total: 0, ready: 0, invalid: 0, imported: 0, failed: 0, skipped: 0 },
  );
}

export function buildImportComplianceRows(normalized: Record<string, any>) {
  return Object.entries(COMPLIANCE_FIELDS)
    .map(([field, recordType]) => ({
      field,
      recordType,
      recordNumber: importRecordValue(normalized[field]),
    }))
    .filter((row) => row.recordNumber);
}

function hasImportSalaryData(values: Array<number | null>) {
  return values.some((value) => value !== null && value > 0);
}

export function buildImportSalaryPreview(normalized: Record<string, any>, fallbackJoiningDate?: string | null) {
  const joiningSalary = parseImportSalaryAmount(normalized.joining_salary);
  const joiningNetSalary = parseImportSalaryAmount(normalized.joining_net_salary);
  const currentGrossSalary = parseImportSalaryAmount(normalized.gross_salary);
  const currentNetSalary = parseImportSalaryAmount(normalized.net_salary);
  const joiningDate = textValue(normalized.joining_salary_effective_date) || fallbackJoiningDate || textValue(normalized.date_of_joining);
  const currentDate = textValue(normalized.current_salary_effective_date) || fallbackJoiningDate || textValue(normalized.date_of_joining);
  const rows: Array<Record<string, unknown>> = [];

  if (hasImportSalaryData([joiningSalary, joiningNetSalary])) {
    rows.push({
      revision_no: 1,
      revision_type: "joining_salary",
      effective_from: joiningDate,
      basic_salary: joiningSalary,
      gross_salary: joiningSalary,
      net_salary: joiningNetSalary,
      status: "historical",
      new_values: {
        joining_salary: joiningSalary,
        joining_net_salary: joiningNetSalary,
      },
    });
  }

  const currentMatchesJoining =
    rows.length > 0 &&
    joiningSalary === currentGrossSalary &&
    joiningNetSalary === currentNetSalary &&
    currentDate === joiningDate;

  if (hasImportSalaryData([currentGrossSalary, currentNetSalary]) && !currentMatchesJoining) {
    rows.push({
      revision_no: rows.length + 1,
      revision_type: rows.length > 0 ? "salary_correction" : "joining_salary",
      effective_from: currentDate,
      basic_salary: currentGrossSalary,
      gross_salary: currentGrossSalary,
      net_salary: currentNetSalary,
      status: "current",
      new_values: {
        gross_salary: currentGrossSalary,
        net_salary: currentNetSalary,
      },
    });
  }

  if (rows.length === 1) rows[0].status = "current";
  return rows;
}

export function rowPayloadForInsert(
  parsedRow: ParsedWorkbookRow,
  mapping: ImportMapping,
  masters: ImportMasterData,
  organizationId: string | null,
) {
  const normalized = applyMasterMappingsToNormalized(normalizeImportRow(parsedRow.raw, mapping), masters, mapping);
  const validation = validateNormalizedRow(normalized, masters, mapping);

  return {
    organization_id: organizationId,
    source_sheet_name: parsedRow.sheetName,
    source_row_number: parsedRow.rowNumber,
    source_row_hash: hashValue(parsedRow.raw),
    raw_data: parsedRow.raw,
    normalized_data: normalized,
    mapping_status: validation.mappingStatus,
    validation_status: validation.validationStatus,
    import_status: "pending",
    errors: validation.errors,
    warnings: validation.warnings,
    matched_company_id: validation.matches.company_id,
    matched_site_id: validation.matches.site_id,
    matched_department_id: validation.matches.department_id,
    matched_designation_id: validation.matches.designation_id,
  };
}

export async function scopedOrganizationId(admin: ServiceClient, auth: ServerPermissionContext, preferredOrganizationId?: string | null) {
  const organizationScope = await loadActorOrganizationScope(admin, auth);

  if (isGlobalScope(organizationScope)) {
    const preferred = String(preferredOrganizationId || "").trim();
    if (preferred) {
      const { data, error } = await admin
        .from("organizations")
        .select("id, status")
        .eq("id", preferred)
        .maybeSingle();

      if (error) throw error;
      return data && data.status !== "deleted" ? data.id : null;
    }

    const { data, error } = await admin
      .from("organizations")
      .select("id")
      .eq("status", "active")
      .order("created_at", { ascending: true });

    if (error) throw error;
    return (data || []).length === 1 ? data[0].id : null;
  }

  if (preferredOrganizationId && isInOrganizationScope(organizationScope, preferredOrganizationId)) return preferredOrganizationId;
  return organizationScope[0] || null;
}

export function importedBy(auth: ServerPermissionContext) {
  return {
    id: auth.user.id,
    name: auth.user.user_metadata?.full_name || auth.user.user_metadata?.name || auth.user.email || "HR User",
    email: auth.user.email || null,
  };
}

export async function executeImportRow(
  admin: ServiceClient,
  auth: ServerPermissionContext,
  batch: any,
  row: any,
  request: Request,
) {
  const normalized = row.normalized_data || {};
  const employeeCode = textValue(normalized.employee_code);
  const employeeName = textValue(normalized.employee_name);
  const actor = importedBy(auth);

  if (!employeeCode || !employeeName) {
    throw new Error("Employee code and name are required.");
  }

  const { data: duplicate, error: duplicateError } = await admin
    .from("hr_employees")
    .select("id")
    .eq("organization_id", row.organization_id)
    .ilike("employee_code", employeeCode)
    .neq("status", "deleted")
    .maybeSingle();

  if (duplicateError) throw duplicateError;
  if (duplicate) {
    return {
      status: "skipped",
      employeeId: duplicate.id,
      message: "Employee code already exists; row skipped idempotently.",
    };
  }

  const employeeInsert = {
    organization_id: row.organization_id,
    company_id: row.matched_company_id,
    site_id: row.matched_site_id,
    department_id: row.matched_department_id,
    designation_id: row.matched_designation_id,
    employee_code: employeeCode,
    employee_name: employeeName,
    email: textValue(normalized.email),
    phone: textValue(normalized.phone),
    personal_email: textValue(normalized.personal_email),
    personal_phone: textValue(normalized.personal_phone),
    date_of_birth: textValue(normalized.date_of_birth),
    gender: textValue(normalized.gender),
    date_of_joining: textValue(normalized.date_of_joining) || new Date().toISOString().slice(0, 10),
    employment_type: textValue(normalized.employment_type) || "full_time",
    status: textValue(normalized.status) || "active",
    created_by: auth.user.id,
    created_by_name: actor.name,
    created_by_email: actor.email,
  };

  const { data: employee, error: employeeError } = await admin
    .from("hr_employees")
    .insert(employeeInsert)
    .select("*")
    .single();

  if (employeeError) throw employeeError;

  try {
    const joinedDate = employee.date_of_joining || new Date().toISOString().slice(0, 10);
    const { error: historyError } = await admin.from("employee_employment_history").insert({
      organization_id: employee.organization_id,
      employee_id: employee.id,
      event_type: "joined",
      event_date: joinedDate,
      effective_from: joinedDate,
      title: "Joined",
      description: "Initial employment record created from Head Office import.",
      source: "import",
      is_manual: false,
      previous_values: null,
      new_values: employeeInsert,
      company_id: employee.company_id,
      site_id: employee.site_id,
      department_id: employee.department_id,
      designation_id: employee.designation_id,
      employment_type: employee.employment_type,
      employment_status: employee.status,
      source_system: "head_office_workbook",
      source_record_id: String(row.source_row_number),
      import_batch_id: batch.id,
      created_by: auth.user.id,
      created_by_name: actor.name,
      created_by_email: actor.email,
    });
    if (historyError && historyError.code !== "23505") throw historyError;

    const salaryRows = buildImportSalaryPreview(normalized, employee.date_of_joining).map((salaryRow) => ({
      ...salaryRow,
      organization_id: employee.organization_id,
      employee_id: employee.id,
      effective_to: null,
      source: "import",
      source_system: "head_office_workbook",
      source_record_id: String(row.source_row_number),
      import_batch_id: batch.id,
      previous_values: null,
      created_by: auth.user.id,
      created_by_name: actor.name,
      created_by_email: actor.email,
    }));

    if (salaryRows.length > 0) {
      const { error: salaryError } = await admin.from("employee_salary_history").insert(salaryRows);
      if (salaryError && salaryError.code !== "23505") throw salaryError;
    }

    const complianceRows = buildImportComplianceRows(normalized)
      .map(({ field, recordType, recordNumber }) => ({
        organization_id: employee.organization_id,
        employee_id: employee.id,
        import_batch_id: batch.id,
        import_row_id: row.id,
        record_type: recordType,
        record_number: recordNumber,
        record_name: recordType,
        metadata: { source_field: field },
        source: "import",
        status: "active",
        created_by: auth.user.id,
        created_by_name: actor.name,
        created_by_email: actor.email,
      }));

    if (complianceRows.length > 0) {
      const { error: complianceError } = await admin.from("employee_compliance_records").insert(complianceRows);
      if (complianceError && complianceError.code !== "23505") throw complianceError;
    }

    await insertErpAuditLog(admin, auth.user, {
      organizationId: employee.organization_id,
      companyId: employee.company_id,
      siteId: employee.site_id,
      moduleCode: HR_EMPLOYEE_IMPORT_MODULE,
      entityType: "hr_employee",
      recordId: employee.id,
      action: "import",
      description: `Employee ${employee.employee_name} imported from Head Office workbook.`,
      oldValues: null,
      newValues: employee,
      source: "import",
      importBatchId: batch.id,
    }, request);

    return { status: "imported", employeeId: employee.id, message: "Employee imported." };
  } catch (error) {
    await admin.from("hr_employees").delete().eq("id", employee.id);
    throw error;
  }
}

export function acceptedWorkbookFile(file: File) {
  const name = file.name.toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xlsm");
}

export function workbookHash(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
