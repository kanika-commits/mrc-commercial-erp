import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/202607310005_employee_attendance_policy_layers.sql", "utf8");
const policyPage = fs.readFileSync("app/settings/policies/employee-attendance/page.tsx", "utf8");
const policyApi = fs.readFileSync("app/api/hr/attendance/policy/route.ts", "utf8");
const sharedApi = fs.readFileSync("app/api/hr/attendance/_shared.ts", "utf8");
const dailyApi = fs.readFileSync("app/api/hr/attendance/daily/route.ts", "utf8");
const submitApi = fs.readFileSync("app/api/hr/attendance/periods/[id]/submit/route.ts", "utf8");
const finalizeApi = fs.readFileSync("app/api/hr/attendance/periods/[id]/finalize/route.ts", "utf8");
const sendBackApi = fs.readFileSync("app/api/hr/attendance/periods/[id]/send-back/route.ts", "utf8");

assert.match(migration, /approval_level_count integer not null default 1/, "Policy migration must add approval level count with safe default");
assert.match(migration, /check \(approval_level_count between 0 and 3\)/, "Policy migration must allow 0-3 approval levels");
assert.match(migration, /standard_working_hours integer not null default 8/, "Policy migration must preserve fixed 8-hour day");
assert.match(migration, /check \(standard_working_hours = 8\)/, "Policy migration must forbid unfinished 12-hour policy values");
assert.match(migration, /lock_after_hours integer not null default 5/, "Policy migration must add configurable lock hours");
assert.match(migration, /employee_attendance_policy_layers/, "Policy migration must add Employee approval layers");
assert.match(migration, /employee_attendance_post_lock_editors/, "Policy migration must add post-lock editor exceptions");
assert.match(migration, /employee_attendance_periods_status_check[\s\S]+level_1_approved[\s\S]+level_2_approved/, "Period statuses must support sequential approval stages");

assert.match(policyPage, /Approval Levels/, "Policy page must expose approval level count");
assert.match(policyPage, /\[0, 1, 2, 3\]/, "Policy page must expose 0-3 approval levels");
assert.match(policyPage, /Lock After Hours/, "Policy page must expose lock hours");
assert.match(policyPage, /Users Allowed to Update Locked Attendance/, "Policy page must expose user-based post-lock editors");
assert.doesNotMatch(policyPage, /Post-Lock Editor Roles|Post-Lock Editor Users|role_code|postLockRoleCodes/, "Policy page must not expose role-based post-lock editors");
assert.doesNotMatch(policyPage, /Stage Name|stage_name: layer\.stage_name|updateLayer\(index, \{ stage_name/, "Policy page must not expose editable approval stage names");
assert.match(policyPage, /Level \{layer\.level_sequence\} Approval/, "Policy page must derive approval stage names from level number");
assert.match(policyPage, /formatPostLockUsers/, "Policy page must render selected post-lock user names");
assert.match(policyPage, /Platform\/Super Admin/, "Policy page must show Platform/Super Admin when no extra users are selected");
assert.doesNotMatch(policyPage, /12 hours|12-hour|shift/i, "Policy page must not expose 12-hour or shift configuration");
assert.doesNotMatch(policyPage, /Approval Mode|Daily Attendance|Attendance Period \(Monthly\)/, "Policy page must not expose cancelled daily approval mode");

assert.match(policyApi, /approval_level_count: levelCount/, "Policy API must persist approval level count");
assert.match(sharedApi, /HR_EMPLOYEE_ATTENDANCE_POLICY_MODULE/, "Shared policy helpers must use the standalone Employee Attendance Policy module");
assert.match(policyApi, /requireAttendancePolicyView/, "Policy API reads must require Employee Attendance Policy view permission");
assert.match(policyApi, /requireAttendancePolicyWrite/, "Policy API writes must require Employee Attendance Policy add/edit permission");
assert.match(policyApi, /lock_after_hours: lockHours/, "Policy API must persist lock hours");
assert.match(policyApi, /employee_attendance_policy_layers/, "Policy API must persist approval layers");
assert.match(policyApi, /employee_attendance_post_lock_editors/, "Policy API must persist user post-lock editors");
assert.doesNotMatch(policyApi, /post_lock_role_codes|postLockRoleCodes|roles\.data|from\("roles"\)|from\("user_roles"\)/, "Policy API must not load, validate or save role-based post-lock exceptions");
assert.match(policyApi, /stage_name: `Level \$\{index \+ 1\} Approval`/, "Policy API must generate approval stage names");
assert.match(policyApi, /standard_working_hours: EMPLOYEE_STANDARD_WORKING_HOURS/, "Policy API must force the fixed 8-hour value");
assert.doesNotMatch(policyApi, /approval_mode|approvalMode/, "Policy API must not persist cancelled daily approval mode");

assert.match(sharedApi, /policySnapshot/, "Shared attendance helpers must produce approval snapshots");
assert.match(sharedApi, /isCurrentLevelApprover/, "Shared attendance helpers must enforce current-level approvers");
assert.match(sharedApi, /hasEmployeePostLockEditAuthority/, "Shared attendance helpers must enforce post-lock exceptions");
assert.match(sharedApi, /isEmployeeAttendanceLockedByPolicy/, "Shared attendance helpers must calculate policy lock cutoff");
assert.match(sharedApi, /attendance_day_end_2359_ist/, "Lock reference point must be documented in the policy snapshot");
assert.doesNotMatch(sharedApi, /sites\.company_id/, "Employee Attendance must not use sites.company_id for policy scope");
assert.doesNotMatch(sharedApi, /editor\.role_code && auth\.roleCodes/, "Post-lock enforcement must not allow role-based exceptions");
assert.doesNotMatch(sharedApi, /canReviewEmployeeAttendanceEntity|approval_mode/, "Shared attendance helpers must not depend on cancelled daily approval mode");

assert.match(dailyApi, /hasEmployeePostLockEditAuthority/, "Daily mutation API must enforce post-lock edit authority");
assert.match(dailyApi, /Reason is required for editing locked attendance/, "Locked edits must require reason");
assert.match(submitApi, /approvalLevelCount === 0 \? "finalized" : "submitted"/, "Zero approval levels must finalize on submit");
assert.match(finalizeApi, /nextApprovedStatusForLevel/, "Approval route must advance one configured level at a time");
assert.match(finalizeApi, /isCurrentLevelApprover/, "Approval route must reject wrong-level approvers");
assert.match(sendBackApi, /isCurrentLevelApprover/, "Send-back route must enforce current-level approver");

console.log("Employee attendance policy layer and lock rules passed.");
