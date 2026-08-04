import { createHash } from "crypto";
import { inflateRawSync } from "zlib";
import { headerBaseName } from "@/lib/hr/employeeImport";
import { normalizeIdentifier, normalizeLookup, normalizeText } from "@/lib/labour/constants";
import { isoDate, isAttendanceStatus } from "@/lib/labour/operations";
import { normalizeAadhaar, optionalFormattedAadhaar } from "@/lib/utils/aadhaar";

export type LabourImportRow = {
  sourceRowNumber: number;
  raw: Record<string, string>;
  normalized: Record<string, any>;
};

type ParsedWorkbookRow = {
  rowNumber: number;
  values: string[];
  hyperlinks?: string[];
};

export type LabourAttendanceImportFormat = "monthly_muster" | "transaction";

export type LabourAttendanceImportRow = {
  sourceRowNumber: number;
  sourceColumn?: string;
  raw: Record<string, string>;
  normalized: {
    labour_code: string;
    worker_name: string;
    attendance_date: string;
    attendance_code: string;
    status: string | null;
    overtime_minutes: number;
    remarks: string;
  };
};

const FIELD_ALIASES: Record<string, string[]> = {
  serial_number: ["sr. no.", "sr no", "s no", "serial no", "serial number"],
  labour_code: ["labour code", "worker code"],
  worker_name: ["worker name", "labour name", "labour name *", "employee name", "name"],
  labour_name: ["labour name", "labour name *", "worker name", "name"],
  father_or_husband_name: ["father/husband name", "father / husband name", "father / husband name *", "father husband name", "father name", "husband name"],
  gender: ["gender", "sex"],
  date_of_birth: ["date of birth", "dob", "birth date"],
  contractor_text: ["contractor", "vendor", "contractor name", "vendor name"],
  contractor_name: ["contractor name", "contractor name *", "vendor name", "contractor", "vendor"],
  company_text: ["company", "company name", "company name *"],
  site_text: ["site", "site name", "site name *", "branch", "branch name"],
  mobile_number: ["mobile", "mobile number", "mobile no", "mobile no.", "phone", "phone number", "contact number"],
  alternate_mobile_number: ["alternate mobile", "alternate mobile number", "alternate phone", "emergency contact number"],
  aadhaar_available: ["aadhaar available", "aadhaar available (yes / no)", "aadhar available"],
  aadhaar_number: ["aadhaar", "aadhaar number", "aadhaar no", "aadhaar no.", "aadhaar card number", "aadhaar card no", "aadhaar card no.", "aadhar", "aadhar number", "aadhar no", "aadhar no.", "aadhar card number", "aadhar card no", "adhar no"],
  no_aadhaar_reason: ["no-aadhaar reason", "no aadhaar reason", "aadhaar reason"],
  designation: ["designation", "trade", "trade/skill", "trade / skill", "skill"],
  employment_category: ["labour category", "labour category *", "employment type", "payment category"],
  trade: ["trade", "labour category", "labour category *", "category", "labour trade"],
  trade_name: ["trade name", "category name", "labour category name", "labour category", "labour category *"],
  payment_model: ["payment model", "payment type", "wage model"],
  date_of_joining: ["joining date", "date of joining", "effective date", "effective/ joining date", "effective/joining date", "effective / joining date", "effective / joining date *"],
  effective_from: ["effective date", "site joining date", "effective from", "joining date", "date of joining", "effective/ joining date", "effective/joining date", "effective / joining date", "effective / joining date *"],
  wage_rate: ["daily rate", "daily rate *", "wage rate", "rate"],
  daily_rate: ["daily rate", "daily rate *", "wage rate", "rate"],
  status: ["status", "labour status", "worker status"],
  skill_level: ["skill level", "skill"],
  uan_number: ["uan", "uan number", "pf number", "pf/uan", "pf / uan"],
  esi_number: ["esi", "esic", "esi number", "esic number"],
  bank_account_number: ["bank account", "bank account number", "account number"],
  bank_ifsc: ["ifsc", "ifsc code", "bank ifsc"],
  bank_name: ["bank", "bank name"],
  remarks: ["remarks", "remark", "notes"],
  photo_drive_url: ["labour photo drive link", "labour photo"],
  aadhaar_front_drive_url: ["aadhaar front drive link", "aadhaar front"],
  aadhaar_back_drive_url: ["aadhaar back drive link", "aadhaar back"],
  aadhaar_combined_drive_url: ["combined aadhaar drive link", "combined aadhaar", "combined aadhaar pdf"],
  pan_drive_url: ["pan drive link", "pan card drive link", "pan document drive link", "pan"],
  bank_proof_drive_url: ["bank proof drive link", "bank document drive link", "bank passbook drive link", "bank proof"],
  other_document_drive_url: ["other document drive link", "other labour document drive link", "other document"],
  photo_filename: ["labour photo filename", "photo filename", "labour photo file name", "photo file name"],
  aadhaar_front_filename: ["aadhaar front filename", "aadhaar front file name", "aadhaar front document filename"],
  aadhaar_back_filename: ["aadhaar back filename", "aadhaar back file name", "aadhaar back document filename"],
  aadhaar_combined_filename: ["combined aadhaar pdf filename", "combined aadhaar filename", "combined aadhaar file name", "aadhaar combined filename"],
  pan_filename: ["pan filename", "pan file name", "pan card filename"],
  bank_proof_filename: ["bank proof filename", "bank proof file name", "bank document filename"],
  other_document_filename: ["other document filename", "other labour document filename", "other document file name"],
};

