import fs from "node:fs";

const route = fs.readFileSync("app/api/hr/attendance/approval-groups/route.ts", "utf8");

if (!route.includes("const sites = await loadApprovalSites(admin, auth);")) {
  throw new Error("The full approval queue must use the scoped site lookup");
}
if (route.includes("loadEmployeeAttendanceLookups")) {
  throw new Error("The full approval queue must not load unrelated employee/history/policy lookups");
}
if (!route.includes("const allStates = await accessibleDailyRows")) {
  throw new Error("Approval queue must retain the authorized daily-row query");
}
if (!route.includes("const counts = await Promise.all(groupStates.map")) {
  throw new Error("Approval queue counts must remain grouped by authorized state");
}

console.log("PASS: approval queue uses the scoped site lookup and retains authorized state/count queries.");
