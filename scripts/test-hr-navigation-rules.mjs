import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const hrNav = fs.readFileSync(path.join(root, "components/hr/HrSectionNav.tsx"), "utf8");
const hrModule = fs.readFileSync(path.join(root, "app/modules/hr/page.tsx"), "utf8");
const appShell = fs.readFileSync(path.join(root, "components/AppShell.tsx"), "utf8");
const defaultNav = fs.readFileSync(path.join(root, "lib/defaultModuleNavigation.ts"), "utf8");
const registry = fs.readFileSync(path.join(root, "lib/releasedModuleRegistry.ts"), "utf8");

if (!/return\s+null/.test(hrNav)) {
  throw new Error("HR top navigation must be disabled for Release 1.");
}

for (const forbidden of ["/hr/attendance", "/hr/attendance-approval", "/labour", "labour_"]) {
  if (hrModule.includes(forbidden) || appShell.includes(forbidden) || defaultNav.includes(forbidden)) {
    throw new Error(`Released HR navigation must not expose ${forbidden}.`);
  }
}

for (const required of ["hr_employees", "hr_employee_import", "reimbursements", "hr_departments", "hr_designations"]) {
  if (!registry.includes(required)) {
    throw new Error(`Released HR page ${required} must remain reachable.`);
  }
}

console.log("HR navigation rules passed.");
