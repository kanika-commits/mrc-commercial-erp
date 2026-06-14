import { can, getCurrentUserAccess } from "@/lib/accessControl";

type ModuleGroupRow = {
  module_code: string;
  [key: string]: any;
};

type ModuleRow = {
  module_group: string;
  module_code: string;
  [key: string]: any;
};

export async function getVisibleModuleGroups() {
  const { permissions } = await getCurrentUserAccess();

  const response = await fetch("/api/admin/module-navigation");

  if (!response.ok) return [];

  const { groups = [], modules = [] } = await response.json();
  const moduleGroups = groups as ModuleGroupRow[];
  const moduleRows = modules as ModuleRow[];

  const visibleModules = (moduleRows ?? []).filter((module) =>
    can(permissions, module.module_code, "view")
  );

  return (moduleGroups ?? [])
    .filter((group) => group.module_code !== "dashboard")
    .filter((group) =>
      visibleModules.some(
        (module) => module.module_group === group.module_code
      )
    )
    .map((group) => ({
      ...group,
      visible_count: visibleModules.filter(
        (module) => module.module_group === group.module_code
      ).length,
    }));
}

export async function getVisibleModulePages(groupCode: string) {
  const { permissions } = await getCurrentUserAccess();

  const response = await fetch("/api/admin/module-navigation");

  if (!response.ok) return [];

  const { modules = [] } = await response.json();
  const data = (modules as ModuleRow[]).filter(
    (module) => module.module_group === groupCode
  );

  return (data ?? []).filter((module) =>
    can(permissions, module.module_code, "view")
  );
}
