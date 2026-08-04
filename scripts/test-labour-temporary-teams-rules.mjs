import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/202607300002_add_labour_temporary_team_employee_owner.sql", "utf8");
const teamsApi = fs.readFileSync("app/api/labour/teams/route.ts", "utf8");
const teamPatchApi = fs.readFileSync("app/api/labour/teams/[id]/route.ts", "utf8");
const teamsPage = fs.readFileSync("app/labour/teams/page.tsx", "utf8");
const siteInApi = fs.readFileSync("app/api/labour/site-in/route.ts", "utf8");
const appShell = fs.readFileSync("components/AppShell.tsx", "utf8");
const authGuard = fs.readFileSync("components/AuthGuard.tsx", "utf8");
const permissionMatrix = fs.readFileSync("lib/permissionMatrix.ts", "utf8");
const defaultNavigation = fs.readFileSync("lib/defaultModuleNavigation.ts", "utf8");
const labourImportFiles = [
  "app/api/labour/import/upload/route.ts",
  "app/api/labour/import/execute/route.ts",
  "app/labour/workers/import/page.tsx",
].map((file) => fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");

assert.match(migration, /add column if not exists engineer_employee_id uuid references public\.hr_employees\(id\)/, "Migration adds employee ownership to existing work groups");
assert.match(migration, /group_type = 'engineer_group'/, "New uniqueness is scoped to temporary engineer teams");
assert.match(migration, /labour_temporary_teams_number_uidx[\s\S]+engineer_employee_id, group_number/, "Team numbering is per engineer/date/site");
assert.match(migration, /'labour_engineer_groups', 'view'[\s\S]+'labour_engineer_groups', 'create'[\s\S]+'labour_engineer_groups', 'edit'[\s\S]+'labour_engineer_groups', 'delete'/, "Required team permissions are seeded for system roles");
assert.doesNotMatch(migration, /create table .*labour_.*teams/i, "Phase 3 reuses existing group tables and does not create a parallel team table");

assert.match(permissionMatrix, /labour_engineer_groups: \["view", "create", "edit", "delete"\]/, "Permission matrix exposes temporary team actions");
assert.match(teamsApi, /requireLabourPermission\(request, "labour_engineer_groups", "view"\)/, "GET requires team view permission");
assert.match(teamsApi, /requireLabourPermission\(request, "labour_engineer_groups", "create"\)/, "POST requires team create permission");
assert.match(teamPatchApi, /requireLabourPermission\(request, "labour_engineer_groups", permissionAction\)/, "PATCH requires edit/delete by action");
assert.match(teamsApi, /resolveSiteAttendanceSystem/, "Teams enforce attendance-system policy");
assert.match(teamsApi, /This site uses Standard Labour Attendance\. Temporary Teams are not required\./, "System 1 sites are rejected");
assert.match(teamsApi, /if \(!system\.ok\) return \{ error: system\.message/, "Missing attendance policy is rejected through shared helper message");

assert.match(teamsApi, /\.from\("labour_site_in_engineer_assignments"\)/, "Eligibility starts from Site-In engineer assignments");
assert.match(teamsApi, /\.eq\("engineer_employee_id", engineerEmployeeId\)/, "Engineer sees only their assigned workers");
assert.match(teamsApi, /\.from\("hr_employees"\)[\s\S]+\.eq\("user_id", access\.auth\.user\.id\)/, "Engineer login resolves through linked HR employee");
assert.match(teamsApi, /isGlobalOrSuperAdmin\(access\)/, "Platform Owner/Super Admin may select engineers");
assert.match(teamsApi, /engineer_user_id: engineer\.user_id \|\| null/, "Employee without ERP login remains a valid admin-selected assignment owner");
assert.match(teamsApi, /loadEligibleDeployments/, "Team creation confirms current effective deployment");
assert.match(teamsApi, /loadActiveMemberships/, "Team creation checks duplicate active memberships");
assert.match(teamsApi, /labour_engineer_group_members_worker_day_uidx|already in another temporary team/, "Duplicate membership returns a clear conflict");
assert.match(teamsApi, /attendance_id: null/, "Team creation does not create or require Attendance rows");
assert.doesNotMatch(teamsApi, /from\("labour_attendance"\)/, "Temporary team API has no Attendance dependency");
assert.match(teamsApi, /commercial_work_order_id: null[\s\S]+manpower_work_order_id: null/, "Temporary teams leave reused Work Order/MWO columns empty");
assert.doesNotMatch(teamsApi, /validateWorkOrder|validateMwo|Selected Work Order|Selected Manpower Work Order/, "Temporary team API has no Work Order/MWO validation dependency");
assert.doesNotMatch(teamsApi, /labour_daily_work_logs/, "Temporary team API has no Daily Work dependency");

assert.match(teamPatchApi, /action === "rename"/, "PATCH supports rename");
assert.match(teamPatchApi, /action === "add_members"/, "PATCH supports adding eligible members");
assert.match(teamPatchApi, /action === "remove_members"/, "PATCH supports member removal");
assert.match(teamPatchApi, /action === "cancel"/, "PATCH supports cancellation");
assert.match(teamPatchApi, /status: "cancelled"/, "Cancel/remove preserves history by cancelling rows");
assert.match(teamPatchApi, /You can manage only your own temporary teams/, "Direct API access cannot bypass engineer ownership");

assert.match(siteInApi, /Remove this labourer from the temporary team before changing the assigned engineer\./, "Site-In reassignment is blocked when active team membership exists");
assert.match(siteInApi, /payload\.action === "assign_engineer"/, "Phase 2 Site-In assignment action remains unchanged");
assert.doesNotMatch(siteInApi, /payload\.action === "assign_groups"/, "Site-In still does not create groups");

assert.match(teamsPage, /Temporary Teams/, "Temporary Teams page exists");
assert.match(teamsPage, /Unassigned Labour/, "UI shows unassigned eligible labour");
assert.match(teamsPage, /Existing Temporary Teams|No temporary teams/, "UI shows existing temporary teams");
assert.match(teamsPage, /Create Team/, "UI supports team creation");
assert.match(teamsPage, /Remove team member/, "UI supports member removal");
assert.match(teamsPage, /Cancel/, "UI supports team cancellation");
assert.match(teamsPage, /currentEngineer/, "Engineer context is visible/resolved");

assert.match(appShell, /navLeaf\("Temporary Teams", "labour_engineer_groups", "\/labour\/teams"\)/, "Sidebar exposes Temporary Teams");
assert.match(authGuard, /pathname === "\/labour\/teams"[\s\S]+labour_engineer_groups", "view"/, "AuthGuard protects Temporary Teams route");
assert.match(defaultNavigation, /module_code: "labour_engineer_groups"[\s\S]+route: "\/labour\/teams"/, "Default navigation points Temporary Teams to the new route");

for (const source of labourImportFiles) {
  assert.doesNotMatch(source, /labour_engineer_groups|\/labour\/teams/, "Labour Import files are not coupled to Temporary Teams");
}

console.log("Labour Temporary Teams rule tests passed.");
