import fs from 'node:fs';
import assert from 'node:assert/strict';

const route = fs.readFileSync('app/api/admin/users/[id]/route.ts', 'utf8');
const helper = fs.readFileSync('lib/serverUserDeactivation.ts', 'utf8');
const page = fs.readFileSync('app/admin/users/page.tsx', 'utf8');
const access = fs.readFileSync('lib/serverAccountAccess.ts', 'utf8');

assert.match(route, /findActiveUserResponsibilities/);
assert.match(route, /profiles[\s\S]+status: "inactive"/);
assert.match(route, /\.update\(\{ status: "inactive" \}\)/);
assert.doesNotMatch(route, /\.update\(\{ status: "inactive", updated_at:/);
assert.match(route, /revokeUserAccess/);
assert.match(route, /removal_type: "deactivated"/);
assert.doesNotMatch(route, /auth\.admin\.deleteUser/);
assert.match(helper, /site_hr_assignments/);
assert.match(helper, /labour_site_configurations/);
assert.match(helper, /labour_site_override_authorities/);
assert.match(helper, /labour_site_in_engineer_assignments/);
assert.match(helper, /employee_attendance_post_lock_editors/);
assert.match(helper, /purchase_requisition_approval_layers/);
assert.match(helper, /user_roles/);
assert.match(helper, /user_permissions/);
assert.match(helper, /user_access_assignments/);
assert.match(page, /Remove User/);
assert.match(page, /profile and historical records will be retained/);
assert.match(page, /messageType/);
assert.match(page, /type=\{messageType\}/);
assert.doesNotMatch(page, /message\.toLowerCase\(\)\.includes\("success"\)/);
assert.match(access, /isBlockedStatus\(profile\.status\)/);
assert.match(access, /isActiveStatus\(profile\.status\)/);

console.log('PASS: Admin Remove User deactivation contract');
