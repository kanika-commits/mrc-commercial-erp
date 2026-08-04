import { createHash } from "crypto";
import { inflateRawSync } from "zlib";

export const HR_EMPLOYEE_DOCUMENT_IMPORT_MODULE = "hr_employee_document_import";

export const DOCUMENT_IMPORT_ACTIONS = ["pending", "skip", "new_version"] as const;

export const DOCUMENT_IMPORT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

export const MAX_DOCUMENT_IMPORT_FILE_SIZE = 10 * 1024 * 1024;

export type DocumentColumnMapping = {
  documentType: string;
  metadata?: Record<string, string>;
};

export type ParsedDocumentWorkbookRow = {
  sheetName: string;
  rowNumber: number;
  raw: Record<string, string>;
  hyperlinks: Record<string, string[]>;
};

export type ParsedDocumentWorkbook = {
  sheets: string[];
  selectedSheet: string;
  headers: string[];
  rows: ParsedDocumentWorkbookRow[];
};

export const DEFAULT_DOCUMENT_COLUMN_MAPPINGS: Record<string, DocumentColumnMapping> = {
  "aadhaar card link": { documentType: "Aadhaar Card" },
  "pan card link": { documentType: "PAN Card" },
  "bank link": { documentType: "Bank Proof" },
  "post graduation": { documentType: "Educational Certificate", metadata: { qualification: "Post Graduation" } },
  "graduation": { documentType: "Educational Certificate", metadata: { qualification: "Graduation" } },
  "12th": { documentType: "Educational Certificate", metadata: { qualification: "12th" } },
  "10th": { documentType: "Educational Certificate", metadata: { qualification: "10th" } },
  "8th": { documentType: "Educational Certificate", metadata: { qualification: "8th" } },
  "training courses": { documentType: "Professional Certificate" },
  "diploma certificate": { documentType: "Educational Certificate", metadata: { qualification: "Diploma" } },
  "driving licence": { documentType: "Driving Licence" },
  "driving license": { documentType: "Driving Licence" },
  "experience certificates": { documentType: "Experience Letter" },
  "experience certificate": { documentType: "Experience Letter" },
  "resume": { documentType: "Resume" },
  "voter card": { documentType: "Voter ID" },
  "qualification certificate": { documentType: "Educational Certificate" },
};

export const EMPLOYEE_DOCUMENT_IMPORT_TYPES = new Set([
  "Aadhaar Card",
  "PAN Card",
  "Bank Proof",
  "Educational Certificate",
  "Professional Certificate",
  "Driving Licence",
  "Experience Letter",
  "Resume",
  "Voter ID",
]);

const XML_NS_RELATIONSHIP = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function xmlDecode(value: string) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function readUInt32(buffer: Buffer, offset: number) {
  return buffer.readUInt32LE(offset);
}

function readUInt16(buffer: Buffer, offset: number) {
  return buffer.readUInt16LE(offset);
}

function readZipEntries(buffer: Buffer) {
  const entries = new Map<string, Buffer>();

  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (readUInt32(buffer, offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset < 0) {
    throw new Error("Invalid XLSX file: ZIP directory was not found.");
  }

  const centralDirectorySize = readUInt32(buffer, eocdOffset + 12);
  const centralDirectoryOffset = readUInt32(buffer, eocdOffset + 16);
  let offset = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;

  while (offset < end && readUInt32(buffer, offset) === 0x02014b50) {
    const method = readUInt16(buffer, offset + 10);
    const compressedSize = readUInt32(buffer, offset + 20);
    const fileNameLength = readUInt16(buffer, offset + 28);
    const extraLength = readUInt16(buffer, offset + 30);
    const commentLength = readUInt16(buffer, offset + 32);
    const localHeaderOffset = readUInt32(buffer, offset + 42);
    const fileName = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString();

    const localFileNameLength = readUInt16(buffer, localHeaderOffset + 26);
    const localExtraLength = readUInt16(buffer, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    const compressed = buffer.slice(dataStart, dataEnd);
    const data = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : Buffer.alloc(0);

    entries.set(fileName.replace(/^\/+/, ""), data);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function readXml(entries: Map<string, Buffer>, path: string) {
  return entries.get(path)?.toString("utf8") || "";
}

function parseRelationships(xml: string) {
  const relationships: Record<string, { target: string; type: string; targetMode?: string }> = {};
  const relRegex = /<Relationship\b([^>]*)\/>/g;
  let match: RegExpExecArray | null;

  while ((match = relRegex.exec(xml))) {
    const attrs = match[1] || "";
    const id = attrs.match(/\bId="([^"]+)"/)?.[1];
    const target = attrs.match(/\bTarget="([^"]+)"/)?.[1] || "";
    const type = attrs.match(/\bType="([^"]+)"/)?.[1] || "";
    const targetMode = attrs.match(/\bTargetMode="([^"]+)"/)?.[1];
    if (id) relationships[id] = { target: xmlDecode(target), type, targetMode };
  }

  return relationships;
}

