import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/202607250001_create_labour_management_v2.sql", "utf8");
const permissionMatrix = fs.readFileSync("lib/permissionMatrix.ts", "utf8");
const attendanceApi = fs.readFileSync("app/api/labour/attendance/daily/route.ts", "utf8");
const attendancePage = fs.readFileSync("app/labour/attendance/daily/page.tsx", "utf8");
const musterPage = fs.readFileSync("app/labour/muster/page.tsx", "utf8");
const musterApi = fs.readFileSync("app/api/labour/attendance/monthly/route.ts", "utf8");
const wageCalcApi = fs.readFileSync("app/api/labour/wages/[id]/calculate/route.ts", "utf8");
const deploymentApi = fs.readFileSync("app/api/labour/workers/[id]/deployments/route.ts", "utf8");
const mwoApi = fs.readFileSync("app/api/labour/manpower-work-orders/route.ts", "utf8");
const mwoDetailPage = fs.readFileSync("app/labour/manpower-work-orders/[id]/page.tsx", "utf8");
const mwoRateApi = fs.readFileSync("app/api/labour/manpower-work-orders/[id]/rates/route.ts", "utf8");
const mwoCreatePage = fs.readFileSync("app/labour/manpower-work-orders/new/page.tsx", "utf8");
const labourLookupsApi = fs.readFileSync("app/api/labour/lookups/route.ts", "utf8");
const workLogApi = fs.readFileSync("app/api/labour/work-logs/route.ts", "utf8");
const labourShared = fs.readFileSync("app/api/labour/_shared.ts", "utf8");
const attendanceMonthlyApi = fs.readFileSync("app/api/labour/attendance/monthly/route.ts", "utf8");
const attendanceDayLockApi = fs.readFileSync("app/api/labour/attendance/day-lock/route.ts", "utf8");
const attendanceDayUnlockApi = fs.readFileSync("app/api/labour/attendance/day-unlock/route.ts", "utf8");
const attendanceImportUploadApi = fs.readFileSync("app/api/labour/attendance-import/upload/route.ts", "utf8");
const photoEvidenceApi = fs.readFileSync("app/api/labour/photo-evidence/route.ts", "utf8");
const phaseOneFixMigration = fs.readFileSync("supabase/migrations/202607250003_labour_phase1_navigation_permission_upload_fix.sql", "utf8");
const labourLauncherPage = fs.readFileSync("app/labour/page.tsx", "utf8");
const defaultModuleNavigation = fs.readFileSync("lib/defaultModuleNavigation.ts", "utf8");

function calculateDailyWageLine(input) {
  const attendanceUnits = input.status === "present" ? 1 : input.status === "half_day" ? 0.5 : 0;
  const overtimeHours = Math.max(0, Number(input.approvedOvertimeMinutes || 0)) / 60;
  const overtimeDays = overtimeHours / Number(input.shiftHours || 8);
  const amount = (attendanceUnits + overtimeDays) * input.dailyRate;
  let contractorProfit = 0;
  if (input.contractorProfitType === "percentage") contractorProfit = amount * (Number(input.contractorProfitValue || 0) / 100);
  if (input.contractorProfitType === "fixed_per_labour_day") contractorProfit = attendanceUnits * Number(input.contractorProfitValue || 0);
  return {
    attendance_units: attendanceUnits,
    overtime_days: Math.round(overtimeDays * 100) / 100,
    basic_wage: Math.round(amount * 100) / 100,
    overtime_amount: 0,
    contractor_profit: Math.round(contractorProfit * 100) / 100,
    gross_payable: Math.round((amount + contractorProfit) * 100) / 100,
  };
}

function overlaps(aFrom, aTo, bFrom, bTo) {
  return aFrom <= (bTo || "9999-12-31") && bFrom <= (aTo || "9999-12-31");
}

