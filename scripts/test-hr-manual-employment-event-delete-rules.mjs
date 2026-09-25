import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/hr/employees/[id]/employment-history/route.ts", "utf8");
const timeline = fs.readFileSync("components/hr/EmployeeEmploymentTimeline.tsx", "utf8");

assert.match(route, /export async function DELETE/);
assert.match(route, /auth\.roleCodes\.includes\("platform_owner"\)/);
assert.match(route, /loadAccessibleEmployee\(admin, auth, id\)/);
assert.match(route, /\.eq\("id", eventId\)/);
assert.match(route, /\.eq\("employee_id", id\)/);
assert.match(route, /\.eq\("organization_id", employeeResult\.employee\.organization_id\)/);
assert.match(route, /\.eq\("is_manual", true\)/);
assert.match(timeline, /Delete manual employment event/);
assert.match(timeline, /event\.is_manual === true/);
assert.match(timeline, /setHistory\(history\.filter/);

console.log("Manual employment event deletion contract tests passed.");
