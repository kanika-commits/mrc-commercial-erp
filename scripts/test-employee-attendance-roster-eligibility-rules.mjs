import assert from "node:assert/strict";
import fs from "node:fs";

const shared = fs.readFileSync("app/api/hr/attendance/_shared.ts", "utf8");
const daily = fs.readFileSync("app/api/hr/attendance/daily/route.ts", "utf8");
const page = fs.readFileSync("app/hr/attendance/daily/page.tsx", "utf8");

assert.match(shared, /\.eq\("organization_id", values\.organizationId\)/);
assert.match(shared, /employeeStatus === "inactive"/);
assert.match(shared, /!inactivation \|\| dateForEligibility >= inactivation/);
assert.match(shared, /employeeStatus !== "active"/);
assert.match(shared, /history\.effective_from \|\| history\.event_date/);
assert.match(shared, /history\.company_id === values\.companyId/);
assert.match(shared, /history\.site_id === values\.siteId/);
assert.match(shared, /rowAppliesToDateRange\(history, values\.startDate, values\.endDate\)/);
assert.match(daily, /loadEligibleEmployees\(admin/);
assert.match(daily, /validateCompanySiteScope\(admin, auth, params\.companyId, params\.siteId\)/);
assert.match(daily, /historicalEmployees/);
assert.match(daily, /loadAttendanceRows\(admin/);
assert.match(daily, /rowsByEmployee\.get\(employee\.id\)/);
assert.match(daily, /historicalEmployees = await admin[\s\S]+\.eq\("organization_id", scope\.organizationId\)[\s\S]+\.in\("id", missingEmployeeIds\)/);
assert.doesNotMatch(daily, /historicalEmployees = await admin[\s\S]+\.eq\("company_id", params\.companyId\)/);
assert.match(page, /Employee Status/);
assert.match(page, /item\.employee\.status/);
assert.match(page, /item\.attendance\?\.status/);

console.log("employee attendance roster eligibility rules: PASS");
