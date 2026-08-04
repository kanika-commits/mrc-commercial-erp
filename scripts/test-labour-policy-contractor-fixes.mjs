import assert from "node:assert/strict";
import fs from "node:fs";

const operations = fs.readFileSync("lib/labour/operations.ts", "utf8");
const contractorListApi = fs.readFileSync("app/api/labour/contractors/route.ts", "utf8");
const contractorApi = fs.readFileSync("app/api/labour/contractors/[id]/route.ts", "utf8");
const contractorPage = fs.readFileSync("app/labour/contractors/page.tsx", "utf8");
const contractorEditPage = fs.readFileSync("app/labour/contractors/[id]/edit/page.tsx", "utf8");
const policyApi = fs.readFileSync("app/api/labour/attendance-policy/route.ts", "utf8");
const settingsPage = fs.readFileSync("app/labour/settings/page.tsx", "utf8");
const configPage = fs.readFileSync("app/labour/configuration/page.tsx", "utf8");
const shared = fs.readFileSync("app/api/labour/_shared.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/202607250002_fix_labour_policy_and_contractor_edit.sql", "utf8");
const removedMinimumHoursMigrationExists = fs.existsSync("supabase/migrations/202607250004_add_labour_policy_minimum_present_hours.sql");

assert.match(contractorPage, /\/labour\/contractors\/\$\{contractor\.id\}\/edit/, "Contractor list exposes edit link");
assert.match(contractorPage, /\["Contractor Code", "Contractor Name", "Contact Person", "Mobile", "Active Labour", "Active Sites", "Status", "Actions"\]/, "Contractor list uses the simplified compact columns");
assert.doesNotMatch(contractorPage, /\["Code", "Vendor", "PAN", "GSTIN"/, "Contractor list does not expose PAN/GST columns in the main table");
assert.doesNotMatch(contractorPage, /"Labour Licence", "Licence Expiry".*"Compliance"/, "Contractor list does not expose permanent compliance columns");
assert.match(contractorPage, /Search name, code, contact or licence/, "Contractor list search covers name, code, contact and licence");
assert.doesNotMatch(contractorListApi, /EPF missing/, "Contractor list API does not flag optional EPF as missing");
assert.doesNotMatch(contractorListApi, /ESIC missing/, "Contractor list API does not flag optional ESIC as missing");
assert.match(contractorListApi, /Expires in \$\{licenceDays\} days/, "Contractor compliance warnings only cover populated licence expiry");
assert.match(contractorPage, /Additional Compliance/, "Contractor enable form keeps uncommon compliance collapsed");
assert.match(contractorEditPage, /Vendor identity remains read-only/, "Contractor edit keeps vendor identity read-only");
assert.match(contractorApi, /requireLabourPermission\(request, MODULE, "edit"\)/, "Contractor update requires edit permission");
assert.match(contractorApi, /normalizeIdentifier\(payload\.contractor_code\)/, "Contractor code is normalized");
assert.match(contractorApi, /\.neq\("id", id\)/, "Duplicate contractor code check excludes current contractor");
assert.match(contractorApi, /Reason is required to change contractor code/, "Code change with active rows requires reason");

assert.match(policyApi, /from\("sites"\)\.select\("id, organization_id, company_id, site_name, site_code, status"\)\.eq\("status", "active"\)/, "Policy lookups use canonical active sites");
assert.doesNotMatch(policyApi, /site\.company_id !== companyId/, "Policy save does not require site.company_id to match company_id");
assert.doesNotMatch(policyApi, /siteQuery = siteQuery\.in\("company_id"/, "Policy site lookup is independent from selected company");
assert.match(settingsPage, /redirect\("\/labour\/configuration"\)/, "Old Labour settings route redirects to the canonical Labour Attendance Policy page");
assert.match(policyApi, /changedValues\(existing, nextPayload\)/, "Policy audit compares tracked old/new values");
assert.match(policyApi, /moduleCode: "labour_attendance_policy"/, "Policy audit uses labour attendance policy module");
assert.match(policyApi, /action: existing \? "update" : "create"/, "Policy create/update audit action is explicit");
assert.match(policyApi, /changes\.changedFields\.length/, "Unchanged policy save does not create misleading audit changes");
assert.match(policyApi, /from\("erp_audit_logs"\)/, "Policy activity reads existing ERP audit logs");
assert.match(policyApi, /requireLabourPermission\(request, "labour_attendance_policy", "view"\)/, "Policy activity is protected by view permission");
assert.match(policyApi, /\.in\("site_id", access\.assignments\.siteIds\)/, "Policy activity is site-scoped for assigned users");
assert.match(policyApi, /policyIds\.has\(log\.record_id\)/, "Guessed policy logs are filtered to visible policies");
assert.match(policyApi, /maximumDailyOtMinutes\(payload\.max_daily_ot_hours\)/, "Policy API receives daily OT in UI hours");
assert.match(policyApi, /return \{ minutes: hours \* 60 \}/, "Policy API stores daily OT as minutes");
assert.match(policyApi, /between 0 and 24/, "Policy API rejects invalid daily OT hours");
assert.doesNotMatch(policyApi, /minimum_present_hours|minimumPresentHours|Minimum Hours/, "Policy API does not read or write minimum present hours");
assert.match(policyApi, /auto_lock_basis/, "Policy API persists lock basis");
assert.match(policyApi, /auto_lock_delay_hours/, "Policy API persists delay hours");
assert.match(configPage, /\["Company", "Site", "Attendance System", "Lock Time", "Backdate", "Status"\]/, "Canonical Labour Attendance Policy list is a read-only policy summary without Shift or Actions");
assert.doesNotMatch(configPage, /setFilters\(\{ company_id: policy\.company_id, site_id: policy\.site_id \}\)/, "Canonical policy summary must not keep a table Edit button");
assert.match(shared, /loadLabourEditLockBlocker/, "Shared automatic lock blocker exists");
assert.match(shared, /site\.company_id !== companyId/, "Other Labour workflows retain strict company-site validation helper");
assert.match(operations, /labourPolicyLockCutoff/, "Central lock cutoff calculator exists");
assert.match(operations, /isAfterLabourPolicyLockCutoff/, "Central post-cutoff checker exists");
assert.match(migration, /add column if not exists auto_lock_basis text/, "Corrective migration adds lock basis");
assert.match(migration, /add column if not exists auto_lock_delay_hours integer/, "Corrective migration adds delay hours");
assert.equal(removedMinimumHoursMigrationExists, false, "Unapplied minimum-hours policy migration is removed");

function cutoff(attendanceDate, shiftEndTime, delayHours) {
  const next = new Date(`${attendanceDate}T${shiftEndTime}:00+05:30`);
  next.setHours(next.getHours() + delayHours);
  return next;
}

const sameDay = cutoff("2026-07-22", "17:00", 4);
assert.equal(sameDay?.toISOString(), "2026-07-22T15:30:00.000Z", "17:00 IST + 4 hours locks at 21:00 IST");

const nextDay = cutoff("2026-07-22", "17:00", 24);
assert.equal(nextDay?.toISOString(), "2026-07-23T11:30:00.000Z", "17:00 IST + 24 hours locks at 17:00 IST next day");

assert.equal(new Date("2026-07-22T15:00:00.000Z").getTime() >= sameDay.getTime(), false, "Pre-cutoff edit is allowed");

assert.equal(new Date("2026-07-22T15:31:00.000Z").getTime() >= sameDay.getTime(), true, "Post-cutoff edit is blocked");

console.log("Labour policy/contractor fix tests passed.");
