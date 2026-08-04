import assert from "node:assert/strict";
import fs from "node:fs";

const employeeValidate = fs.readFileSync(new URL("../app/api/hr/employee-import/validate/route.ts", import.meta.url), "utf8");
const employeeExecute = fs.readFileSync(new URL("../app/api/hr/employee-import/execute/route.ts", import.meta.url), "utf8");
const labourValidate = fs.readFileSync(new URL("../app/api/labour/import/validate/route.ts", import.meta.url), "utf8");
const labourExecute = fs.readFileSync(new URL("../app/api/labour/import/execute/route.ts", import.meta.url), "utf8");
const driveHelper = fs.readFileSync(new URL("../src/lib/googleDrive.ts", import.meta.url), "utf8");
const pageSource = fs.readFileSync(new URL("../app/labour/workers/import/page.tsx", import.meta.url), "utf8");

assert.match(employeeValidate, /downloadDriveFile/, "Employee Import validation must continue using the supported Drive download helper");
assert.match(employeeExecute, /downloadDriveFile/, "Employee Import execution must continue using the supported Drive download helper");
assert.doesNotMatch(employeeValidate, /listDriveFolderFiles/, "Employee Import does not use folder listing because it has direct file links");

assert.match(labourValidate, /downloadDriveFile/, "Labour Import validation must use the same direct Drive file helper as Employee Import");
assert.doesNotMatch(pageSource, /\/api\/labour\/import\/folder/, "Labour Import visible flow must not call folder listing for direct-link workbooks");
assert.match(labourExecute, /downloadDriveFile/, "Labour Import execution must still use the same Drive file download helper for ERP-owned copies");
assert.match(driveHelper, /action: "download_file"/, "shared Drive helper keeps the Employee Import-supported download_file action");
assert.match(pageSource, /Allow ConstructIQ to access and import the available worker documents from Google Drive\?/, "Labour Import must use a confirmation step before direct document access");
assert.doesNotMatch(pageSource, /Unsupported action/, "Labour Import UI must not expose raw unsupported-action text");

console.log("Labour import Drive consistency tests passed.");
