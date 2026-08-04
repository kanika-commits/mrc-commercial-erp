import assert from "node:assert/strict";
import fs from "node:fs";
import {
  extractDriveUrls,
  extractGoogleDriveFileId,
  documentMappingForColumn,
  normalizeEmployeeCode,
  parseEmployeeDocumentWorkbook,
} from "../lib/hr/employeeDocumentImport.ts";

const driveId = "1AbCdEfGhIjKlMnOpQrStUvWxYz123456";
const secondDriveId = "2AbCdEfGhIjKlMnOpQrStUvWxYz123456";

assert.equal(
  extractGoogleDriveFileId(`https://drive.google.com/file/d/${driveId}/view?usp=sharing`),
  driveId,
);
assert.equal(
  extractGoogleDriveFileId(`https://drive.google.com/open?id=${driveId}`),
  driveId,
);
assert.equal(
  extractGoogleDriveFileId(`https://drive.google.com/uc?export=download&id=${driveId}`),
  driveId,
);
assert.equal(extractGoogleDriveFileId("HDFC Bank"), "");

assert.deepEqual(
  extractDriveUrls(
    `https://drive.google.com/file/d/${driveId}/view, https://drive.google.com/open?id=${secondDriveId}\nHDFC Bank`,
  ),
  [
    `https://drive.google.com/file/d/${driveId}/view`,
    `https://drive.google.com/open?id=${secondDriveId}`,
  ],
);

assert.deepEqual(
  extractDriveUrls("Visible text only", [`https://drive.google.com/file/d/${driveId}/view`]),
  [`https://drive.google.com/file/d/${driveId}/view`],
);

assert.equal(documentMappingForColumn("Aadhaar Card link")?.documentType, "Aadhaar Card");
assert.equal(documentMappingForColumn("Bank link")?.documentType, "Bank Proof");
assert.deepEqual(documentMappingForColumn("10th")?.metadata, { qualification: "10th" });
assert.equal(normalizeEmployeeCode("1200.0"), "1200");

const duplicateIds = [
  `https://drive.google.com/file/d/${driveId}/view`,
  `https://drive.google.com/open?id=${driveId}`,
].map(extractGoogleDriveFileId);
assert.equal(new Set(duplicateIds).size, 1);

const sarbjitWorkbook = "/Users/kanikapuri/Downloads/Untitled spreadsheet (1).xlsx";
let sarbjitWorkbookExtraction = "skipped";
if (fs.existsSync(sarbjitWorkbook)) {
  const parsed = parseEmployeeDocumentWorkbook(fs.readFileSync(sarbjitWorkbook));
  const sarbjit = parsed.rows.find((row) => row.raw["Name of Employee"] === "Sarbjit Singh");
  assert.ok(sarbjit, "Sarbjit Singh row should exist in the document import workbook.");

  const extractedByColumn = Object.fromEntries(
    parsed.headers.map((header) => [
      header,
      extractDriveUrls(sarbjit.raw[header], sarbjit.hyperlinks[header] || []),
    ]),
  );

  assert.equal(extractedByColumn["Aadhaar Card link"].length, 1);
  assert.equal(extractedByColumn["Bank  link"].length, 0);
  assert.equal(extractedByColumn["Driving Licence"].length, 1);
  sarbjitWorkbookExtraction = "passed";
}

console.log(JSON.stringify({
  drive_url_extraction: "passed",
  multiple_links: "passed",
  hyperlink_target_parsing: "passed",
  non_url_text_ignored: "passed",
  duplicate_file_id_detection: "passed",
  sarbjit_workbook_extraction: sarbjitWorkbookExtraction,
}));