assert.match(migration, /create table if not exists public\.manpower_work_orders/, "Migration must create Manpower Work Orders");
assert.match(migration, /create table if not exists public\.manpower_work_order_rates/, "Migration must create category rates");
assert.match(migration, /create table if not exists public\.labour_site_attendance_policies/, "Migration must create site attendance policies");
assert.match(migration, /create table if not exists public\.labour_work_groups/, "Migration must create work groups");
assert.match(migration, /create table if not exists public\.labour_daily_work_logs/, "Migration must create daily work logs");
assert.match(migration, /create table if not exists public\.labour_overtime_requests/, "Migration must create overtime requests");
assert.match(migration, /create table if not exists public\.labour_photo_evidence/, "Migration must create photo evidence metadata");
assert.match(migration, /work_log_id uuid references public\.labour_daily_work_logs/, "Photo evidence must link to work logs");
assert.match(migration, /overtime_request_id uuid/, "Photo evidence must carry overtime request reference");
assert.match(migration, /foreign key \(manpower_work_order_id\) references public\.manpower_work_orders/, "Deployment/attendance must link to MWO");
assert.match(migration, /public\.transfer_labour_deployment[\s\S]+security definer/, "Transfer RPC must remain atomic");

for (const moduleCode of ["labour_manpower_work_orders", "labour_attendance_policy", "labour_work_groups", "labour_work_logs", "labour_overtime", "labour_photo_evidence", "labour_rate_overrides"]) {
  assert.match(permissionMatrix, new RegExp(`${moduleCode}: \\[`), `${moduleCode} must be exposed in the permission matrix`);
}

