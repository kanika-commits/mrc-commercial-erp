import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/202607270001_create_labour_site_in.sql", "utf8");
const assignmentMigration = fs.readFileSync("supabase/migrations/202607290003_create_labour_site_in_engineer_assignments.sql", "utf8");
const siteInApi = fs.readFileSync("app/api/labour/site-in/route.ts", "utf8");
const siteInPage = fs.readFileSync("app/labour/site-in/page.tsx", "utf8");
const lookupsApi = fs.readFileSync("app/api/labour/lookups/route.ts", "utf8");
const permissionMatrix = fs.readFileSync("lib/permissionMatrix.ts", "utf8");
const appShell = fs.readFileSync("components/AppShell.tsx", "utf8");
const authGuard = fs.readFileSync("components/AuthGuard.tsx", "utf8");
const attendanceApi = fs.readFileSync("app/api/labour/attendance/daily/route.ts", "utf8");
const workLogsApi = fs.readFileSync("app/api/labour/work-logs/route.ts", "utf8");

assert.match(migration, /create table if not exists public\.labour_site_ins/, "Migration creates dedicated labour_site_ins table");
assert.match(migration, /site_in_time time not null/, "Site-In stores actual IN time");
assert.match(migration, /marked_by uuid[\s\S]+marked_at timestamptz not null default now\(\)/, "Site-In stores marker and timestamp metadata");
assert.match(migration, /corrected_from_time time[\s\S]+corrected_to_time time[\s\S]+correction_reason text[\s\S]+corrected_by uuid[\s\S]+corrected_at timestamptz/, "Site-In stores correction metadata");
assert.match(migration, /labour_site_ins_worker_date_active_uidx[\s\S]+on public\.labour_site_ins \(labour_worker_id, site_in_date\)[\s\S]+where status = 'active'/, "Migration prevents duplicate active Site-In per labourer/date");
assert.match(migration, /labour_site_ins_scope_date_idx/, "Migration adds scope/date lookup index");
assert.match(migration, /alter table public\.labour_site_ins enable row level security/, "Migration enables RLS for Site-In table");
assert.match(migration, /grant all on public\.labour_site_ins to service_role/, "Server APIs can access Site-In through service role");
assert.match(migration, /\('labour_site_in', 'view'\)[\s\S]+\('labour_site_in', 'add'\)[\s\S]+\('labour_site_in', 'correct_time'\)/, "Migration seeds Site-In permissions");

assert.match(assignmentMigration, /create table if not exists public\.labour_site_in_engineer_assignments/, "Stage 1 adds worker-level engineer assignments");
assert.match(assignmentMigration, /engineer_employee_id uuid not null references public\.hr_employees\(id\)/, "Engineer assignment uses HR employees");
assert.match(assignmentMigration, /engineer_user_id uuid references public\.profiles\(id\)/, "ERP login link remains optional");
assert.match(assignmentMigration, /labour_site_in_engineer_assignments_worker_uidx/, "Duplicate active worker assignment per site/date is blocked");

