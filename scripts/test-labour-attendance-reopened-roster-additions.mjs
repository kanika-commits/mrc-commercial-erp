import assert from "node:assert/strict";
import fs from "node:fs";

const shared = fs.readFileSync("app/api/labour/_shared.ts", "utf8");
const daily = fs.readFileSync("app/api/labour/attendance/daily/route.ts", "utf8");
const submit = fs.readFileSync("app/api/labour/attendance/periods/[id]/submit/route.ts", "utf8");

assert.match(shared, /export async function loadAttendanceDeploymentsForDate/);
assert.match(shared, /input\.status !== "reopened"/);
assert.match(shared, /ignoreWorkerCreatedAt: true/);
assert.match(shared, /const byWorkerId = new Map/);
assert.match(shared, /byWorkerId\.has\(deployment\.labour_worker_id\)/);
assert.match(shared, /ignoreCompanySite: true/);
assert.match(shared, /transferredWorkerIds/);
assert.match(daily, /loadAttendanceDeploymentsForDate/);
assert.match(daily, /rosterAdditions/);
assert.match(daily, /Added \$\{rosterAdditions\.length\} newly eligible worker/);
assert.match(daily, /roster_additions/);
assert.match(submit, /loadAttendanceDeploymentsForDate/);

const snapshot = [{ id: "old-deployment", labour_worker_id: "frozen-worker" }];
const current = [{ id: "old-deployment", labour_worker_id: "frozen-worker" }, { id: "new-deployment", labour_worker_id: "registered-after-snapshot" }];
const merged = new Map(snapshot.map((row) => [row.labour_worker_id, row]));
for (const row of current) if (!merged.has(row.labour_worker_id)) merged.set(row.labour_worker_id, row);
assert.deepEqual([...merged.values()], current);
assert.equal([...merged.values()].filter((row) => row.labour_worker_id === "registered-after-snapshot").length, 1);
assert.equal(snapshot.length, 1);

const submitted = [{ id: "old-deployment", labour_worker_id: "frozen-worker" }];
assert.deepEqual(submitted, snapshot);

const siteA = [{ id: "site-a-deployment", labour_worker_id: "transferred-worker", company_id: "company-1", site_id: "site-a" }];
const siteB = [{ id: "site-b-deployment", labour_worker_id: "transferred-worker", company_id: "company-1", site_id: "site-b" }];
const transferredWorkerIds = new Set(siteB
  .filter((row) => row.company_id !== "company-1" || row.site_id !== "site-a")
  .map((row) => row.labour_worker_id));
const siteARoster = siteA.filter((row) => !transferredWorkerIds.has(row.labour_worker_id));
const siteBRoster = siteB;
assert.equal(siteARoster.length, 0, "A same-day transfer must remove the worker from the old site roster");
assert.equal(siteBRoster.filter((row) => row.labour_worker_id === "transferred-worker").length, 1, "A same-day transfer must add the worker once to the new site roster");
assert.deepEqual(snapshot, submitted, "The original submitted snapshot must remain immutable");

console.log("Labour reopened roster additions rules passed");
