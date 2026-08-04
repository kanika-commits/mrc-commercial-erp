import assert from "node:assert/strict";
import fs from "node:fs";

const registerSource = fs.readFileSync(new URL("../app/api/labour/workers/register/route.ts", import.meta.url), "utf8");
const validateSource = fs.readFileSync(new URL("../app/api/labour/import/validate/route.ts", import.meta.url), "utf8");
const detailPageSource = fs.readFileSync(new URL("../app/labour/workers/[id]/page.tsx", import.meta.url), "utf8");
const workerListSource = fs.readFileSync(new URL("../app/labour/workers/page.tsx", import.meta.url), "utf8");

function has(source, snippet, message) {
  assert.ok(source.includes(snippet), message);
}

function lacks(source, snippet, message) {
  assert.ok(!source.includes(snippet), message);
}

has(registerSource, "const aadhaarValidation = optionalFormattedAadhaar(input.aadhaarNumber)", "registration normalizes incoming Aadhaar before matching");
has(registerSource, ".in(\"aadhaar_number\", aadhaarLookupValues", "registration uses targeted normalized Aadhaar lookup variants");
has(registerSource, "matchType: \"aadhaar\"", "exact Aadhaar match identifies an existing worker");
has(registerSource, "return { worker: null, matchType: null, confidence: \"none\" as const };", "valid non-matching Aadhaar stops weaker matching");
has(registerSource, "workerName && fatherName && (dateOfBirth || mobileNumber)", "no-Aadhaar fallback requires name, father/husband and DOB or mobile");
has(registerSource, "normalizePersonPart(worker.father_or_husband_name) === fatherName", "fallback requires exact father/husband match");
has(registerSource, "worker.date_of_birth === dateOfBirth", "fallback can match exact DOB");
has(registerSource, "normalizeMobile(worker.mobile_number) === mobileNumber", "fallback can match exact mobile only with exact name and father/husband");
has(registerSource, "matchType: dateOfBirth && matches[0].date_of_birth === dateOfBirth ? \"name_father_dob\"", "name/father/DOB match remains strong");
has(registerSource, ": \"name_father_mobile\"", "name/father/mobile match remains strong");
has(registerSource, "A labourer with the same mobile number exists. Review identity fields if needed.", "mobile-only duplicate awareness is non-blocking");
has(registerSource, "possibleExistingMessage(matches[0])", "uncertain strong-identity conflicts include candidate code/name");
has(registerSource, "Possible existing labourer:", "candidate review message is specific");
lacks(registerSource, "ilike(\"worker_name\"", "fuzzy or partial-name search does not drive existing-worker matching");
lacks(registerSource, "matchType: \"name\"", "name-only match is not an identity match");
lacks(registerSource, "matchType: \"mobile_name\"", "mobile plus name alone is not an identity match");

has(validateSource, "loadExistingWorkersByAadhaar", "Labour Import validation links existing rows by targeted normalized exact Aadhaar lookup only");
lacks(validateSource, "worker.worker_name", "Labour Import validation does not use names to block existing-worker detection");

has(detailPageSource, "function fullAadhaar", "detail page has an authorised full Aadhaar formatter");
has(detailPageSource, "value={fullAadhaar(worker.aadhaar_number)}", "Labour Master detail displays full Aadhaar");
lacks(detailPageSource, "maskAadhaar(worker.aadhaar_number)", "Labour Master detail no longer masks Aadhaar");
assert.ok(!workerListSource.includes("maskAadhaar(worker.aadhaar_number)"), "Labour list does not expose Aadhaar");

assert.ok(!registerSource.includes("labour_documents"), "identity matching change does not touch Labour document logic");
assert.ok(!registerSource.includes("labour_attendance"), "identity matching change does not touch Attendance");

console.log("Labour worker identity match rules passed.");
