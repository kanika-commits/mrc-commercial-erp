import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/202607290001_labour_engineer_groups_phase2.sql", "utf8");
const siteInApi = fs.readFileSync("app/api/labour/site-in/route.ts", "utf8");
const siteInPage = fs.readFileSync("app/labour/site-in/page.tsx", "utf8");
const permissionMatrix = fs.readFileSync("lib/permissionMatrix.ts", "utf8");
const attendanceApi = fs.readFileSync("app/api/labour/attendance/daily/route.ts", "utf8");
const workLogsApi = fs.readFileSync("app/api/labour/work-logs/route.ts", "utf8");
const approvalsApi = fs.readFileSync("app/api/labour/approvals/route.ts", "utf8");

assert.match(migration, /add column if not exists engineer_user_id uuid references public\.profiles\(id\) on delete restrict/, "Groups store the responsible ERP profile/user");
assert.match(migration, /add column if not exists group_number integer/, "Groups store display-only group number");
assert.match(migration, /add column if not exists group_label text/, "Groups can persist display label");
assert.match(migration, /add column if not exists group_type text not null default 'engineer_group'/, "New rows are isolated as engineer groups");
assert.match(migration, /labour_engineer_groups_number_uidx[\s\S]+where group_type = 'engineer_group'/, "Group-number uniqueness is scoped to engineer groups");
assert.match(migration, /labour_engineer_group_members_worker_day_uidx[\s\S]+where status = 'active'/, "A worker can belong to one active group per site/date");
assert.match(migration, /contractor_profile_id uuid references public\.labour_contractor_profiles\(id\) on delete restrict/, "Members carry contractor context for validation/audit");
assert.match(migration, /site_in_id uuid references public\.labour_site_ins\(id\) on delete restrict/, "Members link to the exact Site-In row");
assert.match(migration, /site_in_time_snapshot time/, "Members snapshot individual Site-In time");
assert.doesNotMatch(migration, /transfer|reassign|move_member|change_engineer/i, "Phase 2 migration does not introduce transfer or reassignment concepts");

assert.match(permissionMatrix, /labour_engineer_groups: \["view", "create"\]/, "Permission matrix includes only view/create for engineer groups");
assert.doesNotMatch(permissionMatrix, /labour_engineer_groups: \[[^\]]*(transfer|reassign|move|change_engineer)/, "Engineer groups do not expose reassignment permissions");

assert.match(siteInApi, /payload\.action === "assign_groups"/, "Site-In API implements one batch group assignment action");
assert.match(siteInApi, /requireLabourPermission\(request, "labour_site_in", "add"\)/, "Batch save preserves Site-In add permission");
assert.match(siteInApi, /hasServerPermission\(access, "labour_engineer_groups", "create"\)/, "Batch save enforces engineer group create permission server-side");
assert.match(siteInApi, /validateEngineerCandidate/, "Engineer selection is revalidated server-side");
assert.match(siteInApi, /\.eq\("status", "active"\)[\s\S]+profiles/, "Engineer candidates require active ERP profiles");
assert.match(siteInApi, /loadSiteInEligibleDeployments/, "Batch save starts from effective deployment eligibility");
assert.match(siteInApi, /loadActiveGroupMemberships/, "Batch save checks active existing memberships before insert");
assert.match(siteInApi, /workersByContractor/, "Batch save groups selected workers by contractor");
assert.match(siteInApi, /createEngineerGroup/, "Create New Group path creates groups server-side");
assert.match(siteInApi, /groupMode === "existing_group" && workersByContractor\.size > 1/, "Existing-group path rejects mixed contractors");
assert.match(siteInApi, /preserved_site_in_time: siteIn\.site_in_time/, "Existing Site-In time is preserved");
assert.match(siteInApi, /site_in_time_snapshot: siteIn\.site_in_time/, "Member rows snapshot Site-In time");
assert.match(siteInApi, /error\.code === "23505"[\s\S]+already assigned to another group/, "Unique membership conflicts return a clear duplicate assignment error");
assert.doesNotMatch(siteInApi, /full_aadhaar|aadhaar_number/, "Engineer group audit path does not log Aadhaar");

assert.match(siteInPage, /Select checkbox|aria-label=\{`Select/, "Site-In page renders row selection controls");
assert.match(siteInPage, /Labour Name[\s\S]+Labour Code[\s\S]+Contractor[\s\S]+Category[\s\S]+Daily Rate[\s\S]+Site-In Status[\s\S]+Group Status/, "Site-In table contains the approved Phase 2 columns");
assert.match(siteInPage, /Create New Group/, "Site-In page supports creating groups");
assert.match(siteInPage, /Add to Existing Group/, "Site-In page supports adding to compatible groups");
assert.match(siteInPage, /selectedGroupsPreview/, "Create New Group previews contractor-separated groups");
assert.match(siteInPage, /compatibleExistingGroups/, "Existing Group options are filtered client-side by engineer and contractor");
assert.match(siteInPage, /selectedContractorIds\.length > 1/, "UI blocks existing-group assignment for mixed contractors");
assert.match(siteInPage, /Site-In and Assign to Group/, "Primary action matches approved wording");
assert.match(siteInPage, /Saving Site-In and Groups\.\.\./, "Saving state matches approved wording");
assert.match(siteInPage, /row\.selectable/, "Already-grouped workers are not selectable");
assert.doesNotMatch(siteInPage, /\/api\/labour\/attendance\/daily/, "Phase 2 Site-In UI does not call Attendance");
assert.doesNotMatch(siteInPage, /\/api\/labour\/work-logs/, "Phase 2 Site-In UI does not call Daily Work");

assert.doesNotMatch(attendanceApi, /labour_engineer_groups|group_number|group_type/, "Attendance API was not moved to engineer groups in Phase 2");
assert.doesNotMatch(workLogsApi, /labour_engineer_groups|group_number|group_type/, "Daily Work API was not moved to engineer groups in Phase 2");
assert.doesNotMatch(approvalsApi, /labour_engineer_groups|group_number|group_type/, "Approval API was not moved to engineer groups in Phase 2");

console.log("Labour Engineer Group Phase 2 rule tests passed.");
