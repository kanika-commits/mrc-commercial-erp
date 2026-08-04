import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";
import { createRequire } from "node:module";

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
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
  if (request.startsWith("@/")) request = path.join(root, request.slice(2));
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
  labourImportMasterLookupKeys,
  normalizeLabourImportMasterLookup,
  parseLabourWorkbook,
} = require("../lib/labour/import.ts");

function cell(ref, value) {
  return `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
}

function workbook(headers, values) {
  const headerXml = headers.map((header, index) => cell(`${String.fromCharCode(65 + index)}1`, header)).join("");
  const valueXml = values.map((value, index) => cell(`${String.fromCharCode(65 + index)}2`, value)).join("");
  return createStoredZip({
    "xl/workbook.xml": `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Labour Import" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1">${headerXml}</row><row r="2">${valueXml}</row></sheetData></worksheet>`,
  });
}

function sparseWorkbook(headerCells, rowCells) {
  const headerXml = headerCells.map(({ ref, value }) => cell(ref, value)).join("");
  const rowXml = rowCells.map(({ ref, value, type = "inlineStr", selfClosing = false }) => {
    if (selfClosing) return `<c r="${ref}" s="27"/>`;
    if (type === "s") return `<c r="${ref}" t="s"><v>${value}</v></c>`;
    if (type === "n") return `<c r="${ref}"><v>${value}</v></c>`;
    return cell(ref, value);
  }).join("");
  return createStoredZip({
    "xl/workbook.xml": `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Labour Import" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst><si><t>673120582210</t></si><si><t>MRC INFRACON LIMITED</t></si></sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1">${headerXml}</row><row r="2">${rowXml}</row></sheetData></worksheet>`,
  });
}

const parsed = parseLabourWorkbook(workbook(
  [
    "Labour Name *",
    "Father / Husband Name *",
    "Father / Husband Name *",
    "Company Name *",
    "Site Name *",
    "Contractor Name *",
    "Labour Category *",
    "Daily Rate *",
    "Effective / Joining Date *",
  ],
  [
    "Aasiya Khatoon",
    "Father One",
    "Father Two",
    "MRC INFRACON LIMITED",
    "BALANCE WORK OF CONSTRUCTION OF HEADQUARTER BUILDING",
    "NITU  CONTRACTOR / NITU CONTRACTOR ( SALARY )",
    "SALARY",
    "650",
    "2026-07-31",
  ],
));

const row = parsed.rows[0];
assert.equal(row.normalized.company_text, "MRC INFRACON LIMITED", "duplicate Father/Husband headers must not erase Company Name");
assert.equal(row.normalized.contractor_text, "NITU CONTRACTOR / NITU CONTRACTOR ( SALARY )", "duplicate Father/Husband headers must not erase Contractor Name");
assert.equal(row.normalized.labour_category, "SALARY", "Labour Category remains parsed from the workbook category column");
assert.equal(row.normalized.wage_rate, "650", "Daily Rate remains parsed after duplicate headers");
assert.equal(row.raw["Father / Husband Name *"], "Father One", "first duplicate Father/Husband column is preserved");
assert.equal(row.raw["Father / Husband Name * (2)"], "Father Two", "second duplicate Father/Husband column is preserved with a stable suffix");

const gudduStyle = parseLabourWorkbook(sparseWorkbook(
  [
    { ref: "A1", value: "Sr. No." },
    { ref: "B1", value: "EMPLOYEE CODE" },
    { ref: "C1", value: "Labour Name *" },
    { ref: "D1", value: "Father / Husband Name *" },
    { ref: "E1", value: "Father / Husband Name *" },
    { ref: "F1", value: "Designation" },
    { ref: "G1", value: "Date of Birth" },
    { ref: "H1", value: "Mobile Number" },
    { ref: "I1", value: "Aadhaar Available (Yes / No)" },
    { ref: "J1", value: "Aadhaar Number" },
    { ref: "K1", value: "No-Aadhaar Reason" },
    { ref: "L1", value: "Company Name *" },
    { ref: "M1", value: "Site Name *" },
    { ref: "N1", value: "Contractor Name *" },
    { ref: "O1", value: "Labour Category *" },
    { ref: "P1", value: "Daily Rate *" },
    { ref: "Q1", value: "Effective / Joining Date *" },
  ],
  [
    { ref: "A2", value: "15", type: "n" },
    { ref: "B2", value: "MRC1210" },
    { ref: "C2", value: "GUDDU KUMAR" },
    { ref: "D2", value: "MAHENDRA GANJHU" },
    { ref: "E2", value: "Mahendra Ganjhu" },
    { ref: "F2", value: "LABOUR" },
    { ref: "G2", value: "39061", type: "n" },
    { ref: "H2", value: "7851932301", type: "n" },
    { ref: "I2", value: "", selfClosing: true },
    { ref: "J2", value: "0", type: "s" },
    { ref: "K2", value: "", selfClosing: true },
    { ref: "L2", value: "1", type: "s" },
    { ref: "M2", value: "BALANCE WORK OF CONSTRUCTION OF HEADQUARTER BUILDING" },
    { ref: "N2", value: "NITU  CONTRACTOR / NITU CONTRACTOR ( SALARY )" },
    { ref: "O2", value: "SALARY" },
    { ref: "P2", value: "650.0", type: "n" },
    { ref: "Q2", value: "46058.0", type: "n" },
    { ref: "R2", value: "", selfClosing: true },
    { ref: "S2", value: "", selfClosing: true },
    { ref: "T2", value: "", selfClosing: true },
  ],
));

const gudduRow = gudduStyle.rows[0];
assert.equal(gudduRow.raw["Aadhaar Available (Yes / No)"], "", "self-closing Aadhaar Available cell remains blank");
assert.equal(gudduRow.raw["Aadhaar Number"], "673120582210", "populated cell after a self-closing blank remains in Aadhaar Number");
assert.equal(gudduRow.raw["No-Aadhaar Reason"], "", "second self-closing blank remains in No-Aadhaar Reason");
assert.equal(gudduRow.raw["Company Name *"], "MRC INFRACON LIMITED", "populated Company cell after a self-closing blank remains in Company Name");
assert.equal(gudduRow.normalized.company_text, "MRC INFRACON LIMITED", "Guddu-style row keeps Company in normalized data");
assert.equal(gudduRow.normalized.aadhaar_number, "6731-2058-2210", "Guddu-style row keeps formatted Aadhaar in normalized data");
assert.equal(gudduRow.normalized.site_text, "BALANCE WORK OF CONSTRUCTION OF HEADQUARTER BUILDING", "Guddu-style row keeps Site aligned");
assert.equal(gudduRow.normalized.contractor_text, "NITU CONTRACTOR / NITU CONTRACTOR ( SALARY )", "Guddu-style row keeps Contractor aligned");
assert.equal(gudduRow.normalized.labour_category, "SALARY", "Guddu-style row keeps Category aligned");
assert.equal(gudduRow.normalized.wage_rate, "650.0", "Guddu-style row keeps Daily Rate aligned");
assert.equal(gudduRow.raw["Father / Husband Name *"], "MAHENDRA GANJHU", "duplicate Father/Husband first value remains available in sparse row");
assert.equal(gudduRow.raw["Father / Husband Name * (2)"], "Mahendra Ganjhu", "duplicate Father/Husband second value remains suffixed in sparse row");

const companyKeys = labourImportMasterLookupKeys("MRC INFRACON LIMITED");
assert.ok(companyKeys.includes(normalizeLabourImportMasterLookup("MRC Infracon Limited.")), "uppercase company text must match trailing punctuation differences");
assert.ok(companyKeys.includes(normalizeLabourImportMasterLookup("MRC Infracon Ltd.")), "company Ltd. abbreviation must normalize to Limited");

const contractorKeys = labourImportMasterLookupKeys("NITU  CONTRACTOR / NITU CONTRACTOR ( SALARY )", { splitCompound: true, stripParenthetical: true });
assert.ok(contractorKeys.includes(normalizeLabourImportMasterLookup("NITU CONTRACTOR")), "combined contractor label must match the vendor/profile display name");
assert.ok(contractorKeys.includes(normalizeLabourImportMasterLookup("NITU CONTRACTOR (SALARY)")), "spaces around parenthetical contractor suffix must normalize deterministically");

const validateSource = fs.readFileSync(new URL("../app/api/labour/import/validate/route.ts", import.meta.url), "utf8");
assert.ok(validateSource.includes('error: `${label} "${rawSource}" was not found.`'), "present unmatched master text reports not-found, not required");
assert.match(validateSource, /Labour Contractor/, "contractor validation keeps the Labour Contractor field label");
assert.match(validateSource, /labourImportMasterLookupKeys\(rawSource, masterLookupOptions\(group\)\)/, "validation resolves masters through deterministic lookup keys");
assert.match(validateSource, /effectiveAadhaarAvailability\.value === "yes" && !hasAadhaarFrontBack && !hasCombinedAadhaar[\s\S]+warnings\.push\("Aadhaar document not uploaded\. Upload later to complete verification\."\)/, "valid Aadhaar rows without documents remain importable with a warning");
assert.doesNotMatch(validateSource, /errors\.push\("Aadhaar Available is Yes; provide matched Aadhaar Front and Back documents/, "missing Aadhaar documents are not blocking validation errors");

const executeSource = fs.readFileSync(new URL("../app/api/labour/import/execute/route.ts", import.meta.url), "utf8");
const registerSource = fs.readFileSync(new URL("../app/api/labour/workers/register/route.ts", import.meta.url), "utf8");
const previewSource = fs.readFileSync(new URL("../app/api/labour/import/preview/route.ts", import.meta.url), "utf8");
const importPageSource = fs.readFileSync(new URL("../app/labour/workers/import/page.tsx", import.meta.url), "utf8");
const sharedSource = fs.readFileSync(new URL("../app/api/labour/_shared.ts", import.meta.url), "utf8");
assert.match(executeSource, /work_order_id:\s*n\.work_order_id \|\| undefined/, "Labour Import execution forwards only the selected optional Work Order");
assert.doesNotMatch(registerSource, /if \(!workOrderId\) return jsonError\("Labour Work Order is required\."\)/, "Labour Import can reuse registration without Work Order");
assert.match(registerSource, /const workOrderCheck = workOrderId[\s\S]+validateLabourWorkOrderForContractor/, "selected Labour Work Orders remain strictly validated");
assert.match(previewSource, /from\("work_order_vendors"\)\.select\("work_order_id, vendor_id"\)/, "Labour Import preview loads Work Order vendor links");
assert.match(previewSource, /work_orders"\)\s*[\s\S]+wo_number, wo_type/, "Labour Import preview loads Work Order numbers and types");
assert.doesNotMatch(previewSource, /\.eq\("wo_type", "Daily Wage"\)/, "Labour Import preview lists all eligible linked Work Orders");
assert.match(validateSource, /const WORK_ORDER_MAPPING_KEY = "__work_order_mappings"/, "Labour Import stores Work Order mappings separately from ERP master mappings");
assert.match(validateSource, /\$\{vendorId\}:\$\{siteId\}/, "Labour Import Work Order mapping key uses vendor_id plus site_id");
assert.match(validateSource, /matched_work_order_id:\s*mappedWorkOrderId \|\| null/, "Labour Import validation persists the selected Work Order ID on the row");
assert.match(validateSource, /work_order_id:\s*mappedWorkOrderId \|\| null/, "Labour Import normalized data carries selected Work Order ID into execution");
assert.match(validateSource, /matchedWorkOrder\.company_id !== companyId/, "Labour Import validation rejects Work Orders from a different selected Company");
assert.doesNotMatch(validateSource, /matchedWorkOrder\.wo_type !== "Daily Wage"/, "Labour Import validation no longer rejects non-Daily-Wage mapped Work Orders");
assert.match(validateSource, /commercialModel = matchedWorkOrder\?\.wo_type === "Daily Wage" \? "daily_wage" : "contract_basis"/, "Labour Import derives payment model from mapped Work Order type");
assert.match(validateSource, /const rateError = requiresDailyRate \? validateLabourImportDailyRate\(normalized\.wage_rate\) : ""/, "Labour Import requires Daily Rate only for Daily Wage Work Orders");
assert.doesNotMatch(sharedSource, /workOrder\.wo_type !== "Daily Wage"/, "Selected Labour Import Work Orders are no longer restricted to Daily Wage");
assert.match(sharedSource, /workOrder\.company_id !== input\.companyId/, "Selected Work Orders remain company-scoped");
assert.match(sharedSource, /workOrder\.site_id !== input\.siteId/, "Selected Work Orders remain site-scoped");
assert.match(sharedSource, /from\("work_order_vendors"\)[\s\S]+\.eq\("vendor_id", contractor\.vendor_id\)/, "Selected Work Orders remain vendor-linked");
assert.match(importPageSource, /const WORK_ORDER_MAPPING_KEY = "__work_order_mappings"/, "Labour Import UI tracks Work Order mappings separately");
assert.match(importPageSource, /Work Order \(Optional\)/, "Labour Import mapping UI labels the Work Order selector as optional");
assert.match(importPageSource, /<option value="">No Work Order<\/option>/, "Labour Import Work Order mapping uses a neutral blank Work Order option");
assert.doesNotMatch(importPageSource, /<option value="">Contractual Labour<\/option>/, "Labour Import Work Order dropdown does not include Contractual Labour as a pseudo Work Order");
assert.match(importPageSource, /pair\.options\.length === 1[\s\S]+pair\.options\[0\]\.id/, "Labour Import auto-maps a single unambiguous Work Order");
assert.match(importPageSource, /vendor_id === contractor\.id && option\.site_id === site\.id/, "Labour Import UI filters Work Orders by mapped contractor vendor and mapped site");
assert.match(importPageSource, /n\.work_order_name \|\| "No Work Order"/, "Labour Import preview shows No Work Order when no Work Order is mapped");

console.log("Labour import unified rules tests passed.");