const DOCUMENT_FOLDER_LINK_ALIASES = [
  "Google Drive Document Folder Link",
  "Document Folder Link",
  "Drive Folder Link",
];

export const LABOUR_IMPORT_DOCUMENT_FIELDS = [
  { field: "photo_drive_url", filenameField: "photo_filename", label: "Labour Photo", documentType: "Photo" },
  { field: "aadhaar_front_drive_url", filenameField: "aadhaar_front_filename", label: "Aadhaar Front", documentType: "Aadhaar Front" },
  { field: "aadhaar_back_drive_url", filenameField: "aadhaar_back_filename", label: "Aadhaar Back", documentType: "Aadhaar Back" },
  { field: "aadhaar_combined_drive_url", filenameField: "aadhaar_combined_filename", label: "Combined Aadhaar", documentType: "Aadhaar Card" },
  { field: "pan_drive_url", filenameField: "pan_filename", label: "PAN", documentType: "PAN" },
  { field: "bank_proof_drive_url", filenameField: "bank_proof_filename", label: "Bank Proof", documentType: "Bank Proof" },
  { field: "other_document_drive_url", filenameField: "other_document_filename", label: "Other Document", documentType: "Other" },
] as const;

export const LABOUR_IMPORT_TEMPLATE_COLUMNS = [
  "Labour Name *",
  "Father / Husband Name *",
  "Date of Birth",
  "Mobile Number",
  "Aadhaar Available (Yes / No)",
  "Aadhaar Number",
  "No-Aadhaar Reason",
  "Company Name *",
  "Site Name *",
  "Contractor Name *",
  "Labour Category *",
  "Daily Rate *",
  "Effective / Joining Date *",
  "Labour Photo Drive Link",
  "Aadhaar Front Drive Link",
  "Aadhaar Back Drive Link",
  "Combined Aadhaar Drive Link",
  "PAN Drive Link",
  "Bank Proof Drive Link",
  "Other Document Drive Link",
];

const DOCUMENT_FIELD_PAIRS = [
  ["photo_drive_url", "photo_filename"],
  ["aadhaar_front_drive_url", "aadhaar_front_filename"],
  ["aadhaar_back_drive_url", "aadhaar_back_filename"],
  ["aadhaar_combined_drive_url", "aadhaar_combined_filename"],
  ["pan_drive_url", "pan_filename"],
  ["bank_proof_drive_url", "bank_proof_filename"],
  ["other_document_drive_url", "other_document_filename"],
] as const;

function isLabourDocumentField(field: string) {
  return DOCUMENT_FIELD_PAIRS.some(([driveField, filenameField]) => field === driveField || field === filenameField);
}

function labourFieldForHeader(header: string) {
  const normalized = normalizeHeader(headerBaseName(header));
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.map(normalizeHeader).includes(normalized)) return field;
  }
  return "";
}

export function normalizeLabourImportFilename(value: unknown) {
  return normalizeText(value).toLowerCase();
}