function parseWorkbookSheets(xml: string, rels: Record<string, { target: string }>) {
  const sheets: Array<{ name: string; path: string }> = [];
  const sheetRegex = /<sheet\b([^>]*)\/>/g;
  let match: RegExpExecArray | null;

  while ((match = sheetRegex.exec(xml))) {
    const attrs = match[1] || "";
    const name = attrs.match(/\bname="([^"]+)"/)?.[1] || "";
    const relId = attrs.match(new RegExp(`(?:r:id|\\{${XML_NS_RELATIONSHIP}\\}id)="([^"]+)"`))?.[1] || attrs.match(/\br:id="([^"]+)"/)?.[1];
    const target = relId ? rels[relId]?.target : "";
    if (!target) continue;
    sheets.push({
      name: xmlDecode(name),
      path: target.startsWith("xl/") ? target : `xl/${target.replace(/^\/+/, "")}`,
    });
  }

  return sheets;
}

function parseSharedStrings(xml: string) {
  const strings: string[] = [];
  const siRegex = /<si\b[\s\S]*?<\/si>/g;
  let match: RegExpExecArray | null;

  while ((match = siRegex.exec(xml))) {
    const text = Array.from(match[0].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g))
      .map((part) => xmlDecode(part[1] || ""))
      .join("");
    strings.push(text);
  }

  return strings;
}

function columnIndex(cellRef: string) {
  const letters = (cellRef.match(/[A-Z]+/i)?.[0] || "").toUpperCase();
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return Math.max(0, index - 1);
}

function normalizeHeader(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function looksLikeHeader(values: string[]) {
  const normalized = values.map(normalizeHeader);
  const hasEmployeeCode = normalized.some((value) => ["emp id", "employee id", "employee code"].includes(value));
  const hasEmployeeName = normalized.some((value) => ["name of employee", "employee name", "name"].includes(value));
  const hasFatherName = normalized.some((value) => [
    "father's name",
    "father name",
    "father",
    "father/husband name",
    "father / husband name",
    "father husband name",
  ].includes(value));
  const hasSite = normalized.some((value) => value === "site");
  const hasDocumentColumn = normalized.some((value) => Boolean(DEFAULT_DOCUMENT_COLUMN_MAPPINGS[value]));

  return hasSite && hasEmployeeName && (hasEmployeeCode || (hasFatherName && hasDocumentColumn));
}

function parseSheetHyperlinks(sheetXml: string, rels: Record<string, { target: string }>) {
  const hyperlinks: Record<string, string[]> = {};
  const hyperlinkRegex = /<hyperlink\b([^>]*)\/>/g;
  let match: RegExpExecArray | null;

  while ((match = hyperlinkRegex.exec(sheetXml))) {
    const attrs = match[1] || "";
    const ref = attrs.match(/\bref="([^"]+)"/)?.[1] || "";
    const relId = attrs.match(/\br:id="([^"]+)"/)?.[1] || "";
    const location = attrs.match(/\blocation="([^"]+)"/)?.[1] || "";
    const target = relId ? rels[relId]?.target : location;
    if (!ref || !target) continue;
    hyperlinks[ref] = [...(hyperlinks[ref] || []), xmlDecode(target)];
  }

  return hyperlinks;
}

function parseSheetRows(sheetXml: string, sharedStrings: string[], hyperlinksByCell: Record<string, string[]>) {
  const rows: Array<{ rowNumber: number; values: string[]; hyperlinks: Record<number, string[]> }> = [];
  const rowRegex = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(sheetXml))) {
    const rowNumber = Number(rowMatch[1].match(/\br="(\d+)"/)?.[1] || rows.length + 1);
    const values: string[] = [];
    const hyperlinks: Record<number, string[]> = {};
    let cellMatch: RegExpExecArray | null;
    cellRegex.lastIndex = 0;

    while ((cellMatch = cellRegex.exec(rowMatch[2] || ""))) {
      const attrs = cellMatch[1] || "";
      const body = cellMatch[2] || "";
      const ref = attrs.match(/\br="([^"]+)"/)?.[1] || "";
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] || "";
      const index = ref ? columnIndex(ref) : values.length;
      const inlineText = body.match(/<is\b[\s\S]*?<t(?:\s[^>]*)?>([\s\S]*?)<\/t>[\s\S]*?<\/is>/)?.[1];
      const value = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let text = "";

      if (inlineText !== undefined) text = xmlDecode(inlineText);
      else if (type === "s" && value !== undefined) text = sharedStrings[Number(value)] || "";
      else if (value !== undefined) text = xmlDecode(value);

      values[index] = String(text || "").trim();
      if (ref && hyperlinksByCell[ref]?.length) hyperlinks[index] = hyperlinksByCell[ref];
    }

    for (const [ref, targets] of Object.entries(hyperlinksByCell)) {
      const rowRef = Number(ref.match(/\d+/)?.[0] || 0);
      if (rowRef !== rowNumber || !targets.length) continue;
      const index = columnIndex(ref);
      hyperlinks[index] = Array.from(new Set([...(hyperlinks[index] || []), ...targets]));
      values[index] = values[index] || "";
    }

    if (values.some(Boolean) || Object.keys(hyperlinks).length > 0) rows.push({ rowNumber, values, hyperlinks });
  }

  return rows;
}

