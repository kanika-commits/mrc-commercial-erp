import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const files = [
  "components/AppShell.tsx",
  "components/AuthGuard.tsx",
  "components/ModulePage.tsx",
  "lib/releasedModuleRegistry.ts",
  "lib/defaultModuleNavigation.ts",
  "lib/moduleDisplayNames.ts",
  "lib/permissionVisibility.ts",
  "app/api/admin/bootstrap/route.ts",
  "app/api/admin/module-navigation/route.ts",
  "app/admin/permissions/page.tsx",
  "app/api/admin/permissions/route.ts",
  "app/modules/page.tsx",
  "app/modules/hr/page.tsx",
];

const forbidden = [
  "@/lib/labour",
  "@/lib/reports",
  "@/lib/hr/attendance",
  "/api/labour",
  "/api/reports",
  "from(\"labour_",
  "from('labour_",
  "from(\"employee_attendance",
  "from('employee_attendance",
  "labour_site_configurations",
  "labour_organization_configurations",
];

for (const file of files) {
  const content = fs.readFileSync(path.join(root, file), "utf8");
  for (const token of forbidden) {
    if (content.includes(token)) {
      throw new Error(`${file} contains forbidden Release 1 dependency ${token}.`);
    }
  }
}

console.log("No Release 1 schema dependency rules passed.");
