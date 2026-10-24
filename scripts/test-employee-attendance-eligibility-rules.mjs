import assert from "node:assert/strict";
import fs from "node:fs";

const shared = fs.readFileSync("app/api/hr/attendance/_shared.ts", "utf8");
const daily = fs.readFileSync("app/api/hr/attendance/daily/route.ts", "utf8");
const attendance = fs.readFileSync("lib/hr/attendance.ts", "utf8");

assert.match(shared, /export async function loadEligibleEmployees/);
assert.match(shared, /event_type, source, is_manual/);
assert.match(shared, /select\("id, employee_id, company_id, site_id, effective_from, effective_to, event_date, employment_status, event_type, source, is_manual, created_at"\)/, "history ordering must retain the tie-break fields");
assert.match(shared, /order\("effective_from", \{ ascending: false, nullsFirst: false \}\)[\s\S]+order\("event_date", \{ ascending: false, nullsFirst: false \}\)[\s\S]+order\("created_at", \{ ascending: false, nullsFirst: false \}\)[\s\S]+order\("id", \{ ascending: false, nullsFirst: false \}\)/, "same-effective-date history must prefer the later-created event deterministically");
assert.match(shared, /event_type === "transferred" && history\.is_manual === true/);
assert.match(shared, /String\(employee\.status \|\| \"\"\)\.toLowerCase\(\) === \"active\"/);
assert.match(shared, /\[\"active\"\]\.includes\(String\(latestHistory\.employment_status/);
assert.match(shared, /\[\"active\"\]\.includes\(String\(history\.employment_status/);
assert.match(daily, /\[\"submitted\", \"approved\"\]\.includes/);
assert.match(daily, /historicalEmployees/);
assert.match(daily, /missingEmployeeIds/);
assert.match(attendance, /date_of_joining/);
assert.match(attendance, /date_of_exit/);
assert.doesNotMatch(daily, /MRC0350|GANESH|LMNIIT/);

const sameDayHistory = [
  { id: "transfer", employee_id: "rohit", company_id: "mrc", site_id: "itob", effective_from: "2026-10-23", event_date: "2026-10-23", employment_status: "inactive", created_at: "2026-10-23T09:00:00Z" },
  { id: "status", employee_id: "rohit", company_id: "mrc", site_id: "itob", effective_from: "2026-10-23", event_date: "2026-10-23", employment_status: "active", created_at: "2026-10-23T10:00:00Z" },
];
const ordered = [...sameDayHistory].sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
assert.equal(ordered[0].id, "status", "Rohit-style same-day transfer/status history must select the later active event");
assert.equal(ordered[0].employment_status, "active");

const anandHistory = sameDayHistory.map((row) => ({ ...row, employee_id: "anand", site_id: "phsc" }));
const anandOrdered = [...anandHistory].sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
assert.equal(anandOrdered[0].site_id, "phsc", "Anand-style history must retain the selected PHSC assignment");
assert.equal(anandOrdered[0].employment_status, "active");

console.log("Employee attendance eligibility rules passed.");
