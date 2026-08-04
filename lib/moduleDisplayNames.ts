const MODULE_GROUP_DISPLAY_NAMES: Record<string, string> = {
  project_management: "Project Management",
  store_management: "Store Management",
  hr: "Human Resources",
  purchase: "Purchase",
  accounts: "Accounts/Finance",
  settings: "Settings",
  administration: "Admin",
  reports: "Reports",
  support: "Support",
};

export function getModuleGroupDisplayName(
  moduleCode: string | null | undefined,
  fallback?: string | null,
) {
  if (moduleCode && MODULE_GROUP_DISPLAY_NAMES[moduleCode]) {
    return MODULE_GROUP_DISPLAY_NAMES[moduleCode];
  }

  return fallback || moduleCode || "Module";
}

export function applyCanonicalModuleGroupNames<T extends { module_code?: string | null; module_name?: string | null }>(
  groups: T[],
) {
  return groups.map((group) => ({
    ...group,
    module_name: getModuleGroupDisplayName(group.module_code, group.module_name),
  }));
}
