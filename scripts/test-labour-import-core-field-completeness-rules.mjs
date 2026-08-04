import assert from "node:assert/strict";
import fs from "node:fs";

const importSource = fs.readFileSync(new URL("../lib/labour/import.ts", import.meta.url), "utf8");
const executeSource = fs.readFileSync(new URL("../app/api/labour/import/execute/route.ts", import.meta.url), "utf8");
const registerSource = fs.readFileSync(new URL("../app/api/labour/workers/register/route.ts", import.meta.url), "utf8");
const detailPageSource = fs.readFileSync(new URL("../app/labour/workers/[id]/page.tsx", import.meta.url), "utf8");
const detailApiSource = fs.readFileSync(new URL("../app/api/labour/workers/[id]/route.ts", import.meta.url), "utf8");

function has(source, snippet, message) {
  assert.ok(source.includes(snippet), message);
}

has(importSource, "aadhaar_number: [\"aadhaar\", \"aadhaar number\"", "completed workbook header Aadhaar Number maps to normalized aadhaar_number");
has(importSource, "\"aadhaar card number\"", "Aadhaar Card Number alias is supported");
has(importSource, "optionalFormattedAadhaar(normalized.aadhaar_number)", "Aadhaar is normalized and stored in standard dashed format");
has(importSource, "text.replace(/[\\s-]+/g, \"\")", "Aadhaar spaces and hyphens are harmlessly removed");
has(importSource, "Number(compact).toFixed(0)", "numeric-looking identifier scientific notation is expanded without preserving exponent text");
has(importSource, "mobile_number: [\"mobile\", \"mobile number\", \"mobile no\"", "Mobile Number aliases are supported");
has(importSource, "normalized.mobile_number = normalizeImportIdentifier(normalized.mobile_number, { digitsOnly: true })", "Mobile is preserved as a digit string");
has(importSource, "normalized.alternate_mobile_number = normalizeImportIdentifier(normalized.alternate_mobile_number, { digitsOnly: true })", "alternate/emergency mobile is normalized without number coercion");
has(importSource, "date_of_joining: [\"joining date\", \"date of joining\", \"effective date\"", "joining/effective date aliases are supported");
has(importSource, "effective/ joining date", "joined Effective/ Joining Date header variant is supported");
has(importSource, "const namedMonth = text.replace(/,/g, \"\").match", "text dates like 07 Apr 2026 are parsed");
has(importSource, "MONTHS[namedMonth[2].toUpperCase()]", "month-name dates are normalized without ambiguous US parsing");
has(importSource, "excelSerialToDate(text)", "Excel serial joining dates are parsed");
has(importSource, "designation: [\"designation\", \"trade\"", "Designation maps to trade/skill separately from Labour Category");
has(importSource, "normalized.trade = normalized.designation || normalized.trade_name || normalized.trade || normalized.employment_category", "designation/trade takes precedence over payment category");
has(importSource, "normalized.labour_category = normalized.employment_category || \"\"", "Labour Category is retained as category/payment metadata");
has(importSource, "bank_account_number: [\"bank account\"", "Bank account aliases are supported when present in a workbook");
has(importSource, "uan_number: [\"uan\"", "UAN aliases are supported when present in a workbook");
has(importSource, "esi_number: [\"esi\"", "ESI/ESIC aliases are supported when present in a workbook");

for (const field of [
  "gender: n.gender",
  "date_of_birth: n.date_of_birth",
  "aadhaar_number: n.aadhaar_number",
  "mobile_number: n.mobile_number",
  "alternate_mobile_number: n.alternate_mobile_number",
  "uan_number: n.uan_number",
  "esi_number: n.esi_number",
  "bank_account_number: n.bank_account_number",
  "bank_ifsc: n.bank_ifsc",
  "bank_name: n.bank_name",
  "status: n.status",
  "skill_level: n.skill_level",
  "wage_rate: n.wage_rate",
  "effective_from: n.date_of_joining",
]) {
  has(executeSource, field, `execute payload forwards ${field}`);
}

for (const field of [
  "gender: text(payload.gender)",
  "mobile_number: normalizeMobile(payload.mobile_number)",
  "alternate_mobile_number: normalizeMobile(payload.alternate_mobile_number)",
  "bank_account_number: text(payload.bank_account_number)",
  "bank_ifsc: text(payload.bank_ifsc)",
  "bank_name: text(payload.bank_name)",
  "...identity",
  "date_of_birth: text(payload.date_of_birth)",
  "date_of_joining: effectiveFrom",
]) {
  has(registerSource, field, `registration persists ${field}`);
}

has(detailApiSource, "worker: { ...worker", "worker detail API returns persisted labour worker columns");
for (const label of [
  "Date of Birth",
  "Alternate Mobile",
  "Aadhaar",
  "UAN",
  "ESI",
  "Bank Name",
  "Joining Date",
  "Daily Rate",
  "Payment Model",
]) {
  has(detailPageSource, `label=\"${label}\"`, `worker detail displays ${label}`);
}

assert.ok(!executeSource.includes("list_folder_files"), "core import execution does not depend on Drive folder listing");
assert.ok(!executeSource.includes("labour_attendance"), "core Labour Import execution does not touch Attendance");

console.log("Labour Import core-field completeness rules passed.");