export function workbookHash(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function extractGoogleDriveFileId(value: string) {
  const text = String(value || "").trim();
  if (!text) return "";

  try {
    const url = new URL(text);
    const host = url.hostname.toLowerCase();
    if (!host.endsWith("google.com") && !host.endsWith("googleusercontent.com")) return "";
    const pathMatch = url.pathname.match(/\/(?:file\/d|document\/d|spreadsheets\/d|presentation\/d)\/([^/?#]+)/i);
    const id = pathMatch?.[1] || url.searchParams.get("id") || "";
    return /^[a-zA-Z0-9_-]{10,}$/.test(id) ? id : "";
  } catch {
    const pathMatch = text.match(/(?:file\/d\/|[?&]id=)([a-zA-Z0-9_-]{10,})/);
    return pathMatch?.[1] || "";
  }
}

export function extractDriveUrls(value: unknown, hyperlinkTargets: string[] = []) {
  const text = String(value || "");
  const urlMatches = text.match(/https?:\/\/[^\s,;]+/g) || [];
  return Array.from(
    new Set(
      [...urlMatches, ...hyperlinkTargets]
        .map((url) => String(url || "").trim().replace(/[)\].,;]+$/, ""))
        .filter((url) => extractGoogleDriveFileId(url)),
    ),
  );
}

export function documentMappingForColumn(column: string, overrides?: Record<string, DocumentColumnMapping>) {
  const key = normalizeHeader(column);
  return overrides?.[key] || DEFAULT_DOCUMENT_COLUMN_MAPPINGS[key] || null;
}

export function parseEmployeeDocumentWorkbook(buffer: Buffer, selectedSheet?: string | null): ParsedDocumentWorkbook {
  const entries = readZipEntries(buffer);
  const sharedStrings = parseSharedStrings(readXml(entries, "xl/sharedStrings.xml"));
  const workbookRels = parseRelationships(readXml(entries, "xl/_rels/workbook.xml.rels"));
  const sheets = parseWorkbookSheets(readXml(entries, "xl/workbook.xml"), workbookRels);
  const chosenSheets = selectedSheet ? sheets.filter((sheet) => sheet.name === selectedSheet) : sheets;

  for (const sheet of chosenSheets) {
    const sheetXml = readXml(entries, sheet.path);
    const relPath = sheet.path.replace(/worksheets\/([^/]+)$/, "worksheets/_rels/$1.rels");
    const sheetRels = parseRelationships(readXml(entries, relPath));
    const sheetRows = parseSheetRows(sheetXml, sharedStrings, parseSheetHyperlinks(sheetXml, sheetRels));
    const headerRowIndex = sheetRows.findIndex((row) => looksLikeHeader(row.values));
    if (headerRowIndex === -1) continue;

    const headers = sheetRows[headerRowIndex].values.map((value) => String(value || "").trim());
    const rows = sheetRows
      .slice(headerRowIndex + 1)
      .map((row) => {
        const raw: Record<string, string> = {};
        const hyperlinks: Record<string, string[]> = {};
        headers.forEach((header, index) => {
          if (!header) return;
          raw[header] = String(row.values[index] || "").trim();
          if (row.hyperlinks[index]?.length) hyperlinks[header] = row.hyperlinks[index];
        });
        return { sheetName: sheet.name, rowNumber: row.rowNumber, raw, hyperlinks };
      })
      .filter((row) => Object.values(row.raw).some(Boolean) || Object.keys(row.hyperlinks).length > 0);

    return {
      sheets: sheets.map((item) => item.name),
      selectedSheet: sheet.name,
      headers: headers.filter(Boolean),
      rows,
    };
  }

  throw new Error("No employee document sheet with recognizable headers was found.");
}

export function normalizeEmployeeCode(value: unknown) {
  return String(value || "").trim().replace(/\.0$/, "");
}

export function normalizeText(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function summarizeDocumentImportRows(rows: Array<{ validation_status?: string; execution_status?: string }>) {
  return rows.reduce(
    (summary, row) => {
      summary.total += 1;
      if (row.validation_status === "invalid") summary.invalid += 1;
      else if (row.validation_status === "warning") summary.warning += 1;
      else if (row.validation_status === "ready") summary.ready += 1;
      if (row.execution_status === "imported") summary.imported += 1;
      if (row.execution_status === "skipped") summary.skipped += 1;
      if (row.execution_status === "failed") summary.failed += 1;
      return summary;
    },
    { total: 0, ready: 0, warning: 0, invalid: 0, imported: 0, skipped: 0, failed: 0 },
  );
}
