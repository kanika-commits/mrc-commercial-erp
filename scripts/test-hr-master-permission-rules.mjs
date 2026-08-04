import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const files = {
  departmentsPage: fs.readFileSync(path.join(root, "app/hr/departments/page.tsx"), "utf8"),
  designationsPage: fs.readFileSync(path.join(root, "app/hr/designations/page.tsx"), "utf8"),
  departmentsApi: fs.readFileSync(path.join(root, "app/api/hr/departments/route.ts"), "utf8"),
  departmentApi: fs.readFileSync(path.join(root, "app/api/hr/departments/[id]/route.ts"), "utf8"),
  designationsApi: fs.readFileSync(path.join(root, "app/api/hr/designations/route.ts"), "utf8"),
  designationApi: fs.readFileSync(path.join(root, "app/api/hr/designations/[id]/route.ts"), "utf8"),
  authGuard: fs.readFileSync(path.join(root, "components/AuthGuard.tsx"), "utf8"),
  registry: fs.readFileSync(path.join(root, "lib/releasedModuleRegistry.ts"), "utf8"),
  matrix: fs.readFileSync(path.join(root, "lib/permissionMatrix.ts"), "utf8"),
};

for (const token of [
  'can(permissions, "hr_departments", "add")',
  'can(permissions, "hr_departments", "edit")',
  'can(permissions, "hr_departments", "delete")',
]) {
  if (!files.departmentsPage.includes(token)) {
    throw new Error(`Departments page is missing standalone permission check ${token}.`);
  }
}

for (const token of [
  'can(permissions, "hr_designations", "add")',
  'can(permissions, "hr_designations", "edit")',
  'can(permissions, "hr_designations", "delete")',
]) {
  if (!files.designationsPage.includes(token)) {
    throw new Error(`Designations page is missing standalone permission check ${token}.`);
  }
}

for (const [label, source, moduleCode] of [
  ["departments list API", files.departmentsApi, "hr_departments"],
  ["departments detail API", files.departmentApi, "hr_departments"],
  ["designations list API", files.designationsApi, "hr_designations"],
  ["designations detail API", files.designationApi, "hr_designations"],
]) {
  if (!source.includes(`const MODULE_CODE = "${moduleCode}";`)) {
    throw new Error(`${label} must enforce ${moduleCode}.`);
  }
  for (const action of ["add", "edit", "delete"]) {
    if (source.includes(`requirePermission(request, "hr_employees", "${action}")`)) {
      throw new Error(`${label} must not silently fall back to hr_employees:${action}.`);
    }
  }
  if (source.includes('requirePermission(request, "hr_employees", "view")')) {
    if (!label.includes("list API") || !source.includes('purpose === "employee_lookup"')) {
      throw new Error(`${label} must not silently fall back to hr_employees:view outside the employee lookup purpose.`);
    }
  }
}

if (files.departmentsPage.includes('can(permissions, "hr_employees"')) {
  throw new Error("Departments page must not use hr_employees for standalone master actions.");
}
if (files.designationsPage.includes('can(permissions, "hr_employees"')) {
  throw new Error("Designations page must not use hr_employees for standalone master actions.");
}

for (const token of [
  'code: "hr_departments"',
  'permissionModule: "hr_departments"',
  'route: "/hr/departments"',
  'code: "hr_designations"',
  'permissionModule: "hr_designations"',
  'route: "/hr/designations"',
]) {
  if (!files.registry.includes(token)) {
    throw new Error(`Released registry is missing ${token}.`);
  }
}

for (const token of [
  'hr_departments: ["view", "add", "edit", "delete"]',
  'hr_designations: ["view", "add", "edit", "delete"]',
]) {
  if (!files.matrix.includes(token)) {
    throw new Error(`Permission Matrix is missing ${token}.`);
  }
}

if (!files.authGuard.includes("findReleasedRoute(pathname)") || files.authGuard.includes('pathname === "/hr/departments" || pathname === "/hr/designations"')) {
  throw new Error("AuthGuard must use released route registry for HR master route access, not hr_employees fallback logic.");
}

console.log("HR master standalone permission rules passed.");
