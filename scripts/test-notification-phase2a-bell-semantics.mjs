import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const read = (path) => fs.readFileSync(path, "utf8");
const bell = read("components/NotificationCenter.tsx");
const shell = read("components/AppShell.tsx");
const countsRoute = read("app/api/notifications/counts/route.ts");
const feed = read("lib/notificationFeed.server.ts");
const presentation = read("lib/notificationPresentation.ts");

const helperJs = ts.transpileModule(presentation, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const helperModule = { exports: {} };
vm.runInNewContext(helperJs, { module: helperModule, exports: helperModule.exports, URL });
const { notificationBadgeCount, pendingActionsEmptyState } = helperModule.exports;

assert.equal(notificationBadgeCount(0), 0, "278 pending actions and zero unread messages produce no badge");
assert.equal(notificationBadgeCount(2), 2, "278 pending actions and two unread messages produce badge 2");
assert.equal(notificationBadgeCount("2"), 2);
assert.equal(notificationBadgeCount(-1), 0);
assert.equal(notificationBadgeCount(Number.NaN), 0);
assert.equal(pendingActionsEmptyState({ count: 0, loaded: true, hasError: false }), "empty");
assert.equal(pendingActionsEmptyState({ count: 1, loaded: true, hasError: false }), "items");
assert.equal(pendingActionsEmptyState({ count: 0, loaded: false, hasError: false }), "loading");
assert.equal(pendingActionsEmptyState({ count: 0, loaded: false, hasError: true }), "error");

assert.match(bell, /const unreadBadgeCount = notificationBadgeCount\(unreadCount\)/);
assert.match(bell, /unreadBadgeCount > 0[\s\S]*?>\{unreadBadgeCount\}</);
assert.doesNotMatch(bell, /workflowTotal\s*\+\s*unreadCount/);
assert.match(bell, /Your Pending Actions/);
assert.match(bell, /Recent Updates/);
assert.match(bell, /No pending actions/);
assert.match(bell, /No notifications yet/);
assert.match(bell, /Unable to load notifications/);
assert.match(bell, /notificationsLoading && !notificationsLoaded[\s\S]*?Loading notifications…/);
assert.match(bell, /Unable to load pending actions/);
assert.match(bell, /notifications\.map\(/, "read and unread feed rows are both rendered");
assert.match(bell, /notification\.is_read \? "" : "bg-sky-50"/, "only unread rows receive unread styling");
assert.match(bell, /createPortal\([\s\S]*?document\.body/);
assert.match(bell, /getBoundingClientRect\(\)/);
assert.match(bell, /addEventListener\("resize"/);
assert.match(bell, /addEventListener\("scroll", reposition, true\)/);
assert.match(bell, /sanitizeNotificationTargetUrl/);
assert.match(bell, /method: "PATCH"[\s\S]*?JSON\.stringify\(\{ id: notification\.id \}\)/);
assert.match(shell, /workflowCountsLoaded=\{notificationCountsLoaded\}[\s\S]*?workflowCountsError=\{notificationCountsError\}/);
assert.doesNotMatch(shell, /notificationsStartedRef/, "a cancelled Strict Mode effect cannot poison a one-shot started ref");
assert.match(shell, /useEffect\(\(\) => \{\s*if \(!user\) return;\s*const timer = window\.setTimeout\(\(\) => \{\s*void loadNotificationCounts\(\);\s*\}, 0\);\s*return \(\) => window\.clearTimeout\(timer\);\s*\}, \[loadNotificationCounts, user\]\)/,
  "pending counts are scheduled on each effect setup and cancelled cleanly during Strict Mode replay");
const countLoader = shell.slice(shell.indexOf("const loadNotificationCounts = useCallback"), shell.indexOf("useEffect(() => {\n    if (!user) return;"));
assert.match(countLoader, /setNotificationCountsLoaded\(true\)/, "successful zero/action responses settle the result");
assert.match(countLoader, /catch \(error\) \{\s*setNotificationCountsError\(true\)/, "request failures render the explicit failure state");
assert.match(countLoader, /finally \{\s*setNotificationCountsLoading\(false\)/, "every settled request clears the loading state");

const displayedLinks = bell.slice(bell.indexOf("const workflowLinks"), bell.indexOf("type NotificationPosition"));
assert.match(displayedLinks, /employeeAttendanceSentBack/);
assert.match(displayedLinks, /labourAttendanceSentBack/);
assert.doesNotMatch(displayedLinks, /pendingWorkOrders|pendingRaBills|pendingDebitNotes|pendingItcReview/);

assert.match(countsRoute, /const canEmployeeAttendance = canAny\(auth\.permissions, "hr_attendance", \["view"\]\)\s*&&\s*canAny\(auth\.permissions, "hr_attendance", \["add", "edit", "submit"\]\)/);
assert.match(countsRoute, /const canLabourStandardAttendance = canAny\(auth\.permissions, "labour_attendance", \["view"\]\)\s*&&\s*canAny\(auth\.permissions, "labour_attendance", \["submit"\]\)/);
assert.match(countsRoute, /const canLabourEngineerAttendance = canAny\(auth\.permissions, "labour_daily_submission", \["submit"\]\)/);
assert.match(countsRoute, /\.eq\("submitted_by", auth\.user\.id\)/g);
assert.match(countsRoute, /applyOrganizationScope\([\s\S]*organizationScope[\s\S]*applyCompanySiteAssignmentScope/);
assert.doesNotMatch(feed, /\.eq\("is_read",\s*false\)[\s\S]*?\.limit\(limit\)/, "recent feed query is not unread-only");
assert.match(feed, /\.eq\("is_read", false\)/, "exact unread count is computed separately");

console.log("Notification Phase 2A bell semantics tests passed.");
