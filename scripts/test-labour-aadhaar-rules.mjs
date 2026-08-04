import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { createRequire } from "node:module";
import ts from "typescript";

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
const { normalizeAadhaar, formatAadhaar, validateAadhaar, aadhaarInputValue } = require("../lib/utils/aadhaar.ts");

assert.equal(normalizeAadhaar("555555555555"), "555555555555", "plain 12 digits normalize");
assert.equal(normalizeAadhaar("5555-5555-5555"), "555555555555", "dashed Aadhaar normalizes");
assert.equal(normalizeAadhaar("5555 5555 5555"), "555555555555", "spaced Aadhaar normalizes");
assert.equal(normalizeAadhaar("5555-5555 5555"), "555555555555", "mixed spaces/dashes normalize");
assert.equal(formatAadhaar("555555555555"), "5555-5555-5555", "valid Aadhaar formats with dashes");
assert.equal(aadhaarInputValue("555555555555999"), "5555-5555-5555", "manual input caps at 12 digits");
assert.equal(validateAadhaar("555555555555").valid, true, "plain input is valid");
assert.equal(validateAadhaar("5555-5555-5555").valid, true, "dashed input is valid");
assert.equal(validateAadhaar("5555 5555 5555").valid, true, "spaced input is valid");
assert.equal(validateAadhaar("5555A5555555").valid, false, "letters are invalid");
assert.equal(validateAadhaar("5555/5555/5555").valid, false, "unsupported special characters are invalid");
assert.equal(validateAadhaar("5555").valid, false, "short Aadhaar is invalid");
assert.equal(validateAadhaar("5555555555555").valid, false, "long Aadhaar is invalid");

const sharedSource = fs.readFileSync(new URL("../lib/utils/aadhaar.ts", import.meta.url), "utf8");
assert.match(sharedSource, /export function normalizeAadhaar/, "shared normalize utility exists");
assert.match(sharedSource, /export function formatAadhaar/, "shared format utility exists");
assert.match(sharedSource, /export function validateAadhaar/, "shared validate utility exists");

const newPageSource = fs.readFileSync(new URL("../app/labour/workers/new/page.tsx", import.meta.url), "utf8");
assert.match(newPageSource, /aadhaarInputValue/, "manual Labour Registration uses shared Aadhaar auto-formatting");
assert.match(newPageSource, /maxLength=\{14\}/, "manual Aadhaar field limits dashed display length");
assert.match(newPageSource, /inputMode="numeric"/, "manual Aadhaar field is numeric-friendly");

const editPageSource = fs.readFileSync(new URL("../app/labour/workers/[id]/edit/page.tsx", import.meta.url), "utf8");
assert.match(editPageSource, /aadhaarInputValue/, "Labour Edit uses shared Aadhaar auto-formatting");

const sharedApiSource = fs.readFileSync(new URL("../app/api/labour/_shared.ts", import.meta.url), "utf8");
assert.match(sharedApiSource, /optionalFormattedAadhaar/, "Labour identity helper stores valid Aadhaar in standard dashed format");

