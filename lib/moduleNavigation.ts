import { supabase } from "@/lib/supabase";
import { can, getCurrentUserAccess } from "@/lib/accessControl";

export async function getVisibleModuleGroups() {
  const { permissions } = await getCurrentUserAccess();

  const { data: groups } = await supabase
    .from("erp_module_groups")
    .select("*")
    .eq("status", "active")
    .order("sort_order");

  const { data: modules } = await supabase
    .from("erp_modules")
    .select("*")
    .eq("status", "active")
    .order("sort_order");

  const visibleModules = (modules ?? []).filter((module) =>
    can(permissions, module.module_code, "view")
  );

  return (groups ?? [])
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

  const { data } = await supabase
    .from("erp_modules")
    .select("*")
    .eq("status", "active")
    .eq("module_group", groupCode)
    .order("sort_order");

  return (data ?? []).filter((module) =>
    can(permissions, module.module_code, "view")
  );
}