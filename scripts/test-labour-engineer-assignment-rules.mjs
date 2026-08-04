import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/202607290003_create_labour_site_in_engineer_assignments.sql", "utf8");
const siteInApi = fs.readFileSync("app/api/labour/site-in/route.ts", "utf8");
const siteInPage = fs.readFileSync("app/labour/site-in/page.tsx", "utf8");
const workLogsApi = fs.readFileSync("app/api/labour/work-logs/route.ts", "utf8");

assert.match(migration, /create table if not exists public\.labour_site_in_engineer_assignments/, "Migration creates worker-level Site-In engineer assignment table");
assert.match(migration, /engineer_employee_id uuid not null references public\.hr_employees\(id\)/, "Assignment stores HR employee engineer identity");
assert.match(migration, /engineer_user_id uuid references public\.profiles\(id\)/, "Assignment optionally stores linked ERP profile");
assert.match(migration, /labour_site_in_engineer_assignments_worker_uidx[\s\S]+site_in_date, labour_worker_id/, "One active engineer assignment per labourer/site/date is enforced");
assert.match(migration, /site_in_id uuid not null references public\.labour_site_ins\(id\)/, "Assignment links to the exact Site-In row");
assert.doesNotMatch(migration, /\bcreated_by\b/, "Assignment table does not define created_by audit columns");
assert.match(migration, /assigned_by uuid[\s\S]+assigned_at timestamptz not null default now\(\)/, "Assignment creation audit uses assigned_by/assigned_at");
assert.match(migration, /updated_by uuid[\s\S]+updated_at timestamptz not null default now\(\)/, "Assignment update audit uses updated_by/updated_at");
assert.match(migration, /grant all on public\.labour_site_in_engineer_assignments to service_role/, "Server APIs can access the assignment table");

assert.match(siteInApi, /\.from\("hr_employees"\)[\s\S]+\.eq\("company_id", input\.companyId\)[\s\S]+\.eq\("site_id", input\.siteId\)/, "Engineer dropdown loads HR employees for selected company/site");
assert.match(siteInApi, /employee_name, user_id, department_id, hr_departments\(department_name\)/, "Engineer dropdown returns name, department and optional linked user");
assert.doesNotMatch(siteInApi, /\.from\("profiles"\)[\s\S]+loadEngineerOptions/, "Site-In engineer options must not be sourced from ERP users");
assert.doesNotMatch(siteInApi, /hasPermission\(userId, "labour_work_logs"/, "HR employee engineers do not require Daily Work permissions for selection");
assert.match(siteInApi, /payload\.action === "assign_engineer"/, "Site-In saves explicit worker-level engineer assignments");
assert.match(siteInApi, /requireLabourPermission\(request, "labour_site_in", "add"\)/, "Stage 1 assignment remains a Site-In add action");
assert.match(siteInApi, /loadWorkerEngineerAssignments/, "Site-In reads existing worker-level engineer assignments");
assert.match(siteInApi, /loadConflictingEngineerAssignments/, "Site-In rejects labourers already locked to another saved engineer assignment");
assert.match(siteInApi, /\.from\("labour_site_in_engineer_assignments"\)/, "Site-In writes worker-level engineer assignments");
assert.match(siteInApi, /preserved_site_in_time: siteIn\.site_in_time/, "Existing Site-In time is preserved when assigning engineer later");
assert.match(siteInApi, /if \(existingAssignment\)[\s\S]+\.update\(assignmentPayload\)/, "Existing worker assignment is updated instead of duplicated");
assert.match(siteInApi, /if \(existingAssignment\.engineer_employee_id !== engineerEmployeeId\)[\s\S]+assignmentConflictResponse/, "Existing assignment updates are limited to the same engineer");
assert.match(siteInApi, /This labourer is already assigned to another Engineer's saved team and cannot be transferred through Site-In/, "Normal Site-In flow cannot transfer saved engineer assignments");
assert.doesNotMatch(siteInApi, /labour_site_in_engineer_assignments"[\s\S]{0,400}\.\.\.actorFields\(access\.auth, "created"\)/, "Assignment inserts do not send unsupported created_by columns");
assert.match(siteInApi, /const insertPayload = \{[\s\S]+assigned_by: access\.auth\.user\.id,[\s\S]+assigned_at: nowForAssignments,[\s\S]+\};[\s\S]+\.from\("labour_site_in_engineer_assignments"\)[\s\S]+\.insert\(insertPayload\)/, "New assignment insert uses only real assignment audit columns");
assert.match(siteInApi, /engineer_user_id: engineer\.user_id \|\| null/, "Employee without ERP login is still assignable");
assert.doesNotMatch(siteInApi, /payload\.action === "assign_groups"/, "Old group assignment action is removed from Site-In");
assert.doesNotMatch(siteInApi, /Remove this labourer from the temporary team before changing the assigned engineer\./, "Dormant temporary teams must not block Site-In reassignment");
assert.doesNotMatch(siteInApi, /\.from\("labour_work_groups"\)\.insert/, "Site-In must not create labour work groups");
assert.doesNotMatch(siteInApi, /\.from\("labour_work_group_members"\)\.insert/, "Site-In must not create group members");
assert.doesNotMatch(siteInApi, /\.from\("labour_work_group_members"\)/, "Site-In must not depend on dormant temporary-team membership");

assert.match(siteInPage, /Site HR assigns labourers to engineers during Site-In/, "Site-In subtitle explains Stage 1 engineer assignment");
assert.match(siteInPage, /engineer_employee_id: assignedEngineerId/, "Site-In sends selected HR employee engineer ID");
assert.match(siteInPage, /params\.set\("engineer_employee_id", assignedEngineerId\)/, "Site-In load passes selected engineer for available-list filtering");
assert.match(siteInPage, /disabled=\{actionInProgress \|\| lookupLoading \|\| workflowBlocked \|\| !assignedEngineerId\}/, "Site-In disables Load Labour until engineer is selected");
assert.match(siteInPage, /Site In/, "Primary action is Site In");
assert.match(siteInPage, /Assigned Engineer/, "Table shows Assigned Engineer");
assert.match(siteInPage, /assigned_engineer_label/, "Already assigned labour displays the assigned engineer");
assert.match(siteInPage, /has no ERP login/, "UI warns when selected engineer lacks ERP login");
assert.doesNotMatch(siteInPage, /Create New Group|Add to Existing Group|Group Status|Site-In and Assign to Group|Saving Site-In and Groups/, "Group UI is removed from Site-In");

assert.match(workLogsApi, /from\("labour_site_ins"\)/, "Daily Work remains Site-In based");
assert.doesNotMatch(workLogsApi, /from\("labour_attendance"\)/, "Daily Work remains independent from Attendance");

console.log("Labour Engineer Assignment rule tests passed.");
