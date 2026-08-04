import { normalizeReleasedGroupName } from "@/lib/releasedModuleRegistry";

export function getModuleGroupDisplayName(groupCode: string, fallback?: string | null) {
  return normalizeReleasedGroupName(groupCode, fallback);
}

export function applyCanonicalModuleGroupNames<T extends { module_code?: string | null; module_name?: string | null }>(
  groups: T[],
) {
  return groups.map((group) => ({
    ...group,
    module_name: getModuleGroupDisplayName(String(group.module_code || ""), group.module_name),
  }));
}
