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
const { parseLabourWorkbook } = require("../lib/labour/import.ts");

const photo = "https://drive.google.com/file/d/PHOTOFILEID123/view";
const front = "https://drive.google.com/file/d/FRONTFILEID123/view";
const back = "https://drive.google.com/file/d/BACKFILEID123/view";
const combined = "https://drive.google.com/file/d/COMBINEDFILEID123/view";
const pan = "https://drive.google.com/file/d/PANFILEID123/view";
const bank = "https://drive.google.com/file/d/BANKFILEID123/view";
const other = "https://drive.google.com/file/d/OTHERFILEID123/view";

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

function hyperlinkWorkbook(headers, values, hyperlinkTargets) {
  const headerXml = headers.map((header, index) => cell(`${String.fromCharCode(65 + index)}1`, header)).join("");
  const valueXml = values.map((value, index) => cell(`${String.fromCharCode(65 + index)}2`, value)).join("");
  const hyperlinks = Object.keys(hyperlinkTargets).map((ref, index) => `<hyperlink ref="${ref}" r:id="rLink${index + 1}"/>`).join("");
  const relationships = Object.entries(hyperlinkTargets).map(([ref, target], index) => `<Relationship Id="rLink${index + 1}" Target="${target}" TargetMode="External"/>`).join("");
  return createStoredZip({
    "xl/workbook.xml": `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Labour Import" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData><row r="1">${headerXml}</row><row r="2">${valueXml}</row></sheetData><hyperlinks>${hyperlinks}</hyperlinks></worksheet>`,
    "xl/worksheets/_rels/sheet1.xml.rels": `<Relationships>${relationships}</Relationships>`,
  });
}

const baseHeaders = ["Labour Name *", "Father / Husband Name *", "Company Name *", "Site Name *", "Contractor Name *", "Labour Category *", "Daily Rate *", "Effective / Joining Date *"];
const baseValues = ["Ram", "Shyam", "MRC Infracon Limited", "CRPF HQ, Delhi", "ABC Contractor", "Labour", "500", "2026-07-29"];

const direct = parseLabourWorkbook(workbook(
  [...baseHeaders, "Labour Photo Drive Link", "Aadhaar Front Drive Link", "Aadhaar Back Drive Link", "Combined Aadhaar Drive Link"],
  [...baseValues, photo, front, back, combined],
));
assert.equal(direct.rows[0].normalized.photo_drive_url, photo, "direct Labour Photo Drive Link must parse into photo_drive_url");
assert.equal(direct.rows[0].normalized.aadhaar_front_drive_url, front, "direct Aadhaar Front Drive Link must parse into aadhaar_front_drive_url");
assert.equal(direct.rows[0].normalized.aadhaar_back_drive_url, back, "direct Aadhaar Back Drive Link must parse into aadhaar_back_drive_url");
assert.equal(direct.rows[0].normalized.aadhaar_combined_drive_url, combined, "direct Combined Aadhaar Drive Link must parse into aadhaar_combined_drive_url");

const legacy = parseLabourWorkbook(workbook(
  [...baseHeaders, "Labour Photo Filename", "Aadhaar Front Filename", "Aadhaar Back Filename", "Combined Aadhaar PDF Filename"],
  [...baseValues, photo, front, back, combined],
));
assert.equal(legacy.rows[0].normalized.photo_drive_url, photo, "legacy Filename header containing a Drive URL must be promoted to photo_drive_url");
assert.equal(legacy.rows[0].normalized.aadhaar_front_drive_url, front, "legacy Aadhaar Front Filename containing a Drive URL must be promoted");
assert.equal(legacy.rows[0].normalized.aadhaar_back_drive_url, back, "legacy Aadhaar Back Filename containing a Drive URL must be promoted");
assert.equal(legacy.rows[0].normalized.aadhaar_combined_drive_url, combined, "legacy Combined Aadhaar Filename containing a Drive URL must be promoted");

const hyperlinked = parseLabourWorkbook(hyperlinkWorkbook(
  [...baseHeaders, "Labour Photo Drive Link", "Aadhaar Front Drive Link", "Aadhaar Back Drive Link", "Combined Aadhaar Drive Link", "PAN Drive Link", "Bank Proof Drive Link", "Other Document Drive Link"],
  [...baseValues, "ADITYA_THAKUR_N_C4421.jpeg", "Aasiya khatoon_Adhaar", "AFTAB_ANSARI323777777.jpeg", "AJAY_BHARTIFRONT.pdf", "PAN_CARD.jpeg", "BANK_PROOF.pdf", "OTHER_DOC.jpeg"],
  { I2: photo, J2: front, K2: back, L2: combined, M2: pan, N2: bank, O2: other },
));
assert.equal(hyperlinked.rows[0].normalized.photo_drive_url, photo, "document Drive Link cell must prefer Excel hyperlink target over visible filename");
assert.equal(hyperlinked.rows[0].normalized.photo_drive_url_display_name, "ADITYA_THAKUR_N_C4421.jpeg", "document Drive Link cell must preserve visible filename as display name");
assert.equal(hyperlinked.rows[0].normalized.aadhaar_front_drive_url, front, "Aadhaar Front cell must use hyperlink target as source URL");
assert.equal(hyperlinked.rows[0].normalized.aadhaar_front_drive_url_display_name, "Aasiya khatoon_Adhaar", "Aadhaar Front cell must preserve visible display text");
assert.equal(hyperlinked.rows[0].normalized.aadhaar_back_drive_url, back, "Aadhaar Back cell must use hyperlink target as source URL");
assert.equal(hyperlinked.rows[0].normalized.aadhaar_combined_drive_url, combined, "Combined Aadhaar cell must use hyperlink target as source URL");
assert.equal(hyperlinked.rows[0].normalized.pan_drive_url, pan, "PAN cell must use hyperlink target as source URL");
assert.equal(hyperlinked.rows[0].normalized.bank_proof_drive_url, bank, "Bank Proof cell must use hyperlink target as source URL");
assert.equal(hyperlinked.rows[0].normalized.other_document_drive_url, other, "Other Document cell must use hyperlink target as source URL");
assert.equal(hyperlinked.rows[0].raw["Aadhaar Front Drive Link"], front, "raw document source must store the hyperlink target for validation/download");
assert.equal(hyperlinked.rows[0].raw["Aadhaar Front Drive Link Display Name"], "Aasiya khatoon_Adhaar", "raw document display name must preserve the visible Excel text");

const pageSource = fs.readFileSync(new URL("../app/labour/workers/import/page.tsx", import.meta.url), "utf8");
assert.doesNotMatch(pageSource, /\/api\/labour\/import\/folder/, "direct document access must not call folder inventory");
assert.doesNotMatch(pageSource, /Paste the Google Drive folder link/, "direct document access must not ask for folder input");
assert.match(pageSource, /filenameFromDisposition/, "error report downloads must use authenticated blob download with a safe response filename");
assert.match(pageSource, /response\.blob\(\)/, "error report download must read the protected response as a Blob");
assert.match(pageSource, /Authorization: `Bearer \$\{await token\(\)\}`/, "error report download must send the Supabase access token");

console.log("Labour import direct document link tests passed.");
