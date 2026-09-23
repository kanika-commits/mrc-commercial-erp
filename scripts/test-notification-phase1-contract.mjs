import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const read = (path) => fs.readFileSync(path, "utf8");
const bell = read("components/NotificationCenter.tsx");
const appShell = read("components/AppShell.tsx");
const route = read("app/api/notifications/route.ts");
const scope = read("lib/serverNotificationScope.ts");
const feed = read("lib/notificationFeed.server.ts");
const eventServer = read("lib/notificationEvent.server.ts");
const labour = read("app/api/labour/approvals/route.ts");
const migration = read("supabase/migrations/202609220003_user_notification_event_deduplication.sql");
const helperTs = read("lib/notificationPresentation.ts");
const tenantResolverTs = read("lib/tenantHostnameResolver.ts");

const helperJs = ts.transpileModule(helperTs, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const helperModule = { exports: {} };
vm.runInNewContext(helperJs, { module: helperModule, exports: helperModule.exports, URL });
const { sanitizeNotificationTargetUrl, notificationBadgeCount, pendingActionsEmptyState } = helperModule.exports;
assert.equal(notificationBadgeCount(0), 0, "workflow counts do not create an unread notification badge");
assert.equal(notificationBadgeCount(2), 2, "badge reflects only persisted unread count");
assert.equal(pendingActionsEmptyState({ count: 0, loaded: true, hasError: false }), "empty");
assert.equal(pendingActionsEmptyState({ count: 0, loaded: false, hasError: true }), "error", "pending-action failure is not an empty result");

assert.match(bell, /createPortal\([\s\S]*?document\.body/);
assert.match(bell, /getBoundingClientRect\(\)/);
assert.match(bell, /addEventListener\("resize"/);
assert.match(bell, /addEventListener\("scroll", reposition, true\)/);
assert.match(bell, /addEventListener\("pointerdown"/);
assert.match(bell, /event\.key === "Escape"/);
assert.match(bell, /window\.location\.href = target/);
assert.match(bell, /payload\.unread_count/);
assert.match(bell, /if \(!response\.ok\) \{\s*setUnreadCount\(0\);\s*setLoadError\(true\);\s*return;/);
assert.match(bell, /catch \{\s*setUnreadCount\(0\);\s*setLoadError\(true\);/);
assert.match(bell, /Unable to load notifications/);
assert.match(bell, /notifications\.map\(/);
assert.match(bell, /unreadBadgeCount > 0[\s\S]*?>\{unreadBadgeCount\}</);
assert.doesNotMatch(bell, /workflowTotal\s*\+\s*unreadCount/);
assert.match(appShell, /<NotificationCenter workflowCounts=\{notificationCounts\}[\s\S]*?workflowCountsLoaded=\{notificationCountsLoaded\}/, "notification failure remains isolated to the bell component");
assert.doesNotMatch(bell, /total === 0 \? <div[^>]*>No pending alerts/);

assert.doesNotMatch(route, /requireAnyPermission|labour_attendance|labour_daily_submission/);
assert.match(scope, /loadPermissionContext\(request\)/, "generic endpoint still requires authenticated active account context");
assert.match(scope, /loadActorOrganizationScope/);
assert.match(scope, /resolveTenantHostname/);
assert.match(scope, /isInOrganizationScope\(organizationScope, organizationId\)/);
assert.match(scope, /if \(hostOrganizationId && requestedOrganizationId && hostOrganizationId !== requestedOrganizationId\)/);
assert.match(scope, /if \(!organizationId\)[\s\S]*An active organization is required\./);
assert.equal((route.match(/loadNotificationRequestScope\(request\)/g) || []).length, 2, "GET and PATCH share the same trusted organization resolver");
assert.match(route, /const scope = await loadNotificationRequestScope\(request\);[\s\S]*if \("error" in scope\)[\s\S]*loadNotificationFeed\(scope\.admin, scope\.auth\.user\.id, scope\.organizationId/);
assert.match(route, /\.eq\("recipient_user_id", scope\.auth\.user\.id\)/g);
assert.match(route, /\.eq\("organization_id", scope\.organizationId\)/g);
assert.match(route, /loadNotificationFeed\(scope\.admin, scope\.auth\.user\.id, scope\.organizationId, limit\)/);
assert.match(feed, /\.select\("id", \{ count: "exact", head: true \}\)/);
assert.match(feed, /\.limit\(limit\)/);
assert.match(route, /sanitizeNotificationTargetUrl\(row\.target_url\)/);
assert.match(route, /sanitizeNotificationTargetUrl\(data\.target_url\)/);
assert.match(route, /\.eq\("id", id\)[\s\S]*?\.eq\("recipient_user_id", scope\.auth\.user\.id\)[\s\S]*?\.eq\("organization_id", scope\.organizationId\)/);

assert.match(tenantResolverTs, /classified\.type === "local" && process\.env\.NODE_ENV !== "production"/);
assert.match(tenantResolverTs, /SITEQUBE_DEV_TENANT_CODE/);
assert.match(tenantResolverTs, /\.eq\("code", configuredCode\)[\s\S]*?\.eq\("status", "active"\)/);
assert.doesNotMatch(tenantResolverTs, /3b65abde-9f9f-4f1b-bd40-fa261a76920b|MRC Group/);
const resolverJs = ts.transpileModule(tenantResolverTs, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const resolverModule = { exports: {} };
const resolverEnv = { NODE_ENV: "development", SITEQUBE_DEV_TENANT_CODE: "configured-dev-tenant" };
const resolverCalls = [];
vm.runInNewContext(resolverJs, {
  module: resolverModule,
  exports: resolverModule.exports,
  process: { env: resolverEnv },
  require: (name) => {
    if (name === "@/lib/platformTenantSlug") return { normalizeTenantSlug: (value) => String(value).toLowerCase(), RESERVED_TENANT_SLUGS: new Set(["www", "api", "platform"]), SITEQUBE_ROOT_DOMAIN: "siteqube.com" };
    if (name === "@/lib/managedTenant/trustedHost") return { normalizeTrustedHost: (value) => String(value || "").trim().toLowerCase().replace(/:\d+$/, "") };
    throw new Error(`Unexpected tenant resolver dependency ${name}`);
  },
});
const { resolveTenantHostname } = resolverModule.exports;
function tenantAdmin() {
  return {
    from(table) {
      const filters = {};
      const query = {
        select() { return this; },
        eq(field, value) { filters[field] = value; return this; },
        async maybeSingle() {
          resolverCalls.push({ table, filters: { ...filters } });
          if (table === "organizations" && filters.code === "configured-dev-tenant" && filters.status === "active") return { data: { id: "configured-org-id", name: "Configured Tenant", status: "active", code: filters.code }, error: null };
          if (table === "organization_domains" && filters.hostname === "mrc.siteqube.com" && filters.status === "active") return { data: { organization_id: "production-org-id" }, error: null };
          if (table === "organizations" && filters.id === "production-org-id" && filters.status === "active") return { data: { id: "production-org-id", name: "Production Tenant", status: "active" }, error: null };
          return { data: null, error: null };
        },
      };
      return query;
    },
  };
}
const localTenant = await resolveTenantHostname(tenantAdmin(), "localhost:3004");
assert.equal(localTenant.type, "tenant", "localhost resolves through the canonical configured development tenant");
assert.equal(localTenant.organization.id, "configured-org-id");
assert.equal(resolverCalls[0].filters.code, "configured-dev-tenant");
resolverEnv.NODE_ENV = "production";
const beforeProductionLocal = resolverCalls.length;
const productionLocal = await resolveTenantHostname(tenantAdmin(), "localhost:3004");
assert.equal(productionLocal.type, "local", "development tenant override does not affect production mode");
assert.equal(resolverCalls.length, beforeProductionLocal, "production does not query the development tenant override");
const productionTenant = await resolveTenantHostname(tenantAdmin(), "mrc.siteqube.com");
assert.equal(productionTenant.type, "tenant");
assert.equal(productionTenant.organization.id, "production-org-id", "production tenant-host resolution remains unchanged");
assert.match(scope, /if \(hostOrganizationId && requestedOrganizationId && hostOrganizationId !== requestedOrganizationId\)[\s\S]*return \{ error: "Selected organization does not match the active tenant\.", status: 403 \}/);
assert.match(scope, /if \(!isInOrganizationScope\(organizationScope, organizationId\)\)[\s\S]*outside your access scope/);

const serverModule = { exports: {} };
const serverJs = ts.transpileModule(eventServer, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
vm.runInNewContext(serverJs, {
  module: serverModule,
  exports: serverModule.exports,
  require: (name) => { if (name === "server-only") return {}; throw new Error(`Unexpected require ${name}`); },
});
const { buildNotificationEventKey, insertNotificationOnce, NOTIFICATION_EVENT_KEY_MAX_LENGTH } = serverModule.exports;
assert.match(eventServer, /^import "server-only";/);
assert.equal(NOTIFICATION_EVENT_KEY_MAX_LENGTH, 256);
const maxLengthKey = buildNotificationEventKey({ eventType: "e".repeat(240), entityType: "t", entityId: "i", cycleId: "c" });
assert.equal(Array.from(maxLengthKey).length, 256);
assert.throws(() => buildNotificationEventKey({ eventType: "e".repeat(241), entityType: "t", entityId: "i", cycleId: "c" }), /exceeds 256 characters/);
const labourKey = buildNotificationEventKey({ eventType: "labour_attendance_sent_back", entityType: "labour_attendance_period", entityId: "period-1", cycleId: "2026-09-22:snapshot-1" });
assert.equal(labourKey, buildNotificationEventKey({ eventType: "labour_attendance_sent_back", entityType: "labour_attendance_period", entityId: "period-1", cycleId: "2026-09-22:snapshot-1" }));
assert.notEqual(labourKey, buildNotificationEventKey({ eventType: "labour_attendance_sent_back", entityType: "labour_attendance_period", entityId: "period-1", cycleId: "2026-09-22:snapshot-2" }));

const persistedNotifications = new Map();
let unrelatedFailure = false;
let upsertOptions = null;
const fakeAdmin = { from: (table) => ({ upsert: async (row, options) => {
  assert.equal(table, "user_notifications");
  upsertOptions = options;
  if (unrelatedFailure) return { error: { code: "23505", message: "duplicate key on a different constraint" } };
  const key = JSON.stringify([row.organization_id, row.recipient_user_id, row.event_key]);
  if (!persistedNotifications.has(key)) persistedNotifications.set(key, row);
  return { error: null };
} }) };
const notification = { organization_id: "org-1", recipient_user_id: "user-1", event_key: "same-event" };
await insertNotificationOnce(fakeAdmin, notification);
await insertNotificationOnce(fakeAdmin, notification);
assert.equal(persistedNotifications.size, 1, "same org + recipient + event key persists once");
await insertNotificationOnce(fakeAdmin, { ...notification, recipient_user_id: "user-2" });
await insertNotificationOnce(fakeAdmin, { ...notification, organization_id: "org-2" });
assert.equal(persistedNotifications.size, 3, "recipient and organization are part of the dedupe identity");
assert.equal(upsertOptions.onConflict, "organization_id,recipient_user_id,event_key");
assert.equal(upsertOptions.ignoreDuplicates, true);
unrelatedFailure = true;
await assert.rejects(insertNotificationOnce(fakeAdmin, { ...notification, event_key: "unrelated-error" }), (error) => error.code === "23505" && error.message.includes("different constraint"));
assert.match(migration, /add column if not exists event_key varchar\(256\)/i);
assert.doesNotMatch(migration, /not null|default|update\s+public\.user_notifications/i);

for (const safe of ["/purchase/purchase-orders/abc", "/labour/attendance/daily", "/hr/attendance-approval?site=abc", "/labour/attendance/daily?site_id=abc"]) {
  assert.equal(sanitizeNotificationTargetUrl(safe), safe, `accept internal target ${safe}`);
}
for (const unsafe of ["https://evil.example", "http://evil.example", "//evil.example", "javascript:alert(1)", "data:text/html,...", "\\\\evil.example", "/\\\\evil.example", "/..//evil.example", "/%2e%2e//evil.example", "/%252e%252e%252f%252fevil.example", "/%255c%255cevil.example"]) {
  assert.equal(sanitizeNotificationTargetUrl(unsafe), null, `reject unsafe target ${unsafe}`);
}
assert.match(migration, /create unique index if not exists user_notifications_org_recipient_event_key_uidx/i);
assert.match(migration, /\(organization_id, recipient_user_id, event_key\)/i);
assert.match(migration, /event_key varchar\(256\)/i);

const { loadNotificationFeed } = (() => {
  const js = ts.transpileModule(read("lib/notificationFeed.server.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(js, { module: loaded, exports: loaded.exports });
  return loaded.exports;
})();
const queries = [];
class FakeQuery {
  constructor(selection, options) { this.selection = selection; this.options = options; this.filters = []; this.limitValue = null; queries.push(this); }
  eq(key, value) { this.filters.push([key, value]); return this; }
  order() { return this; }
  limit(value) { this.limitValue = value; return this; }
  then(resolve, reject) {
    const isCount = this.options?.count === "exact";
    const result = isCount ? { data: null, count: 27, error: null } : { data: Array.from({ length: 20 }, (_, i) => ({ id: `row-${i}` })), count: null, error: null };
    return Promise.resolve(result).then(resolve, reject);
  }
}
const feedResult = await loadNotificationFeed({ from: () => ({ select: (selection, options) => new FakeQuery(selection, options) }) }, "recipient-A", "org-A", 20);
assert.equal(feedResult.rows.length, 20, "feed remains bounded to displayed rows");
assert.equal(feedResult.unreadCount, 27, "exact unread count includes rows beyond the displayed 20");
assert.equal(queries[0].limitValue, 20);
assert.equal(queries[1].limitValue, null, "count query does not load a row page");
for (const query of queries) {
  assert.ok(query.filters.some(([key, value]) => key === "recipient_user_id" && value === "recipient-A"));
  assert.ok(query.filters.some(([key, value]) => key === "organization_id" && value === "org-A"));
}

const sendBack = labour.slice(labour.indexOf('if (action === "standard_send_back")'), labour.indexOf("function platformOwnerOnly"));
assert.match(sendBack, /event_key: eventKey/);
assert.match(sendBack, /buildNotificationEventKey/);
assert.match(sendBack, /insertNotificationOnce\(access\.admin/);
assert.match(sendBack, /snapshot\?\.id/);
assert.match(sendBack, /cycleId: `\$\{workDate\}:\$\{cycleId\}`/);
assert.match(sendBack, /catch \(notificationError/);
assert.match(sendBack, /console\.error\("Labour attendance notification delivery failed:/);
assert.match(sendBack, /Labour attendance notification delivery failed/);
assert.doesNotMatch(sendBack, /23505/);
assert.match(sendBack, /return NextResponse\.json\(\{ updated: true, status: "reopened" \}\)/);
assert.match(sendBack, /standard_send_back/);

console.log("Notification Phase 1 contracts passed.");
