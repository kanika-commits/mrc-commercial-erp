import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/labour/attendance/daily/page.tsx", "utf8");
const api = fs.readFileSync("app/api/labour/attendance/daily/route.ts", "utf8");

assert.match(page, /const requiresOverride = selectedDateStatus !== "draft" && !serverReopenedDate && !historicalAccess;/);
assert.match(page, /row\?\.attendance\?\.\[existingField\] === false && status === "present" && !canOverride/);
assert.match(page, /row\.attendance \? !canEditAttendance : !canAddAttendance/);
assert.match(api, /const dateAuthority = await loadLabourAttendanceDateAuthority/);
assert.match(api, /const explicitlyOpen = dateAuthority\.reopened \|\| Boolean\(historicalAccess\);/);
assert.match(api, /const requiresOverride = selectedStatus !== "draft" && !explicitlyOpen;/);
assert.match(api, /existing\?\.second_half_present === false && secondHalfPresent === true/);
assert.match(api, /You do not have permission to change Second Shift from Absent to Present/);
assert.match(api, /dateAuthority\.submittedSnapshotLocked/);
assert.match(api, /if \(lockBlocker\) return jsonError\(lockBlocker, 403\);/);
assert.match(api, /hasServerPermission\(access, "labour_attendance", requiredAction\)/);
console.log("Labour absent-to-present authority rules passed");