export function labourImportDocumentReferenceValue(...values: unknown[]) {
  for (const value of values) {
    const text = normalizeText(value);
    const key = normalizeLookup(text);
    if (!text) continue;
    if (["-", "--", "NA", "N A", "N/A", "NOT AVAILABLE", "NOT APPLICABLE"].includes(key)) continue;
    return text;
  }
  return "";
}

function isGoogleDriveFileLink(value: unknown) {
  const text = normalizeText(value);
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    const url = new URL(text);
    if (!/(^|\.)drive\.google\.com$/i.test(url.hostname)) return false;
    if (/\/drive\/folders\//i.test(url.pathname)) return false;
    if (/\/file\/d\/[^/]+/i.test(url.pathname)) return true;
    return Boolean(url.searchParams.get("id"));
  } catch {
    return false;
  }
}

function findWorkbookSetting(sheets: { name: string; rows: ParsedWorkbookRow[] }[], aliases: string[]) {
  const normalizedAliases = new Set(aliases.map(normalizeHeader));
  const settingsSheet = sheets.find((sheet) => normalizeHeader(sheet.name) === "IMPORT SETTINGS");
  if (!settingsSheet) return "";
  for (const row of settingsSheet.rows) {
    for (let index = 0; index < row.values.length; index += 1) {
      if (!normalizedAliases.has(normalizeHeader(row.values[index] || ""))) continue;
      const valueIndex = index + 1;
      const hyperlink = normalizeText(row.hyperlinks?.[valueIndex]);
      if (hyperlink) return hyperlink;
      return normalizeText(row.values[valueIndex]);
    }
  }
  return "";
}

function looksLikeLabourImportHeader(values: string[]) {
  const fields = new Set(values.map((value) => labourFieldForHeader(value)).filter(Boolean));
  return fields.has("worker_name") && fields.has("company_text") && fields.has("site_text") && fields.has("contractor_text") && (fields.has("designation") || fields.has("trade") || fields.has("employment_category")) && fields.has("wage_rate");
}

function normalizeHeader(header: string) {
  return normalizeLookup(header).replace(/[^A-Z0-9]+/g, " ").trim();
}

export function normalizeLabourImportMasterLookup(value: unknown) {
  const text = normalizeText(value);
  if (!text) return "";
  return normalizeLookup(text)
    .replace(/\s*\/\s*/g, " / ")
    .replace(/[.,]/g, "")
    .replace(/[()]/g, " ")
    .replace(/\bLTD\b/g, "LIMITED")
    .replace(/\s+/g, " ")
    .trim();
}

function stripParentheticalSuffix(value: string) {
  return normalizeText(value.replace(/\s*\([^)]*\)\s*$/g, ""));
}

export function labourImportMasterLookupKeys(value: unknown, options: { splitCompound?: boolean; stripParenthetical?: boolean } = {}) {
  const text = normalizeText(value);
  if (!text) return [];
  const sources = [text];
  if (options.splitCompound) sources.push(...text.split("/").map((part) => normalizeText(part)));
  if (options.stripParenthetical) sources.push(...sources.map(stripParentheticalSuffix));
  return Array.from(new Set(sources.map(normalizeLabourImportMasterLookup).filter(Boolean)));
}

function findValue(raw: Record<string, string>, aliases: string[]) {
  const normalizedAliases = new Set(aliases.map(normalizeHeader));
  for (const [header, value] of Object.entries(raw)) {
    if (normalizedAliases.has(normalizeHeader(header))) return normalizeText(value);
  }
  return "";
}

function findDisplayName(raw: Record<string, string>, aliases: string[]) {
  const normalizedAliases = new Set(aliases.map(normalizeHeader));
  for (const header of Object.keys(raw)) {
    if (!normalizedAliases.has(normalizeHeader(header))) continue;
    return normalizeText(raw[`${header} Display Name`]);
  }
  return "";
}

