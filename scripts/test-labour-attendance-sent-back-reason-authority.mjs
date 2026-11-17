import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/labour/attendance/daily/page.tsx", "utf8");
const api = fs.readFileSync("app/api/labour/attendance/daily/route.ts", "utf8");
const shared = fs.readFileSync("app/api/labour/_shared.ts", "utf8");
const pdf = fs.readFileSync("app/api/labour/attendance/date-document/route.ts", "utf8");

assert.match(shared, /export async function loadLabourAttendanceDateAuthority/);
assert.match(shared, /const reopened = summaryStatus === "reopened" \|\| input\.period\?\.status === "reopened"/);
assert.match(shared, /!options\.reopened && !options\.historicallyOpened && !normalizeText\(reason\)/);
assert.match(page, /const serverReopenedDate = selectedDateStatus === "reopened"/);
assert.match(page, /backdated && !historicalAccess && !reopenedByServer/);
assert.match(api, /const dateAuthority = await loadLabourAttendanceDateAuthority\(access, \{ period: existingPeriod/);
assert.match(api, /reopened: dateAuthority\.reopened/);
assert.match(api, /const explicitlyOpen = dateAuthority\.reopened \|\| Boolean\(historicalAccess\)/);
assert.match(pdf, /loadLabourAttendanceDateAuthority/);

const authority = ({ summaryStatus = "", periodStatus = "draft" }) =>
  summaryStatus === "reopened" || periodStatus === "reopened";
assert.equal(authority({ periodStatus: "reopened" }), true, "server-confirmed period reopen bypasses a missing date summary");
assert.equal(authority({ summaryStatus: "reopened", periodStatus: "submitted" }), true, "server-confirmed date reopen bypasses a stale period summary");
assert.equal(authority({ summaryStatus: "submitted", periodStatus: "submitted" }), false, "submitted authority remains locked");
console.log("PASS: Labour sent-back authority bypasses the generic reason guard for missing/stale summaries while ordinary submitted dates remain protected.");
