import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { applyCanonicalModuleGroupNames } from "@/lib/moduleDisplayNames";
import { filterVisibleModuleNavigation } from "@/lib/defaultModuleNavigation";
import { loadActiveAccountContext } from "@/lib/serverAccountAccess";

type Permission = {
  module_code: string;
  action_code: string;
  allowed: boolean;
};

const MODULE_NAVIGATION_TTL_MS = 60 * 1000;

type ModuleNavigation = {
  groups: any[];
  modules: any[];
};

let moduleNavigationCache:
  | {
      expiresAt: number;
      value: ModuleNavigation;
    }
  | null = null;

export async function GET(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    }

    if (!serviceRoleKey) {
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
    }

    const authClient = createClient(supabaseUrl, anonKey);
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser(token);

    if (userError) throw userError;

    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 401 });
    }

    const navigationPromise =
      moduleNavigationCache && moduleNavigationCache.expiresAt > Date.now()
        ? Promise.resolve(moduleNavigationCache.value)
        : Promise.all([
            adminClient
              .from("erp_module_groups")
              .select("id, module_code, module_name, route, sort_order, status")
              .eq("status", "active")
              .order("sort_order"),
            adminClient
              .from("erp_modules")
              .select("id, module_group, module_code, module_name, route, sort_order, status")
              .eq("status", "active")
              .order("sort_order"),
          ]).then(([groups, modules]) => {
            if (groups.error) throw groups.error;
            if (modules.error) throw modules.error;

            const value = filterVisibleModuleNavigation({
              groups: applyCanonicalModuleGroupNames(groups.data || []),
              modules: modules.data || [],
            });

            if (value.groups.length > 0 || value.modules.length > 0) {
              moduleNavigationCache = {
                expiresAt: Date.now() + MODULE_NAVIGATION_TTL_MS,
                value,
              };
            }

            return value;
          });

    const accountContext = await loadActiveAccountContext(adminClient, user);

    if ("response" in accountContext) {
      return accountContext.response;
    }

    const moduleNavigation = await navigationPromise;

    return NextResponse.json({
      user,
      access: {
        user,
        roleCodes: accountContext.roleCodes,
        permissions: accountContext.permissions as Permission[],
        organizations: accountContext.organizations,
        companies: accountContext.companies,
        sites: accountContext.sites,
        isGlobalAccess: accountContext.isGlobalAccess,
      },
      moduleNavigation,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load app bootstrap." },
      { status: 500 },
    );
  }
}