export function parseLabourWorkbook(buffer: Buffer) {
  const sheets = parseGenericWorkbook(buffer);
  const documentFolderUrl = findWorkbookSetting(sheets, DOCUMENT_FOLDER_LINK_ALIASES);
  let parsed: { sheetName: string; headers: string[]; rows: { rowNumber: number; raw: Record<string, string> }[] } | null = null;
  for (const sheet of sheets) {
    const headerIndex = sheet.rows.findIndex((row) => looksLikeLabourImportHeader(row.values));
    if (headerIndex === -1) continue;
    const headers = sheet.rows[headerIndex].values.map((value) => normalizeText(value)).filter(Boolean);
    parsed = {
      sheetName: sheet.name,
      headers,
      rows: sheet.rows.slice(headerIndex + 1).map((row) => ({ rowNumber: row.rowNumber, raw: rowObject(headers, row.values, row.hyperlinks) })).filter((row) => Object.values(row.raw).some(Boolean)),
    };
    break;
  }
  if (!parsed) throw new Error("No labour import sheet with recognizable headers was found.");
  const rows: LabourImportRow[] = parsed.rows.map((row) => {
    const normalized: Record<string, any> = {};
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      normalized[field] = findValue(row.raw, aliases);
    }
    normalized.worker_name = normalized.labour_name || normalized.worker_name;
    normalized.contractor_text = normalized.contractor_name || normalized.contractor_text;
    normalized.labour_category = normalized.employment_category || "";
    normalized.trade = normalized.designation || normalized.trade_name || normalized.trade || normalized.employment_category;
    normalized.labour_code = normalizeImportIdentifier(normalized.labour_code);
    normalized.date_of_birth = normalizeDateValue(normalized.date_of_birth);
    normalized.date_of_joining = normalized.effective_from || normalized.date_of_joining;
    normalized.date_of_joining = normalizeDateValue(normalized.date_of_joining);
    normalized.wage_rate = normalized.daily_rate || normalized.wage_rate;
    normalized.mobile_number = normalizeImportIdentifier(normalized.mobile_number, { digitsOnly: true });
    normalized.alternate_mobile_number = normalizeImportIdentifier(normalized.alternate_mobile_number, { digitsOnly: true });
    normalized.uan_number = normalizeImportIdentifier(normalized.uan_number);
    normalized.esi_number = normalizeImportIdentifier(normalized.esi_number);
    normalized.bank_account_number = normalizeImportIdentifier(normalized.bank_account_number);
    normalized.bank_ifsc = normalizeImportIdentifier(normalized.bank_ifsc);
    for (const [driveField, filenameField] of DOCUMENT_FIELD_PAIRS) {
      const displayName = findDisplayName(row.raw, [...(FIELD_ALIASES[driveField] || []), ...(FIELD_ALIASES[filenameField] || [])]);
      if (displayName) normalized[`${driveField}_display_name`] = displayName;
      if (!normalized[driveField] && isGoogleDriveFileLink(normalized[filenameField])) {
        normalized[driveField] = normalized[filenameField];
      }
    }
    normalized.aadhaar_available = normalized.aadhaar_available || (normalized.aadhaar_number ? "yes" : "no");
    const aadhaar = optionalFormattedAadhaar(normalized.aadhaar_number);
    normalized.aadhaar_number = aadhaar.error ? normalizeText(normalized.aadhaar_number) : aadhaar.formatted;
    normalized.worker_type = "contractor_labour";
    return { sourceRowNumber: row.rowNumber, raw: row.raw, normalized };
  }).filter((row) => row.normalized.worker_name || row.normalized.company_text || row.normalized.site_text || row.normalized.aadhaar_number);

  return {
    sheetName: parsed.sheetName,
    headers: parsed.headers,
    documentFolderUrl,
    rows,
  };
}

export function maskAadhaarForImport(value: unknown) {
  const digits = normalizeAadhaar(value);
  return digits.length === 12 ? `**** **** ${digits.slice(-4)}` : "";
}

export function validateLabourImportDailyRate(value: unknown) {
  const next = normalizeText(value);
  if (!next) return "Daily Rate is required.";
  if (!/^\d+$/.test(next)) return "Daily Rate must be a non-negative whole rupee amount.";
  const amount = Number(next);
  return Number.isFinite(amount) && amount >= 0 ? "" : "Daily Rate must be a non-negative whole rupee amount.";
}

