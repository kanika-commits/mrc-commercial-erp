import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/work-orders/route.ts", "utf8");
const resolver = fs.readFileSync("lib/serverNotificationRecipients.ts", "utf8");
const schema = fs.readFileSync("supabase/migrations/202608120012_user_notifications.sql", "utf8");
const identityMigration = fs.readFileSync("supabase/migrations/202610160005_user_notifications_work_order_submission.sql", "utf8");

assert.match(route, /approval_status: "pending"/);
assert.match(route, /resolveNotificationRecipients\(admin, \{[\s\S]+moduleCode: "wo_approval"[\s\S]+actionCode: "approve"/);
assert.match(route, /notification_type: "work_order_submitted_for_approval"/);
assert.match(route, /insertNotificationOnce\(admin/);
assert.match(route, /related_entity_type: "work_order"/);
assert.match(resolver, /user_permissions/);
assert.match(resolver, /role_permissions/);
assert.match(resolver, /organization_id/);
assert.match(resolver, /company_id/);
assert.match(resolver, /site_id/);
assert.match(schema, /related_entity_type text/);
assert.match(schema, /related_entity_id uuid/);
assert.match(identityMigration, /create unique index/);
assert.match(identityMigration, /organization_id,[\s\S]+recipient_user_id,[\s\S]+notification_type,[\s\S]+related_entity_type,[\s\S]+related_entity_id/);
assert.match(identityMigration, /work_order_submitted_for_approval/);
assert.match(identityMigration, /related_entity_type = 'work_order'/);
console.log("work-order submission notification contract: ok");