const registerSource = fs.readFileSync(new URL("../app/api/labour/workers/register/route.ts", import.meta.url), "utf8");
assert.match(registerSource, /validateAadhaar\(aadhaarInput\)/, "manual create validates Aadhaar before insert");
assert.match(registerSource, /rpc\("find_labour_worker_by_aadhaar"/, "manual create uses normalized database Aadhaar lookup when migration is applied");
assert.match(registerSource, /\.in\("aadhaar_number", aadhaarLookupValues/, "manual create uses targeted Aadhaar lookup values");
assert.match(registerSource, /duplicateAadhaarMessage/, "manual create returns duplicate Aadhaar context");
assert.match(registerSource, /workerError\.code === "23505" && formattedAadhaar/, "manual create catches database Aadhaar uniqueness conflicts as 409");

const editApiSource = fs.readFileSync(new URL("../app/api/labour/workers/[id]/route.ts", import.meta.url), "utf8");
assert.match(editApiSource, /validateAadhaar\(aadhaarInput\)/, "Labour Edit validates Aadhaar");
assert.match(editApiSource, /rpc\("find_labour_worker_by_aadhaar"/, "Labour Edit uses normalized database Aadhaar lookup when migration is applied");
assert.match(editApiSource, /\.neq\("id", excludeId\)/, "Labour Edit excludes current worker during duplicate checks");
assert.match(editApiSource, /aadhaar_number: formattedAadhaar/, "Labour Edit clears or stores formatted Aadhaar");

const batchSource = fs.readFileSync(new URL("../app/api/labour/workers/batch-register/route.ts", import.meta.url), "utf8");
assert.match(batchSource, /aadhaarRows = new Map/, "batch registration builds an Aadhaar duplicate map");
assert.match(batchSource, /Duplicate Aadhaar in this batch/, "batch registration blocks every row in an internal duplicate group");
assert.match(batchSource, /aadhaarValidation\.formatted/, "batch registration submits formatted Aadhaar to create API");

const importSource = fs.readFileSync(new URL("../lib/labour/import.ts", import.meta.url), "utf8");
assert.match(importSource, /optionalFormattedAadhaar\(normalized\.aadhaar_number\)/, "Labour Import parser formats valid Aadhaar through the shared helper");

const validateSource = fs.readFileSync(new URL("../app/api/labour/import/validate/route.ts", import.meta.url), "utf8");
assert.match(validateSource, /validateAadhaar\(normalized\.aadhaar_number\)/, "Labour Import preview validates Aadhaar through the shared helper");
assert.match(validateSource, /function resolveEffectiveAadhaarAvailability/, "Labour Import derives one effective Aadhaar availability state");
assert.match(validateSource, /explicit === "YES"[\s\S]+value: "yes"/, "explicit Yes resolves to effective Yes");
assert.match(validateSource, /explicit === "NO"[\s\S]+value: "no"/, "explicit No resolves to effective No");
assert.match(validateSource, /if \(hasAadhaarNumber\) return \{ value: "yes"/, "blank availability plus Aadhaar present infers Yes");
assert.match(validateSource, /if \(hasNoAadhaarReason\) return \{ value: "no"/, "blank availability plus No-Aadhaar reason infers No");
assert.match(validateSource, /Aadhaar Available must be Yes or No\./, "unsupported nonblank availability is invalid");
assert.match(validateSource, /Specify Aadhaar Available as Yes or No, or provide Aadhaar details\./, "blank availability without Aadhaar or reason is blocked clearly");
assert.match(validateSource, /effectiveAadhaarAvailability\.value === "no" && normalized\.aadhaar_number/, "explicit/effective No with Aadhaar is blocked");
assert.match(validateSource, /No-Aadhaar Reason is required when Aadhaar Available is No\./, "effective No requires No-Aadhaar reason");
assert.match(validateSource, /effectiveAadhaarAvailability\.value === "yes" && !hasAadhaarFrontBack && !hasCombinedAadhaar[\s\S]+warnings\.push\("Aadhaar document not uploaded\. Upload later to complete verification\."\)/, "missing Aadhaar documents are warning-only when Aadhaar is available");
assert.doesNotMatch(validateSource, /errors\.push\("Aadhaar Available is Yes; provide matched Aadhaar Front and Back documents/, "missing Aadhaar documents no longer block import-ready rows");
assert.doesNotMatch(validateSource, /aadhaarAvailable !== "yes"/, "blank/unknown Aadhaar availability is no longer treated as No");
assert.match(validateSource, /Duplicate Aadhaar in this workbook/, "Labour Import preview reports workbook duplicate Aadhaar rows");
assert.match(validateSource, /loadExistingWorkersByAadhaar/, "Labour Import preview uses targeted existing-worker Aadhaar lookups");
assert.match(validateSource, /rpc\("find_labour_worker_by_aadhaar"/, "Labour Import preview can use the normalized Aadhaar lookup helper");
assert.doesNotMatch(validateSource, /const \[\{ data: rows, error: rowsError \}, \{ data: workers/, "Labour Import preview does not load the entire Labour worker table for Aadhaar uniqueness");
assert.doesNotMatch(validateSource, /\.neq\("status", "deleted"\)/, "deleted Labour workers continue to reserve Aadhaar during import validation");

const newWorkerPageSource = fs.readFileSync(new URL("../app/labour/workers/new/page.tsx", import.meta.url), "utf8");
assert.doesNotMatch(newWorkerPageSource, /row\.pairing_status === "needs_pairing"\) errors\.push/, "manual Labour registration does not block solely on missing Aadhaar documents");
assert.match(newWorkerPageSource, /Aadhaar document not uploaded\. Upload later to complete verification\./, "manual Labour registration shows a non-blocking missing-document warning");

const executeSource = fs.readFileSync(new URL("../app/api/labour/import/execute/route.ts", import.meta.url), "utf8");
assert.match(executeSource, /POST as registerWorker/, "Labour Import execution reuses create API for final Aadhaar recheck");

const migrationSource = fs.readFileSync(new URL("../supabase/migrations/202608010002_labour_aadhaar_format_unique.sql", import.meta.url), "utf8");
assert.match(migrationSource, /invalid Aadhaar values exist/, "migration aborts on invalid existing Aadhaar");
assert.match(migrationSource, /duplicate normalized Aadhaar values exist/, "migration aborts on duplicate normalized Aadhaar");
assert.match(migrationSource, /drop index if exists public\.labour_workers_aadhaar_unique_idx/, "migration replaces the old raw/status-filtered Aadhaar index");
assert.match(migrationSource, /create unique index if not exists labour_workers_aadhaar_unique_idx[\s\S]+organization_id,[\s\S]+regexp_replace\(aadhaar_number, '\[\^0-9\]'/, "migration adds organization-scoped normalized Aadhaar uniqueness");
assert.match(migrationSource, /create or replace function public\.find_labour_worker_by_aadhaar/, "migration provides an indexed normalized Aadhaar lookup helper");
assert.doesNotMatch(migrationSource, /status <> 'deleted'/, "migration uniqueness does not allow deleted-worker Aadhaar reuse");

console.log("Labour Aadhaar rules tests passed.");