function xmlDecode(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
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
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) entries.set(fileName, compressed);
    else if (method === 8) entries.set(fileName, inflateRawSync(compressed, { finishFlush: 2 }));
    else throw new Error(`Unsupported XLSX compression method ${method} for ${fileName}.`);

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function readXml(entries: Map<string, Buffer>, path: string) {
  return entries.get(path)?.toString("utf8") || "";
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
    while ((match = textRegex.exec(item))) parts.push(xmlDecode(match[1] || ""));
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
    if (name && target) sheets.push({ name, path: target.startsWith("xl/") ? target : `xl/${target}` });
  }

  return sheets;
}

function worksheetRelationshipsPath(sheetPath: string) {
  const slash = sheetPath.lastIndexOf("/");
  const directory = slash === -1 ? "" : sheetPath.slice(0, slash + 1);
  const fileName = slash === -1 ? sheetPath : sheetPath.slice(slash + 1);
  return `${directory}_rels/${fileName}.rels`;
}

function columnIndex(cellRef: string) {
  const letters = (cellRef.match(/[A-Z]+/i)?.[0] || "").toUpperCase();
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

function parseWorksheetHyperlinks(xml: string, rels: Map<string, string>) {
  const hyperlinks = new Map<string, string>();
  const regex = /<hyperlink\b([^>]*)\/>/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(xml))) {
    const attrs = match[1] || "";
    const ref = attrs.match(/\bref="([^"]+)"/)?.[1] || "";
    const relId = attrs.match(/\br:id="([^"]+)"/)?.[1] || "";
    const target = relId ? rels.get(relId) : "";
    if (ref && target) hyperlinks.set(ref, xmlDecode(target));
  }

  return hyperlinks;
}

function firstUrl(value: string) {
  return value.match(/https?:\/\/[^\s"',)<]+/i)?.[0] || "";
}

function richText(body: string) {
  const parts: string[] = [];
  const regex = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body))) parts.push(xmlDecode(match[1] || ""));
  return parts.join("");
}

function parseSheetRows(xml: string, sharedStrings: string[], hyperlinks: Map<string, string>) {
  const rows: ParsedWorkbookRow[] = [];
  const rowRegex = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  const cellRegex = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(xml))) {
    const rowAttrs = rowMatch[1] || "";
    const rowNumber = Number(rowAttrs.match(/\br="(\d+)"/)?.[1] || rows.length + 1);
    const cells: string[] = [];
    const cellHyperlinks: string[] = [];
    let cellMatch: RegExpExecArray | null;
    cellRegex.lastIndex = 0;

    while ((cellMatch = cellRegex.exec(rowMatch[2] || ""))) {
      const attrs = cellMatch[1] || cellMatch[2] || "";
      const body = cellMatch[3] || "";
      const ref = attrs.match(/\br="([^"]+)"/)?.[1] || "";
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] || "";
      const index = ref ? columnIndex(ref) : cells.length;
      const value = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const formula = body.match(/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/)?.[1];
      let text = "";

      if (body.includes("<is")) text = richText(body);
      else if (type === "s" && value !== undefined) text = sharedStrings[Number(value)] || "";
      else if (value !== undefined) text = xmlDecode(value);
      if (!firstUrl(text) && formula) text = firstUrl(xmlDecode(formula)) || text;

      cells[index] = String(text || "").trim();
      if (ref && hyperlinks.has(ref)) cellHyperlinks[index] = hyperlinks.get(ref) || "";
    }

    if (cells.some(Boolean) || cellHyperlinks.some(Boolean)) rows.push({ rowNumber, values: cells, hyperlinks: cellHyperlinks });
  }

  return rows;
}

function parseGenericWorkbook(buffer: Buffer) {
  const entries = readZipEntries(buffer);
  const sharedStrings = parseSharedStrings(readXml(entries, "xl/sharedStrings.xml"));
  const rels = parseRelationships(readXml(entries, "xl/_rels/workbook.xml.rels"));
  const sheets = parseWorkbookSheets(readXml(entries, "xl/workbook.xml"), rels);
  return sheets.map((sheet) => ({
    name: sheet.name,
    rows: parseSheetRows(
      readXml(entries, sheet.path),
      sharedStrings,
      parseWorksheetHyperlinks(readXml(entries, sheet.path), parseRelationships(readXml(entries, worksheetRelationshipsPath(sheet.path))))
    ),
  }));
}

