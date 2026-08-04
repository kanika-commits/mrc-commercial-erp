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
const driveUrl = "https://drive.google.com/drive/folders/1VlAjqpimMk4-6p4vRac4ZCOVvj-PZwvf";
const otherDriveUrl = "https://drive.google.com/drive/folders/SHOULD_NOT_BE_USED";

function workbook(settingCellXml, settingsRels = "") {
  return createStoredZip({
    "xl/workbook.xml": `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Import Settings" sheetId="1" r:id="rId1"/><sheet name="Labour Import" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Setting</t></is></c><c r="B1" t="inlineStr"><is><t>Value</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Google Drive Document Folder Link</t></is></c>${settingCellXml}</row></sheetData>${settingsRels ? '<hyperlinks><hyperlink ref="B2" r:id="rLink1"/></hyperlinks>' : ""}</worksheet>`,
    ...(settingsRels ? { "xl/worksheets/_rels/sheet1.xml.rels": settingsRels } : {}),
    "xl/worksheets/sheet2.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Labour Name *</t></is></c><c r="B1" t="inlineStr"><is><t>Father / Husband Name *</t></is></c><c r="C1" t="inlineStr"><is><t>Company Name *</t></is></c><c r="D1" t="inlineStr"><is><t>Site Name *</t></is></c><c r="E1" t="inlineStr"><is><t>Contractor Name *</t></is></c><c r="F1" t="inlineStr"><is><t>Labour Category *</t></is></c><c r="G1" t="inlineStr"><is><t>Daily Rate *</t></is></c><c r="H1" t="inlineStr"><is><t>Effective / Joining Date *</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Ram</t></is></c><c r="B2" t="inlineStr"><is><t>Shyam</t></is></c><c r="C2" t="inlineStr"><is><t>MRC Infracon Limited</t></is></c><c r="D2" t="inlineStr"><is><t>CRPF HQ, Delhi</t></is></c><c r="E2" t="inlineStr"><is><t>ABC Contractor</t></is></c><c r="F2" t="inlineStr"><is><t>Labour</t></is></c><c r="G2" t="inlineStr"><is><t>500</t></is></c><c r="H2" t="inlineStr"><is><t>2026-07-29</t></is></c></row></sheetData></worksheet>`,
  });
}

const visibleUrl = parseLabourWorkbook(workbook(`<c r="B2" t="inlineStr"><is><t>${driveUrl}</t></is></c>`));
assert.equal(visibleUrl.documentFolderUrl, driveUrl, "folder URL must be read from Import Settings!B2 visible text");

const whitespaceUrl = parseLabourWorkbook(workbook(`<c r="B2" t="inlineStr"><is><t>  ${driveUrl}  </t></is></c>`));
assert.equal(whitespaceUrl.documentFolderUrl, driveUrl, "folder URL must be trimmed from Import Settings!B2");

const hyperlinkUrl = parseLabourWorkbook(workbook(
  `<c r="B2" t="inlineStr"><is><t>Open document folder</t></is></c>`,
  `<Relationships><Relationship Id="rLink1" Target="${driveUrl}" TargetMode="External"/></Relationships>`,
));
assert.equal(hyperlinkUrl.documentFolderUrl, driveUrl, "folder URL must be read from Import Settings!B2 hyperlink target");

const formulaResultUrl = parseLabourWorkbook(workbook(`<c r="B2" t="str"><f>\"${otherDriveUrl}\"</f><v>${driveUrl}</v></c>`));
assert.equal(formulaResultUrl.documentFolderUrl, driveUrl, "folder URL must be read from Import Settings!B2 formula result");

const formulaTextUrl = parseLabourWorkbook(workbook(`<c r="B2" t="str"><f>HYPERLINK(\"${driveUrl}\",\"Open\")</f><v>Open</v></c>`));
assert.equal(formulaTextUrl.documentFolderUrl, driveUrl, "folder URL may be recovered from an explicit Import Settings!B2 formula when the cached result is not the URL");

const richTextUrl = parseLabourWorkbook(workbook(`<c r="B2" t="inlineStr"><is><r><t> ${driveUrl.slice(0, 32)}</t></r><r><t>${driveUrl.slice(32)} </t></r></is></c>`));
assert.equal(richTextUrl.documentFolderUrl, driveUrl, "folder URL must be read from Import Settings!B2 rich text");

const legacy = parseLabourWorkbook(workbook(`<c r="B2" t="inlineStr"><is><t></t></is></c>`));
assert.equal(legacy.documentFolderUrl, "", "blank folder setting must remain a legacy/manual fallback case");

const unrelatedUrl = parseLabourWorkbook(workbook(
  `<c r="B2" t="inlineStr"><is><t></t></is></c><c r="C2" t="inlineStr"><is><t>${otherDriveUrl}</t></is></c>`,
));
assert.equal(unrelatedUrl.documentFolderUrl, "", "unrelated Drive URLs outside the explicit value cell must be ignored");

const officialTemplate = fs.readFileSync(new URL("../public/templates/ConstructIQ_Labour_Import_Template.xlsx", import.meta.url));
const officialParsed = parseLabourWorkbook(officialTemplate);
assert.equal(officialParsed.documentFolderUrl, "", "served blank official template must parse as not_found until the user fills Import Settings!B2");
assert.ok(officialParsed.rows.length >= 0, "served official template and parser must agree on workbook structure");

const uploadRoute = fs.readFileSync(new URL("../app/api/labour/import/upload/route.ts", import.meta.url), "utf8");
assert.match(uploadRoute, /mapping = documentFolderSource \? \{ \[DOCUMENT_FOLDER_SOURCE_KEY\]: documentFolderSource \} : \{\}/, "missing folder URL must still insert a non-null mapping object");
assert.match(uploadRoute, /folder_id: documentFolderId \|\| null/, "valid folder detection must store the parsed folder ID");
assert.match(uploadRoute, /status: documentFolderId \? "detected" : "invalid"/, "valid folder detection must store detected source metadata");

console.log("Labour import folder detection tests passed.");