assert.match(mwoApi, /validateIndependentCompanySite/, "MWO API must validate company and site independently");
assert.doesNotMatch(mwoApi, /validateCompanySite/, "MWO API must not use strict company-owned site validation");
assert.match(mwoApi, /validateContractorProfile/, "MWO API must validate contractor ownership");
assert.match(mwoApi, /validateWorkOrder/, "MWO API must validate optional Commercial WO scope");
assert.match(mwoApi, /Manpower Work Order number already exists/, "MWO number uniqueness must be checked");
assert.match(mwoApi, /site\.organization_id !== company\.organization_id/, "MWO API still requires selected company and site to share organization");
assert.match(mwoApi, /Contractor Profit Value must be non-negative/, "MWO API validates contractor profit value");
assert.match(permissionMatrix, /"suspend"/, "Global permission action list includes suspend");
assert.match(permissionMatrix, /"resume"/, "Global permission action list includes resume");
assert.match(permissionMatrix, /labour_attendance_unlock: \["view", "approve"\]/, "Attendance Unlock permission is exposed in the permission matrix");
assert.match(phaseOneFixMigration, /'labour_attendance_unlock', 'Attendance Unlock'/, "Attendance Unlock is registered as a visible ERP module row for the permission page");
assert.match(phaseOneFixMigration, /storage\.buckets[\s\S]+'labour-documents'/, "Labour document storage bucket is created idempotently");
assert.match(labourLauncherPage, /Labour Registration/, "Labour launcher exposes Labour Registration as the primary worker entry point");
assert.doesNotMatch(labourLauncherPage, /Work Groups/, "Labour launcher hides Work Groups from the simplified active launcher");
assert.doesNotMatch(labourLauncherPage, /Attendance Unlock/, "Labour launcher hides Attendance Unlock from the simplified active launcher");
assert.doesNotMatch(labourLauncherPage, /Advances/, "Labour launcher no longer exposes worker advances");
assert.doesNotMatch(labourLauncherPage, /direct labour/i, "Labour launcher does not use Direct Labour terminology");
assert.doesNotMatch(defaultModuleNavigation, /module_code: "labour_work_groups"[\s\S]+status: "active"/, "Default module navigation does not expose obsolete standalone Work Groups");
assert.doesNotMatch(defaultModuleNavigation, /module_code: "labour_attendance_unlock"[\s\S]+status: "active"/, "Default module navigation does not expose obsolete standalone Attendance Unlock");
assert.match(permissionMatrix, /labour_manpower_work_orders: \["view", "add", "edit", "delete", "submit", "approve", "reject", "suspend", "resume", "upload", "export"\]/, "MWO permission matrix exposes submit/suspend/resume separately");
assert.match(mwoApi, /actionPermission/, "MWO state changes choose permission by lifecycle action");
assert.match(mwoApi, /action === "submit"\) return "submit"/, "MWO submit requires submit permission");
assert.match(mwoApi, /action === "approve".*return "approve"/, "MWO approve requires approve permission");
assert.match(mwoApi, /\["send_back", "reject", "cancel"\]/, "MWO send back/reject/cancel requires reject permission");
assert.match(mwoApi, /action === "suspend"\) return "suspend"/, "MWO suspend requires suspend permission");
assert.match(mwoApi, /action === "resume"\) return "resume"/, "MWO resume requires resume permission");
assert.match(mwoApi, /Only Draft Manpower Work Orders can be submitted/, "MWO submit is allowed only from draft");
assert.match(mwoApi, /Only submitted Manpower Work Orders can be approved/, "MWO approval is allowed only from pending approval");
assert.match(mwoApi, /Only submitted Manpower Work Orders can be sent back/, "MWO send back is allowed only from pending approval");
assert.match(mwoApi, /patch\.status = "draft"/, "MWO send back returns the record to draft");
assert.match(mwoApi, /Only approved Manpower Work Orders can be suspended/, "MWO suspension is allowed only after approval");
assert.match(mwoApi, /action === "approve" \? "approve"/, "MWO approval audit uses approve action");
assert.match(mwoApi, /\["reject", "send_back"\]\.includes\(action\) \? "reject"/, "MWO reject/send-back audit uses reject action");
assert.match(mwoApi, /business_action: action/, "MWO audit preserves exact business action in constrained audit payload");
assert.match(mwoDetailPage, /canSubmit/, "MWO detail checks submit permission separately");
assert.match(mwoDetailPage, /canSuspend/, "MWO detail checks suspend permission separately");
assert.match(mwoDetailPage, /canResume/, "MWO detail checks resume permission separately");
assert.match(mwoDetailPage, /record\.status === "draft" && <button onClick=\{\(\) => action\("submit"\)\}/, "MWO detail shows Submit only for drafts");
assert.match(mwoDetailPage, /record\.status === "submitted" && <button onClick=\{\(\) => action\("approve"\)\}/, "MWO detail shows Approve only for pending approval");
assert.match(mwoDetailPage, /action\("send_back"\)/, "MWO detail exposes Send Back");
assert.match(mwoDetailPage, /action\("reject"\)/, "MWO detail exposes Reject");
assert.match(mwoDetailPage, /canSuspend && record\.status === "approved" && <button onClick=\{\(\) => action\("suspend"\)\}/, "MWO detail shows Suspend only for approved records with suspend permission");
assert.match(mwoDetailPage, /canResume && record\.status === "suspended" && <button onClick=\{\(\) => action\("resume"\)\}/, "MWO detail shows Resume only for suspended records with resume permission");
assert.match(mwoDetailPage, /status === "submitted" \? "Pending Approval"/, "MWO detail displays submitted as Pending Approval");
assert.match(mwoRateApi, /mwo\.status !== "draft"/, "MWO category rates can be edited only in draft");
assert.match(labourLookupsApi, /purpose === "manpower_work_order"/, "MWO lookup purpose has independent site handling");
assert.doesNotMatch(mwoCreatePage, /site\.company_id === form\.company_id/, "MWO create page does not filter sites by selected company");
assert.doesNotMatch(mwoCreatePage, /company_id: e\.target\.value, site_id: ""/, "MWO company change does not clear independently selected site");
for (const label of ["Manpower WO Number", "Title / Scope", "Company", "Site", "Labour Contractor", "Linked Commercial Work Order (Optional)", "Effective From", "Effective To", "Shift Start Time", "Shift End Time", "Contractor Profit Type", "Contractor Profit Value", "Scope / Notes"]) {
  assert.match(mwoCreatePage, new RegExp(label.replace(/[()]/g, "\\$&")), `MWO create page shows ${label} label`);
}
assert.doesNotMatch(mwoCreatePage, /OT Rate|Overtime Calculation Method|Fixed OT|Hourly OT|Per Hour/, "MWO create page must not expose OT-rate wage concepts");

