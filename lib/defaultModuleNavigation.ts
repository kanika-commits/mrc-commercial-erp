import {
  RELEASED_GROUPS,
  RELEASED_MODULES,
  getReleasedGroup,
  isReleasedModuleCode,
  normalizeReleasedGroupName,
} from "@/lib/releasedModuleRegistry";

type NavigationGroup = {
  id: string;
  module_code: string;
  module_name: string;
  route: string;
  sort_order: number;
  status: string;
};

type NavigationModule = {
  id: string;
  module_group: string;
  module_code: string;
  module_name: string;
  route: string;
  sort_order: number;
  status: string;
};

export type ModuleNavigation = {
  groups: NavigationGroup[];
  modules: NavigationModule[];
};

function releasedGroupRow(group: (typeof RELEASED_GROUPS)[number]): NavigationGroup {
  return {
    id: `released-${group.code}`,
    module_code: group.code,
    module_name: group.title,
    route: group.route,
    sort_order: group.sortOrder,
    status: "active",
  };
}

function releasedModuleRow(module: (typeof RELEASED_MODULES)[number]): NavigationModule {
  return {
    id: `released-${module.code}`,
    module_group: module.group,
    module_code: module.code,
    module_name: module.title,
    route: module.route,
    sort_order: module.sortOrder,
    status: "active",
  };
}

function normalizeModule(module: any): NavigationModule | null {
  const moduleCode = String(module?.module_code || "").trim();
  if (!isReleasedModuleCode(moduleCode)) return null;

  const released = RELEASED_MODULES.find(
    (item) => item.code === moduleCode || item.permissionModule === moduleCode,
  );
  if (!released) return null;

  return {
    id: module.id || `released-${released.code}`,
    module_group: released.group,
    module_code: released.code,
    module_name: released.title,
    route: released.route,
    sort_order: released.sortOrder,
    status: "active",
  };
}

function normalizeGroup(group: any): NavigationGroup | null {
  const groupCode = String(group?.module_code || "").trim();
  const released = getReleasedGroup(groupCode);
  if (!released) return null;

  return {
    id: group.id || `released-${released.code}`,
    module_code: released.code,
    module_name: normalizeReleasedGroupName(released.code, group.module_name),
    route: released.route,
    sort_order: released.sortOrder,
    status: "active",
  };
}

export function filterVisibleModuleNavigation<T extends { groups: any[]; modules: any[] }>(
  navigation: T,
): ModuleNavigation {
  const groupMap = new Map<string, NavigationGroup>();
  const moduleMap = new Map<string, NavigationModule>();

  RELEASED_GROUPS.forEach((group) => groupMap.set(group.code, releasedGroupRow(group)));
  RELEASED_MODULES.forEach((module) => moduleMap.set(module.code, releasedModuleRow(module)));

  (navigation.groups || []).forEach((group) => {
    const normalized = normalizeGroup(group);
    if (normalized) groupMap.set(normalized.module_code, normalized);
  });

  (navigation.modules || []).forEach((module) => {
    const normalized = normalizeModule(module);
    if (normalized) moduleMap.set(normalized.module_code, normalized);
  });

  return {
    groups: Array.from(groupMap.values()).sort((first, second) => first.sort_order - second.sort_order),
    modules: Array.from(moduleMap.values()).sort((first, second) => {
      if (first.module_group === second.module_group) return first.sort_order - second.sort_order;
      return first.module_group.localeCompare(second.module_group);
    }),
  };
}

export const DEFAULT_MODULE_NAVIGATION = filterVisibleModuleNavigation({
  groups: [],
  modules: [],
});
