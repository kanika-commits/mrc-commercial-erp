import {
  RELEASED_MODULES,
  listReleasedPermissionModules,
} from "@/lib/releasedModuleRegistry";

type PermissionModuleRow = {
  module_code?: string | null;
  module_group?: string | null;
  module_name?: string | null;
  sort_order?: number | null;
  status?: string | null;
};

type PresentedPermissionModule<T extends PermissionModuleRow> = T & {
  module_group: string;
  module_name: string;
  sort_order: number;
  permission_note: string | null;
  technical_group: string | null;
};

const visiblePermissionModules = new Set(listReleasedPermissionModules());

const groupOrder = [
  "Dashboard",
  "Project Management",
  "Purchase",
  "Accounts / Finance",
  "Human Resources",
  "Settings",
  "Administration",
];

function presentationFor(moduleCode: string) {
  return RELEASED_MODULES.find((module) => module.permissionModule === moduleCode);
}

export function isVisiblePermissionModule(module: PermissionModuleRow) {
  const moduleCode = String(module.module_code || "").trim();
  if (!moduleCode) return false;
  if (!visiblePermissionModules.has(moduleCode)) return false;
  if (module.status && module.status !== "active") return false;
  return true;
}

export function filterVisiblePermissionModules<T extends PermissionModuleRow>(modules: T[]) {
  return modules.filter(isVisiblePermissionModule);
}

export function visiblePermissionGroupOrder(groupName: string) {
  const index = groupOrder.indexOf(groupName);
  return index === -1 ? groupOrder.length : index;
}

export function presentVisiblePermissionModule<T extends PermissionModuleRow>(module: T) {
  const moduleCode = String(module.module_code || "").trim();
  const presentation = presentationFor(moduleCode);
  const group = presentation?.group || String(module.module_group || "");
  const groupName =
    group === "project_management" ? "Project Management" :
    group === "purchase" ? "Purchase" :
    group === "accounts" ? "Accounts / Finance" :
    group === "hr" ? "Human Resources" :
    group === "settings" ? "Settings" :
    group === "administration" ? "Administration" :
    group === "dashboard" ? "Dashboard" :
    String(module.module_group || "Administration");

  return {
    ...module,
    module_group: groupName,
    module_name: presentation?.title || module.module_name || moduleCode,
    sort_order: presentation?.sortOrder ?? Number(module.sort_order || 0),
    permission_note: null,
    technical_group: module.module_group || null,
  };
}

export function prepareVisiblePermissionModules<T extends PermissionModuleRow>(modules: T[]) {
  const available = new Map<string, T>();
  modules.forEach((module) => {
    const moduleCode = String(module.module_code || "").trim();
    if (moduleCode) available.set(moduleCode, module);
  });

  const visibleModules = RELEASED_MODULES
    .filter((module) => module.permissionMatrix)
    .map((module) => {
      const source = available.get(module.permissionModule) || {
        id: `released-${module.permissionModule}`,
        module_code: module.permissionModule,
        module_group: module.group,
        module_name: module.title,
        route: module.route,
        sort_order: module.sortOrder,
        status: "active",
      };
      return presentVisiblePermissionModule(source as T);
    });

  return visibleModules
    .sort((first, second) => {
      const groupDelta =
        visiblePermissionGroupOrder(String(first.module_group || "")) -
        visiblePermissionGroupOrder(String(second.module_group || ""));
      if (groupDelta !== 0) return groupDelta;
      return Number(first.sort_order || 0) - Number(second.sort_order || 0);
    }) as PresentedPermissionModule<T>[];
}
