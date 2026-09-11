import assert from "node:assert/strict";
import fs from "node:fs";

const shared = fs.readFileSync("app/api/hr/attendance/_shared.ts", "utf8");
const daily = fs.readFileSync("app/api/hr/attendance/daily/route.ts", "utf8");
const attendance = fs.readFileSync("lib/hr/attendance.ts", "utf8");

assert.match(shared, /export async function loadEligibleEmployees/);
assert.match(shared, /String\(employee\.status \|\| ""\)\.toLowerCase\(\) === "active"/);
assert.match(shared, /\["active"\]\.includes\(String\(latestHistory\.employment_status/);
assert.match(shared, /\["active"\]\.includes\(String\(history\.employment_status/);
assert.match(daily, /\["submitted", "approved"\]\.includes/);
assert.match(daily, /historicalEmployees/);
assert.match(daily, /missingEmployeeIds/);
assert.match(attendance, /date_of_joining/);
assert.match(attendance, /date_of_exit/);
assert.doesNotMatch(daily, /MRC0350|GANESH|LMNIIT/);

console.log("Employee attendance eligibility rules passed.");