function excelSerialToDate(value: unknown) {
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial < 1 || serial > 60000) return null;
  const date = new Date(Date.UTC(1899, 11, 30));
  date.setUTCDate(date.getUTCDate() + Math.floor(serial));
  return date.toISOString().slice(0, 10);
}

const MONTHS: Record<string, string> = {
  JAN: "01",
  JANUARY: "01",
  FEB: "02",
  FEBRUARY: "02",
  MAR: "03",
  MARCH: "03",
  APR: "04",
  APRIL: "04",
  MAY: "05",
  JUN: "06",
  JUNE: "06",
  JUL: "07",
  JULY: "07",
  AUG: "08",
  AUGUST: "08",
  SEP: "09",
  SEPT: "09",
  SEPTEMBER: "09",
  OCT: "10",
  OCTOBER: "10",
  NOV: "11",
  NOVEMBER: "11",
  DEC: "12",
  DECEMBER: "12",
};

function normalizeDateValue(value: unknown) {
  const text = normalizeText(value);
  if (!text) return "";
  if (isoDate(text)) return text;
  const serial = excelSerialToDate(text);
  if (serial) return serial;
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  const namedMonth = text.replace(/,/g, "").match(/^(\d{1,2})[\s.-]+([A-Za-z]{3,9})[\s.-]+(\d{4})$/);
  if (namedMonth) {
    const month = MONTHS[namedMonth[2].toUpperCase()];
    if (month) return `${namedMonth[3]}-${month}-${namedMonth[1].padStart(2, "0")}`;
  }
  return "";
}

function normalizeImportIdentifier(value: unknown, options: { digitsOnly?: boolean } = {}) {
  const text = normalizeText(value);
  if (!text) return "";
  const compact = text.replace(/[\s-]+/g, "").toUpperCase();
  if (["0", "0.0", "0.00", "NA", "N/A", "NIL", "NONE", "NULL", "NOTAVAILABLE", "NOTAPPLICABLE"].includes(compact)) return "";
  if (/^\d+\.0+$/.test(compact)) return compact.replace(/\.0+$/, "");
  if (/^\d+(?:\.\d+)?E\+\d+$/i.test(compact)) {
    const expanded = Number(compact).toFixed(0);
    if (/^\d+$/.test(expanded)) return expanded;
  }
  return options.digitsOnly ? compact.replace(/\D/g, "") : compact;
}

const ATTENDANCE_CODES: Record<string, string> = {
  P: "present",
  PRESENT: "present",
  A: "absent",
  ABSENT: "absent",
  HD: "half_day",
  "HALF DAY": "half_day",
  HALF_DAY: "half_day",
  WO: "weekly_off",
  "WEEKLY OFF": "weekly_off",
  H: "holiday",
  HOLIDAY: "holiday",
  L: "leave",
  LEAVE: "leave",
  ND: "not_deployed",
  "NOT DEPLOYED": "not_deployed",
};

export function normalizeAttendanceStatus(value: unknown) {
  const text = normalizeLookup(value).replace(/\s+/g, " ");
  if (!text) return null;
  const mapped = ATTENDANCE_CODES[text] || text.toLowerCase();
  return isAttendanceStatus(mapped) ? mapped : null;
}

function rowObject(headers: string[], values: string[], hyperlinks: string[] = []) {
  const raw: Record<string, string> = {};
  headers.forEach((header, index) => {
    if (!header) return;
    let outputHeader = header;
    let suffix = 2;
    while (Object.prototype.hasOwnProperty.call(raw, outputHeader)) {
      outputHeader = `${header} (${suffix})`;
      suffix += 1;
    }
    const visibleText = normalizeText(values[index]);
    const hyperlink = normalizeText(hyperlinks[index]);
    const field = labourFieldForHeader(header);
    if (hyperlink && isLabourDocumentField(field)) {
      raw[outputHeader] = hyperlink;
      raw[`${outputHeader} Display Name`] = visibleText;
      return;
    }
    raw[outputHeader] = visibleText;
  });
  return raw;
}

function headerHas(headers: string[], aliases: string[]) {
  const normalized = headers.map(normalizeHeader);
  return aliases.some((alias) => normalized.includes(normalizeHeader(alias)));
}

function valueByAliases(raw: Record<string, string>, aliases: string[]) {
  return findValue(raw, aliases);
}

