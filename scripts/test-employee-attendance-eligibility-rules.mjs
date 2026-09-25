import assert from "node:assert/strict";
import fs from "node:fs";

const shared = fs.readFileSync("app/api/hr/attendance/_shared.ts", "utf8");
const daily = fs.readFileSync("app/api/hr/attendance/daily/route.ts", "utf8");
const dailyPage = fs.readFileSync("app/hr/attendance/daily/page.tsx", "utf8");
const attendance = fs.readFileSync("lib/hr/attendance.ts", "utf8");

assert.match(shared, /export async function loadEligibleEmployees/);
assert.match(shared, /hr_employee_transfer_schedules/);
assert.match(shared, /Fail closed during the short interval/);
assert.match(shared, /event_type, source, is_manual/);
assert.match(shared, /event_type === "transferred" && history\.is_manual === true/);
assert.match(shared, /String\(employee\.status \|\| \"\"\)\.toLowerCase\(\) === \"active\"/);
assert.match(shared, /\[\"active\"\]\.includes\(String\(latestHistory\.employment_status/);
assert.match(shared, /\[\"active\"\]\.includes\(String\(history\.employment_status/);
assert.match(daily, /\[\"submitted\", \"approved\"\]\.includes/);
assert.match(attendance, /date_of_joining/);
assert.match(attendance, /date_of_exit/);
assert.doesNotMatch(daily, /MRC0350|GANESH|LMNIIT/);
assert.match(daily, /save_hr_employee_attendance_atomic/);
assert.doesNotMatch(daily, /\.from\("employee_attendance"\)\.upsert/);
assert.match(daily, /retryable: true/);
assert.match(daily, /failed: failures/);
assert.match(daily, /Some attendance rows were saved/);
assert.match(dailyPage, /partialResults/);
assert.match(dailyPage, /Review the failed employees and retry them/);
assert.match(dailyPage, /failedEmployeeIds/);
assert.match(dailyPage, /setDraft\(failedDraft\)/);
assert.match(dailyPage, /return null;/);

console.log("Employee attendance eligibility rules passed.");
