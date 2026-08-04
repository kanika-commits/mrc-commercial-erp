import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const authGuard = fs.readFileSync(path.join(root, "components/AuthGuard.tsx"), "utf8");

for (const token of ["findReleasedRoute", "getCompatibilityLauncherGroups", "isExplicitlyUnreleasedRoute", "RELEASED_COMPATIBILITY_LAUNCHER_ROUTES"]) {
  if (!authGuard.includes(token)) {
    throw new Error(`AuthGuard must use registry helper ${token}.`);
  }
}

const denyIndex = authGuard.indexOf("isExplicitlyUnreleasedRoute(pathname)");
const globalIndex = authGuard.indexOf("if (globalAccess) return true");
if (denyIndex === -1 || globalIndex === -1 || denyIndex > globalIndex) {
  throw new Error("Unreleased routes must be denied before global access is granted.");
}

for (const forbidden of ["hasExplicitLabourRouteAccess", "labour_", "hr_employee_attendance_policy", "pathname === \"/reports\""]) {
  if (authGuard.includes(forbidden)) {
    throw new Error(`AuthGuard must not hardcode unreleased behavior: ${forbidden}.`);
  }
}

if (!authGuard.includes("pathname === \"/modules/reports\"")) {
  throw new Error("AuthGuard must preserve /modules/reports compatibility.");
}

if (authGuard.includes("if (!group) return true")) {
  throw new Error("Compatibility launcher routes must not default to true when no released group is found.");
}

if (!authGuard.includes("if (mappedGroups.length === 0) return false")) {
  throw new Error("Unknown compatibility launcher mappings must be denied for restricted users.");
}

console.log("Auth route guard rules passed.");
