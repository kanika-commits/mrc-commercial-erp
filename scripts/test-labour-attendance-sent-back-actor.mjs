import assert from "node:assert/strict";
import fs from "node:fs";

const approval = fs.readFileSync("app/api/labour/approvals/route.ts", "utf8");
const dailyApi = fs.readFileSync("app/api/labour/attendance/daily/route.ts", "utf8");
const page = fs.readFileSync("app/labour/attendance/daily/page.tsx", "utf8");
assert.match(approval, /reopened_by_name: actorName\(access\)/);
assert.match(approval, /reopened_by_email: access\.auth\.user\.email/);
assert.match(dailyApi, /from\("erp_audit_logs"\)/);
assert.match(dailyApi, /created_by_name, created_by, new_values, created_at/);
assert.match(dailyApi, /new_values\?\.summary\?\.date_statuses\?\.\[attendanceDate\]\?\.status === "reopened"/);
assert.match(page, /period\?\.reopened_by_name \|\| period\?\.reopened_by_email \|\| "Unavailable"/);
assert.doesNotMatch(page, /reopened_by_name \|\| reopened_by_email \|\| "-"/);

const displayActor = (dateStatus, period, audit) => dateStatus.name || dateStatus.email || period.name || period.email || audit?.name || "Unavailable";
assert.equal(displayActor({ name: "Sent Back User" }, {}, null), "Sent Back User");
assert.equal(displayActor({}, { name: "Legacy User" }, null), "Legacy User");
assert.equal(displayActor({}, {}, { name: "Audited User" }), "Audited User");
assert.equal(displayActor({}, {}, null), "Unavailable");
console.log("Labour sent-back actor display rules passed");