assert.match(permissionMatrix, /labour_site_in: \["view", "add", "correct_time"\]/, "Permission matrix exposes Site-In view/add/correct_time");
assert.match(appShell, /navLeaf\("Site-In", "labour_site_in", "\/labour\/site-in"\)/, "Sidebar exposes Site-In in Labour workflow navigation");
assert.match(authGuard, /pathname === "\/labour\/site-in"[\s\S]+labour_site_in", "view"/, "AuthGuard maps Site-In route to labour_site_in:view");

assert.match(siteInApi, /requireLabourPermission\(request, "labour_site_in", "view"\)/, "Site-In GET requires view permission");
assert.match(siteInApi, /requireLabourPermission\(request, "labour_site_in", "add"\)/, "Site-In create requires add permission");
assert.match(siteInApi, /payload\.action === "assign_engineer"/, "Site-In API exposes worker-level engineer assignment action");
assert.match(siteInApi, /\.from\("hr_employees"\)/, "Engineer dropdown comes from HR employees");
assert.match(siteInApi, /employee_name, user_id, department_id, hr_departments\(department_name\)/, "Engineer options return employee name, department and optional linked login");
assert.match(siteInApi, /loadWorkerEngineerAssignments/, "Already assigned labour shows assigned engineer");
assert.match(siteInApi, /loadConflictingEngineerAssignments/, "Site-In validates locked saved engineer assignments server-side");
assert.match(siteInApi, /assignmentConflictResponse/, "Site-In returns clear conflict details for locked labourers");
assert.match(siteInApi, /This labourer is already assigned to another Engineer's saved team and cannot be transferred through Site-In/, "Site-In rejects normal transfer of saved engineer assignments");
assert.match(siteInApi, /status: 409/, "Saved-team transfer conflicts return HTTP 409");
assert.match(siteInApi, /preserved_site_in_time: siteIn\.site_in_time/, "Existing Site-In rows are reused without changing saved time");
assert.match(siteInApi, /loadSiteInEligibleDeployments/, "Site-In GET and POST share one eligible deployment resolver");
assert.match(siteInApi, /validateLabourCompanySiteIndependent/, "Site-In preserves Labour independent company/site validation");
assert.match(siteInApi, /loadEligibleDeployments/, "Site-In is allowed only against effective deployments");
assert.match(siteInApi, /loadContractorProfileIds/, "Site-In validates selected contractor profile filters");
assert.match(siteInApi, /This labourer's assignment changed\. Reload the Site-In list\./, "Single Site-In POST returns a reload-safe 409 when listed assignment changes");
assert.match(siteInApi, /\.eq\("labour_worker_id", labourWorkerId\)[\s\S]+\.eq\("site_in_date", siteInDate\)[\s\S]+\.eq\("status", "active"\)/, "Single Site-In API prechecks active duplicate worker/date");
assert.match(siteInApi, /error\.code === "23505"[\s\S]+already Site-In/, "Site-In API handles database duplicate protection");
assert.match(siteInApi, /requireLabourPermission\(request, "labour_site_in", "correct_time"\)/, "Site-In correction requires dedicated correct_time permission");
assert.match(siteInApi, /hasServerPermission\(access, "labour_site_in", "correct_time"\)/, "Site-In GET computes correction capability from server permissions");
assert.match(siteInApi, /can_correct_time: Boolean\(siteIn && canCorrectTime\)/, "Correction capability appears only for saved Site-In rows");
assert.match(siteInApi, /reason\.length < 10/, "Site-In correction requires meaningful reason");
assert.doesNotMatch(siteInApi, /payload\.action === "assign_groups"/, "Old group assignment action is removed");
assert.doesNotMatch(siteInApi, /Remove this labourer from the temporary team before changing the assigned engineer\./, "Dormant temporary teams must not block Site-In engineer reassignment");
assert.doesNotMatch(siteInApi, /\.from\("labour_work_groups"\)\.insert/, "Site-In still does not create labour groups");
assert.doesNotMatch(siteInApi, /\.from\("labour_work_group_members"\)\.insert/, "Site-In still does not create group members");
assert.doesNotMatch(siteInApi, /\.from\("labour_work_group_members"\)/, "Site-In does not depend on dormant temporary-team membership");
assert.doesNotMatch(siteInApi, /work_order_id|manpower_work_order_id/, "Site-In validation does not require Commercial WO or MWO linkage");
assert.doesNotMatch(siteInApi, /\.from\("profiles"\)[\s\S]+loadEngineerOptions/, "Engineer dropdown is not sourced from ERP users");

assert.match(siteInPage, /Site HR assigns labourers to engineers during Site-In/, "Site-In page explains the new Stage 1 flow");
assert.match(siteInPage, /All Contractors/, "Site-In page supports All Contractors filter");
assert.match(siteInPage, /Engineer/, "Site-In page includes the engineer control in the top filter row");
assert.match(siteInPage, /engineer_employee_id: assignedEngineerId/, "Site-In save sends HR employee engineer ID");
assert.match(siteInPage, /params\.set\("engineer_employee_id", assignedEngineerId\)/, "Site-In available-labour load is scoped to the selected engineer");
assert.match(siteInPage, /if \(!assignedEngineerId\) return setMessage\("Select an engineer\."\)/, "Site-In requires engineer before loading available labour");
assert.match(siteInPage, /setSelectedWorkerIds\([\s\S]+assigned_engineer_employee_id === assignedEngineerId[\s\S]+labour_worker_id/, "Saved labourers for the selected engineer are preselected after reload");
assert.match(siteInPage, />Saved</, "Saved engineer assignments are visibly marked in Site-In");
assert.match(siteInPage, /labour_worker_ids: selectedWorkerIds/, "Site-In save sends selected workers for server-side deployment validation");
assert.match(siteInPage, /Assigned Engineer/, "Site-In table shows Assigned Engineer");
assert.match(siteInPage, /assigned_engineer_label/, "Already assigned labour displays assigned engineer");
assert.match(siteInPage, /has no ERP login/, "Employee without ERP login remains selectable with a clear warning");
assert.match(siteInPage, /Correct Time/, "Site-In page preserves correction action");
assert.match(siteInPage, /canCorrectTime && row\.can_correct_time/, "Correction button requires client and server permission");
assert.match(siteInPage, /purpose: "labour_site_in"/, "Site-In contractor dropdown uses Site-In lookup purpose");
assert.match(siteInPage, /params\.set\("site_in_date", filters\.site_in_date\)/, "Site-In contractor lookup is date-effective");
assert.match(siteInPage, /\[filters\.company_id, filters\.site_id, filters\.site_in_date\]/, "Site-In reloads contractors when company, site or date changes");
assert.match(siteInPage, /lookupAbortRef\.current\?\.abort\(\)/, "Site-In contractor lookup aborts stale requests");
assert.match(siteInPage, /method: "PATCH"/, "Correction uses API permission validation rather than inline editing");
assert.doesNotMatch(siteInPage, /Create New Group|Add to Existing Group|Group Status|Site-In and Assign to Group|Saving Site-In and Groups/, "Group UI is removed");
assert.doesNotMatch(siteInPage, /\/api\/labour\/attendance\/daily/, "Site-In page does not call Attendance APIs");
assert.doesNotMatch(siteInPage, /\/api\/labour\/work-logs/, "Site-In page does not call Daily Work APIs");

assert.match(lookupsApi, /purpose === "labour_site_in" \? "labour_site_in"/, "Site-In lookup requires labour_site_in:view permission");
assert.match(lookupsApi, /purpose === "labour_site_in"[\s\S]+loadDeploymentContractorsForCompanySiteDate/, "Site-In contractor options come from effective labour deployments");
assert.match(lookupsApi, /loadEligibleDeployments\(access,[\s\S]+effectiveDate/, "Site-In contractor lookup applies deployment effective-date rules");
assert.match(siteInPage, /params\.set\("contractor_profile_id", filters\.contractor_profile_id\)/, "Site-In Load filters by selected contractor profile");

assert.match(attendanceApi, /from\("labour_site_ins"\)/, "Attendance eligibility starts from active Site-In records");
assert.match(workLogsApi, /from\("labour_site_ins"\)/, "Daily Work eligibility starts from active Site-In records");
assert.doesNotMatch(workLogsApi, /from\("labour_attendance"\)/, "Daily Work remains independent from Attendance rows");

console.log("Labour Site-In rule tests passed.");