assert.match(deploymentApi, /Contract-basis deployment requires a Commercial Work Order/, "Contract-basis deployments must require Commercial WO");
assert.match(deploymentApi, /Daily-wage deployment requires a Manpower Work Order/, "Daily-wage deployments must require MWO");
assert.match(deploymentApi, /Selected Manpower Work Order belongs to a different contractor/, "MWO contractor must match deployment contractor");

assert.match(attendanceApi, /first_half_present/, "Attendance must capture first-half attendance");
assert.match(attendanceApi, /second_half_present/, "Attendance must capture second-half attendance");
assert.match(attendanceApi, /ot_hours/, "Attendance must accept manual OT hours");
assert.match(attendanceApi, /approved_overtime_minutes/, "Attendance must carry approved overtime minutes");
assert.match(attendanceApi, /commercial_model/, "Attendance must snapshot commercial model");
assert.match(labourShared, /commercial_model, labour_trade_id/, "Eligible deployment loader selects the V2 payment model");
assert.doesNotMatch(labourShared, /resolved_daily_rate|resolved_overtime_rate|resolved_rate_id/, "Eligible deployment loader must not select non-existent resolved rate columns");
assert.doesNotMatch(deploymentApi, /resolved_daily_rate|resolved_overtime_rate|resolved_rate_id/, "Deployment API must not reference non-existent resolved rate columns");
assert.match(attendanceApi, /const paymentModel = deployment\.commercial_model === "daily_wage" \? "daily_wage" : "contract_basis"/, "Attendance derives payment model from deployment commercial_model");
assert.match(attendanceApi, /function dailyWageRate/, "Attendance centralizes Daily Wage rate selection");
assert.match(attendanceApi, /workerRate\?\.base_rate[\s\S]+mwoRate\?\.daily_rate[\s\S]+deployment\.wage_rate/, "Attendance uses worker override, then MWO rate, then deployment wage-rate fallback");
assert.doesNotMatch(attendanceApi, /function overtimeRate|ot_rate|overtime_rate_label/, "Attendance API must not expose OT-rate wage concepts");
assert.doesNotMatch(attendanceApi, /resolved_daily_rate|resolved_overtime_rate|resolved_rate_id/, "Attendance API must not reference non-existent resolved rate columns");
assert.match(attendanceApi, /payment_model_label: labelFromCode\(paymentModel\)/, "Attendance API returns explicit payment model label");
assert.match(attendanceApi, /assignment_number: assignmentNumber/, "Attendance API returns explicit assignment number");
assert.match(attendanceApi, /rate_applicable: rateApplicable/, "Attendance API returns explicit rate applicability");
assert.match(attendanceApi, /daily_rate_label: rateApplicable \? moneyLabel\(dailyRate\) : "N\/A"/, "Attendance API returns display-ready Daily Wage or Contract Basis rate label");
assert.match(attendanceApi, /getActiveAttendancePolicy/, "Daily attendance GET returns active Attendance Policy metadata for register calculations");
assert.doesNotMatch(attendancePage, /"OT Rate"|ot_rate_label/, "Daily attendance table must not show OT Rate");
assert.doesNotMatch(attendancePage, /row\.payment_model_label/, "Daily attendance register does not show payment model");
assert.match(attendancePage, /\["S\.No\.", "Labour", "Contractor", "Category", "Daily Rate", "First Shift", "Second Shift", "OT Hours", "Bonus Hours"\]/, "Daily attendance register uses the final standard attendance column set");
assert.doesNotMatch(attendancePage, /formatLabourCode\(row\.worker\?\.labour_code\)|"Code", "Labour"|, "Remarks"\]/, "Daily attendance visible register hides Labour Code and Remarks");
assert.match(attendancePage, /row\.daily_rate_label \|\| \(row\.rate_applicable \? "Not Set" : "N\/A"\)/, "Daily attendance renders server-provided Rate without editable inputs");
assert.doesNotMatch(attendancePage, /Start Time|End Time|calculatedOtMinutes|labourAttendanceTiming/, "Daily attendance no longer records manual working hours");
assert.match(attendancePage, /first_half_present[\s\S]+second_half_present[\s\S]+ot_hours/, "Daily attendance save sends half-session flags and manual OT hours");
assert.doesNotMatch(attendancePage, /reference_type", "attendance"|uploadAttendancePhoto|Upload OT start photo|Upload OT end photo/, "Daily attendance page does not implement worker-level OT photo evidence");
assert.match(attendanceApi, /Overtime exceeds the maximum allowed by the Attendance Policy\./, "Daily attendance API blocks OT beyond policy maximum");
assert.match(attendanceApi, /const overtime = Math\.max\(0, Math\.round\(otHours \* 60\)\)/, "Daily attendance API converts manual OT hours to minutes");
assert.match(attendanceApi, /bonus_minutes: bonus\.minutes/, "Daily attendance API stores manual Bonus Hours as bonus_minutes");
assert.match(photoEvidenceApi, /referenceType === "attendance"/, "Photo evidence infrastructure still has legacy attendance-row support pending future group-evidence design");
assert.match(labourShared, /export async function validateCompanySite[\s\S]+site\.company_id !== companyId/, "Strict Commercial-style company-site validator remains unchanged");
assert.match(labourShared, /export async function validateLabourCompanySiteIndependent/, "Labour-specific independent company-site validator exists");
assert.doesNotMatch(labourShared.match(/export async function validateLabourCompanySiteIndependent[\s\S]+?export async function validateWorkOrder/)?.[0] || "", /site\.company_id !== companyId/, "Labour independent validator does not require site.company_id to equal selected company");
assert.match(labourShared, /const resolvedOrganizationId = organizationId \|\| company\?\.organization_id \|\| null/, "Labour independent validator can resolve organization from the selected company");
assert.match(labourShared, /site\.organization_id !== resolvedOrganizationId/, "Labour independent validator still requires company and site to share organization");
assert.match(labourShared, /You do not have access to the selected company\./, "Labour independent validator has clear company-scope error");
assert.match(labourShared, /You do not have access to the selected site\./, "Labour independent validator has clear site-scope error");
assert.match(attendanceApi, /validateLabourCompanySiteIndependent/, "Daily attendance GET/POST use Labour independent company-site validation");
assert.doesNotMatch(attendanceApi, /validateCompanySite/, "Daily attendance must not use strict company-owned-site validation");
assert.match(attendanceMonthlyApi, /validateLabourCompanySiteIndependent/, "Monthly muster uses Labour independent company-site validation");
assert.match(attendanceDayLockApi, /validateLabourCompanySiteIndependent/, "Attendance day lock uses Labour independent company-site validation");
assert.match(attendanceDayUnlockApi, /validateLabourCompanySiteIndependent/, "Attendance day unlock uses Labour independent company-site validation");
assert.match(attendancePage, /if \(!filters\.company_id\) return setMessage\("Select a company\."\)/, "Lock validates selected company before request");
assert.match(attendancePage, /if \(!filters\.site_id\) return setMessage\("Select a site\."\)/, "Lock validates selected site before request");
assert.match(attendancePage, /if \(!filters\.attendance_date\) return setMessage\("Select an attendance date\."\)/, "Lock validates selected attendance date before request");
assert.match(attendancePage, /Load attendance before locking the day\./, "Lock requires attendance rows to be loaded first");
assert.match(attendancePage, /Save attendance changes before locking the day\./, "Lock blocks unsaved attendance edits");
assert.match(attendancePage, /company_id: filters\.company_id[\s\S]+site_id: filters\.site_id[\s\S]+attendance_date: filters\.attendance_date/, "Lock sends explicit company/site/attendance_date contract");
assert.doesNotMatch(attendancePage, /Unlock reason" : "Lock reason"/, "Lock no longer prompts for a reason");
assert.doesNotMatch(attendancePage, /reason,\s*\n\s*\}\),\s*\n\s*\}\);\s*\n\s*const payload = await response\.json\(\);\s*\n\s*if \(!response\.ok\) return setMessage\(payload\.error \|\| "Could not update lock\."\);\s*\n\s*setMessage\("Day locked\."\)/, "Lock request does not send a user-entered reason");
assert.match(attendancePage, /const canUnlock = global \|\| can\(permissions, "labour_attendance_unlock", "approve"\)/, "Unlock button uses dedicated unlock permission");
assert.match(attendancePage, /setUnlockDialogOpen\(true\)/, "Unlock opens a confirmation dialog");
assert.match(attendancePage, /Reason for Unlock/, "Unlock dialog captures reason");
assert.match(attendancePage, /Enter a reason of at least 10 characters to unlock attendance\./, "Unlock UI enforces meaningful reason message");
assert.match(attendancePage, /const reason = unlockReason\.trim\(\)/, "Unlock trims reason before sending");
assert.doesNotMatch(attendancePage, /[{,]\s*date:\s*filters\.attendance_date/, "Lock does not send legacy date field");
assert.doesNotMatch(attendancePage, /organization_id: filters\.organization_id/, "Lock does not send organization_id from the browser");
assert.match(attendanceDayLockApi, /const requestedOrganizationId = text\(payload\.organization_id\)/, "Day lock keeps organization optional and server-derived");
assert.match(attendanceDayLockApi, /const attendanceDate = isoDate\(payload\.attendance_date\)/, "Day lock reads attendance_date");
assert.doesNotMatch(attendanceDayLockApi, /isoDate\(payload\.date\)/, "Day lock does not read legacy date");
assert.match(attendanceDayLockApi, /const organizationId = scopeCheck\.organizationId/, "Day lock resolves organization from validated company/site");
assert.doesNotMatch(attendanceDayLockApi, /Labour attendance can be locked only after day end in IST\./, "Day lock no longer uses generic calendar-day-end message");
assert.match(attendanceDayLockApi, /attendanceDate > todayInIst\(\)/, "Future attendance lock blocker remains explicit");
assert.match(attendanceDayLockApi, /getActiveAttendancePolicy/, "Day lock loads the active Attendance Policy");
assert.match(attendanceDayLockApi, /labourPolicyLockCutoff/, "Day lock uses the centralized policy cutoff calculator");
assert.match(attendanceDayLockApi, /Configure Muster Configuration before locking attendance for this site\./, "Day lock blocks missing policy with clear message");
assert.match(attendanceDayLockApi, /Attendance can be locked after \$\{formatIstTime\(lockCutoff\)\} IST as per the Attendance Policy\./, "Day lock returns dynamic policy cutoff message");
assert.match(attendanceDayUnlockApi, /const attendanceDate = isoDate\(payload\.attendance_date\)/, "Day unlock reads attendance_date");
assert.doesNotMatch(attendanceDayUnlockApi, /isoDate\(payload\.date\)/, "Day unlock does not read legacy date");
assert.match(attendanceDayUnlockApi, /const organizationId = scopeCheck\.organizationId/, "Day unlock resolves organization from validated company/site");
assert.match(attendanceDayUnlockApi, /requireLabourPermission\(request, "labour_attendance_unlock", "approve"\)/, "Day unlock API uses dedicated unlock permission");
assert.doesNotMatch(attendanceDayUnlockApi, /Only Platform Owner or Super Admin can unlock labour attendance days\./, "Day unlock is not hardcoded to Platform Owner or Super Admin only");
assert.match(attendanceDayUnlockApi, /reason\.length < 10/, "Day unlock API rejects blank or short reasons");
assert.match(attendanceDayUnlockApi, /moduleCode: "labour_attendance_unlock"/, "Day unlock audit uses dedicated unlock module");
assert.match(attendanceDayUnlockApi, /unlock_reason: reason/, "Day unlock persists exact trimmed reason");
assert.match(attendanceDayLockApi, /newValues: \{ contractor_profile_id: contractorProfileId, source: "manual" \}/, "Day lock audit records manual source without user-entered reason");
assert.match(attendanceImportUploadApi, /validateLabourCompanySiteIndependent/, "Attendance import upload uses Labour independent company-site validation");
assert.match(labourLookupsApi, /purpose === "labour_attendance"/, "Labour lookups expose deployment-aware attendance purpose");
assert.match(labourLookupsApi, /purpose === "labour_attendance"[\s\S]+loadResolvedLabourSitePairs\(access\)/, "Attendance lookups use the shared Labour Company/Site resolver");
assert.match(labourShared, /from\("companies"\)[\s\S]+from\("sites"\)[\s\S]+from\("labour_site_attendance_policies"\)/, "Shared resolver starts from active companies, active sites and site-level attendance policies");
assert.match(labourShared, /company_site_pairs: Array\.from\(pairMap\.values\(\)\)/, "Attendance lookup exposes compatibility pairs from independent Company/Site options");
assert.doesNotMatch(labourLookupsApi, /pairMap\.set\(`\$\{site\.company_id\}:\$\{site\.id\}`/, "Attendance lookup does not build pairs from site.company_id");
assert.doesNotMatch(labourLookupsApi, /company_name ===|company_code ===|site_name ===|site_code ===/, "Attendance lookup does not match company/site by labels or codes");
assert.match(labourLookupsApi, /if \(selectedCompanyId && selectedSiteId\)[\s\S]+loadEligibleDeployments/, "Attendance contractor lookup waits for selected company and site");
assert.match(labourLookupsApi, /loadEligibleDeployments[\s\S]+contractorMap/, "Attendance contractors remain deployment-aware");
assert.match(attendancePage, /params\.set\("company_id", filters\.company_id\)/, "Daily attendance lookup sends selected company for contractor filtering");
assert.match(attendancePage, /params\.set\("site_id", filters\.site_id\)/, "Daily attendance lookup sends selected site for contractor filtering");
assert.match(attendancePage, /params\.set\("attendance_date", filters\.attendance_date\)/, "Daily attendance Load sends attendance_date in the GET query string");
assert.doesNotMatch(attendancePage, /params\.set\("work_order_id"/, "Daily attendance page no longer sends a Work Order filter");
assert.doesNotMatch(attendancePage, /params\.set\("trade_id"/, "Daily attendance page no longer sends a Labour Category filter");
assert.doesNotMatch(attendancePage, /new URLSearchParams\(filters as any\)/, "Daily attendance Load does not serialize stale internal filter names blindly");
assert.match(attendancePage, /Select a company\./, "Daily attendance has a specific missing-company client message");
assert.match(attendancePage, /Select a site\./, "Daily attendance has a specific missing-site client message");
assert.match(attendancePage, /Select an attendance date\./, "Daily attendance has a specific missing-date client message");
assert.doesNotMatch(attendancePage, /params\.set\("contractor_profile_id", filters\.contractor_profile_id\)[\s\S]+else/, "All Contractors does not send a placeholder contractor filter");
assert.match(attendanceApi, /searchParams\.get\("attendance_date"\)/, "Daily attendance GET reads attendance_date");
assert.doesNotMatch(attendanceApi, /searchParams\.get\("date"\)/, "Daily attendance GET does not read the old date query parameter");
assert.match(attendanceApi, /const requestedOrganizationId = text\(searchParams\.get\("organization_id"\)\)/, "Daily attendance keeps organization optional and server-derived");
assert.match(attendanceApi, /const organizationId = scopeCheck\.organizationId/, "Daily attendance uses organization resolved by server-side company/site validation");
assert.doesNotMatch(attendanceApi, /Organization is required\./, "Daily attendance does not require client-supplied organization for global users");
assert.match(attendanceApi, /Attendance date must be in YYYY-MM-DD format\./, "Daily attendance GET rejects malformed attendance dates clearly");
assert.match(attendancePage, /const filteredSites = useMemo\(\(\) => lookups\.sites \|\| \[\]/, "Daily attendance site dropdown uses the full permitted site list");
assert.doesNotMatch(attendancePage, /company_site_pairs|pair\.company_id|allowedSiteIds/, "Daily attendance page does not filter sites by company-site pairs");
assert.match(attendancePage, /No eligible deployed labourers found for this Site\/date\./, "Daily attendance page shows the all-contractors empty deployment message");
assert.match(attendancePage, /No eligible labourers found under the selected Contractor for this Site\/date\./, "Daily attendance page shows the selected-contractor empty deployment message");
assert.match(attendancePage, /attendance_date: e\.target\.value, contractor_profile_id: ""/, "Changing date refreshes contractors without clearing company/site");
assert.match(attendancePage, /company_id: e\.target\.value, contractor_profile_id: ""/, "Changing company refreshes contractors without clearing site");
assert.doesNotMatch(attendancePage, /company_id: e\.target\.value, site_id: ""/, "Changing company does not clear the selected site");
assert.match(attendancePage, /No permitted sites available/, "Daily attendance site dropdown shows a disabled empty-state placeholder");
assert.doesNotMatch(attendancePage, /site\.company_id === filters\.company_id/, "Daily attendance page does not use static site.company_id filtering");
assert.doesNotMatch(attendancePage, /Direct Labour/, "Daily attendance page does not show obsolete Direct Labour wording");
assert.match(attendancePage, /Contractor not available/, "Daily attendance page has a neutral missing-contractor fallback");
assert.match(musterPage, /purpose=labour_attendance&attendance_date=\$\{filters\.month\}-01/, "Muster page uses deployment-aware attendance lookups");
assert.doesNotMatch(musterPage, /Direct Labour/, "Muster page does not show obsolete Direct Labour wording");
assert.doesNotMatch(musterApi, /worker_type === "direct_labour"/, "Muster export does not infer Direct Labour from worker_type");
assert.match(musterApi, /labelFromCode\(row\.commercial_model\)/, "Muster export outputs readable payment model from deployment context");

assert.match(wageCalcApi, /Contract Basis — Paid through Commercial WO \/ RA Bill/, "Contract-basis wage lines must not be calculated as payroll");
assert.match(wageCalcApi, /approved_overtime_minutes \?\? row\.overtime_minutes/, "Wage calculation must prefer approved OT");
assert.match(wageCalcApi, /shiftHoursFromTimes/, "Wage calculation must convert approved OT hours into OT days using Attendance Policy shift hours");
assert.doesNotMatch(wageCalcApi, /\.from\("labour_advances"\)/, "New wage calculation no longer auto-deducts worker-specific advances");
assert.match(wageCalcApi, /const recovery = 0/, "New wage calculation keeps advance recovery at zero unless an approved wage-level flow is added");
assert.doesNotMatch(wageCalcApi, /overtimeRate: rate\.overtime_rate/, "Wage calculation must not use separate overtime rates");

assert.match(workLogApi, /Work Description is required\./, "Productive Daily Work must require activity/description");
assert.match(workLogApi, /Unit is required for Productive work\./, "Productive Daily Work must require unit when quantity is entered");
assert.match(workLogApi, /Work Description is required\./, "Non-productive Daily Work must require reason/description");
assert.doesNotMatch(workLogApi, /Non-productive work requires a reason and remarks/, "Non-productive work logs must not require remarks");

assert.equal(calculateDailyWageLine({ status: "present", dailyRate: 900, shiftHours: 8, approvedOvertimeMinutes: 120 }).gross_payable, 1125, "Present plus approved OT pays daily rate by attendance days plus OT days");
assert.equal(calculateDailyWageLine({ status: "half_day", dailyRate: 900, approvedOvertimeMinutes: 0 }).gross_payable, 450, "Half day is half daily wage");
assert.equal(calculateDailyWageLine({ status: "present", dailyRate: 1000, contractorProfitType: "percentage", contractorProfitValue: 10 }).gross_payable, 1100, "Percentage contractor profit should apply to payable wage");
assert.equal(overlaps("2026-01-01", null, "2026-07-01", null), true, "Open rate overlaps later open rate");
assert.equal(overlaps("2026-01-01", "2026-06-30", "2026-07-01", null), false, "Closed historical rate should not overlap future rate");

console.log("Labour Management V2 rule tests passed.");