function looksLikeTransactionHeaders(headers: string[]) {
  return (
    (headerHas(headers, ["labour code", "worker code", "worker", "worker name"]) &&
      headerHas(headers, ["date", "attendance date"]) &&
      headerHas(headers, ["status", "attendance", "attendance status"]))
  );
}

function looksLikeMusterHeaders(headers: string[]) {
  const normalized = headers.map(normalizeHeader);
  const dayHeaders = normalized.filter((header) => /^(?:[1-9]|[12][0-9]|3[01])$/.test(header));
  return dayHeaders.length >= 2 && headerHas(headers, ["labour code", "worker code", "worker", "worker name"]);
}

export function parseLabourAttendanceWorkbook(buffer: Buffer) {
  const sheets = parseGenericWorkbook(buffer);

  for (const sheet of sheets) {
    const headerRowIndex = sheet.rows.findIndex((row) => {
      const headers = row.values.map((value) => normalizeText(value));
      return looksLikeTransactionHeaders(headers) || looksLikeMusterHeaders(headers);
    });
    if (headerRowIndex === -1) continue;

    const headers = sheet.rows[headerRowIndex].values.map((value) => normalizeText(value));
    const format: LabourAttendanceImportFormat = looksLikeTransactionHeaders(headers) ? "transaction" : "monthly_muster";
    const rows: LabourAttendanceImportRow[] = [];

    for (const sourceRow of sheet.rows.slice(headerRowIndex + 1)) {
      const raw = rowObject(headers, sourceRow.values);
      const labourCode = valueByAliases(raw, ["labour code", "worker code", "employee code", "code"]);
      const workerName = valueByAliases(raw, ["worker name", "labour name", "worker", "name"]);

      if (format === "transaction") {
        const attendanceDate = normalizeDateValue(valueByAliases(raw, ["date", "attendance date"]));
        const attendanceCode = valueByAliases(raw, ["status", "attendance", "attendance status"]);
        const status = normalizeAttendanceStatus(attendanceCode);
        const overtimeHours = Number(valueByAliases(raw, ["overtime hours", "ot hours", "ot"]) || 0);
        if (!labourCode && !workerName && !attendanceDate && !attendanceCode) continue;
        rows.push({
          sourceRowNumber: sourceRow.rowNumber,
          raw,
          normalized: {
            labour_code: labourCode,
            worker_name: workerName,
            attendance_date: attendanceDate,
            attendance_code: attendanceCode,
            status,
            overtime_minutes: Number.isFinite(overtimeHours) ? Math.max(0, Math.round(overtimeHours * 60)) : 0,
            remarks: valueByAliases(raw, ["remarks", "remark", "notes"]),
          },
        });
        continue;
      }

      const yearMonth = valueByAliases(raw, ["month", "period month", "attendance month"]);
      const normalizedHeaders = headers.map(normalizeHeader);
      for (const [index, header] of normalizedHeaders.entries()) {
        if (!/^(?:[1-9]|[12][0-9]|3[01])$/.test(header)) continue;
        const attendanceCode = normalizeText(sourceRow.values[index]);
        if (!attendanceCode) continue;
        const day = header.padStart(2, "0");
        const baseMonth = normalizeDateValue(yearMonth).slice(0, 7);
        rows.push({
          sourceRowNumber: sourceRow.rowNumber,
          sourceColumn: headers[index],
          raw,
          normalized: {
            labour_code: labourCode,
            worker_name: workerName,
            attendance_date: baseMonth ? `${baseMonth}-${day}` : "",
            attendance_code: attendanceCode,
            status: normalizeAttendanceStatus(attendanceCode),
            overtime_minutes: 0,
            remarks: valueByAliases(raw, ["remarks", "remark", "notes"]),
          },
        });
      }
    }

    return { sheetName: sheet.name, headers: headers.filter(Boolean), format, rows };
  }

  throw new Error("No labour attendance sheet with recognizable headers was found.");
}

export function fileHash(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function normalizedPersonKey(row: Record<string, any>, siteId?: string | null, contractorId?: string | null) {
  return [
    normalizeLookup(row.worker_name),
    normalizeLookup(row.father_or_husband_name),
    siteId || "",
    contractorId || "",
  ].join("|");
}
