"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import AppShell from "@/components/AppShell";
import { AccessProvider } from "@/components/AccessContext";
import { can, hasGlobalAccess, type CurrentUserAccess } from "@/lib/accessControl";
import { ACCOUNT_INACTIVE_CODE, INACTIVE_ACCOUNT_MESSAGE } from "@/lib/accountStatus";

type ModuleNavigation = {
  groups: any[];
  modules: ModuleRoute[];
};

type ModuleRoute = {
  module_code: string;
  route: string;
};

const EMPTY_NAVIGATION: ModuleNavigation = {
  groups: [],
  modules: [],
};

function isUnrestrictedPath(pathname: string) {
  return pathname === "/modules";
}

function actionForPath(pathname: string) {
  if (pathname.endsWith("/new")) return "add";
  if (pathname.includes("/edit")) return "edit";
  return "view";
}

function hasAnyPermission(
  access: CurrentUserAccess,
  checks: Array<{ moduleCode: string; actionCode: string }>,
) {
  return checks.some((check) =>
    can(access.permissions, check.moduleCode, check.actionCode),
  );
}

function hasAccessibleModuleInGroup(
  access: CurrentUserAccess,
  navigation: ModuleNavigation,
  groupCode: string,
) {
  return (navigation.modules || []).some(
    (module: any) =>
      module.module_group === groupCode &&
      module.module_code &&
      can(access.permissions, module.module_code, "view"),
  );
}

function hasExplicitHrRouteAccess(
  pathname: string,
  access: CurrentUserAccess,
  navigation: ModuleNavigation,
) {
  if (pathname === "/modules/hr") {
    return hasAccessibleModuleInGroup(access, navigation, "hr");
  }

  if (pathname === "/hr/employees/import-documents") {
    return can(access.permissions, "hr_employee_document_import", "view");
  }

  if (pathname === "/hr/employees/import") {
    return can(access.permissions, "hr_employee_import", "view");
  }

  if (
    pathname === "/hr/attendance" ||
    pathname === "/hr/attendance/daily" ||
    pathname === "/hr/attendance/monthly" ||
    /^\/hr\/attendance\/periods\/[^/]+$/.test(pathname)
  ) {
    return can(access.permissions, "hr_attendance", "view");
  }

  if (pathname === "/settings/policies/employee-attendance") {
    return can(access.permissions, "hr_employee_attendance_policy", "view");
  }

  if (pathname === "/hr/attendance-approval") {
    return can(access.permissions, "hr_attendance_approval", "view");
  }

  if (
    pathname === "/hr/employees" ||
    pathname === "/hr/employees/new" ||
    /^\/hr\/employees\/[^/]+(?:\/edit)?$/.test(pathname)
  ) {
    return can(access.permissions, "hr_employees", "view");
  }

  if (pathname === "/hr/departments" || pathname === "/hr/designations") {
    return can(
      access.permissions,
      pathname === "/hr/departments" ? "hr_departments" : "hr_designations",
      "view",
    );
  }

  if (
    pathname === "/hr/reimbursements" ||
    pathname === "/hr/reimbursements/new" ||
    /^\/hr\/reimbursements\/[^/]+(?:\/edit)?$/.test(pathname)
  ) {
    return can(access.permissions, "reimbursements", "view");
  }

  return null;
}

function hasExplicitLabourRouteAccess(pathname: string, access: CurrentUserAccess) {
  if (pathname === "/labour") {
    return hasAnyPermission(access, [
      { moduleCode: "labour_workers", actionCode: "view" },
      { moduleCode: "labour_workers", actionCode: "import" },
      { moduleCode: "labour_contractors", actionCode: "view" },
      { moduleCode: "labour_import", actionCode: "view" },
      { moduleCode: "labour_trades", actionCode: "view" },
      { moduleCode: "labour_site_in", actionCode: "view" },
      { moduleCode: "labour_engineer_daily", actionCode: "view" },
      { moduleCode: "labour_attendance", actionCode: "view" },
      { moduleCode: "labour_attendance_import", actionCode: "view" },
      { moduleCode: "labour_manpower_work_orders", actionCode: "view" },
      { moduleCode: "labour_work_logs", actionCode: "view" },
      { moduleCode: "labour_daily_submission", actionCode: "view" },
      { moduleCode: "labour_muster_configuration", actionCode: "view" },
      { moduleCode: "labour_attendance_policy", actionCode: "view" },
      { moduleCode: "labour_wages", actionCode: "view" },
      { moduleCode: "labour_advances", actionCode: "view" },
    ]);
  }

  if (pathname === "/labour/workers/import") {
    return can(access.permissions, "labour_workers", "import");
  }

  if (pathname === "/labour/attendance/import") {
    return can(access.permissions, "labour_attendance_import", "view");
  }

  if (
    pathname === "/labour/workers" ||
    pathname === "/labour/workers/new" ||
    /^\/labour\/workers\/[^/]+(?:\/edit)?$/.test(pathname)
  ) {
    return can(access.permissions, "labour_workers", "view");
  }

  if (
    pathname === "/labour/contractors" ||
    /^\/labour\/contractors\/[^/]+(?:\/edit)?$/.test(pathname)
  ) {
    return can(access.permissions, "labour_contractors", "view");
  }

  if (pathname === "/labour/trades") {
    return can(access.permissions, "labour_trades", "view");
  }

  if (pathname === "/labour/site-in") {
    return can(access.permissions, "labour_site_in", "view");
  }

  if (pathname === "/labour/engineer-daily") {
    return can(access.permissions, "labour_engineer_daily", "view");
  }

  if (pathname === "/labour/teams") {
    return can(access.permissions, "labour_engineer_groups", "view");
  }

  if (pathname === "/labour/attendance/daily" || pathname === "/labour/attendance/register" || pathname === "/labour/muster") {
    return can(access.permissions, "labour_attendance", "view");
  }

  if (
    pathname === "/labour/manpower-work-orders" ||
    pathname === "/labour/manpower-work-orders/new" ||
    /^\/labour\/manpower-work-orders\/[^/]+(?:\/edit)?$/.test(pathname)
  ) {
    return can(access.permissions, "labour_manpower_work_orders", "view");
  }

  if (pathname === "/labour/work-logs") {
    return can(access.permissions, "labour_work_logs", "view");
  }

  if (pathname === "/labour/approvals") {
    return can(access.permissions, "labour_daily_submission", "view") || can(access.permissions, "labour_attendance", "view");
  }

  if (pathname === "/labour/configuration") {
    return can(access.permissions, "labour_muster_configuration", "view");
  }

  if (pathname === "/labour/dashboard") {
    return can(access.permissions, "labour_attendance", "view");
  }

  if (pathname === "/labour/settings") {
    return can(access.permissions, "labour_attendance_policy", "view");
  }

  if (pathname === "/labour/wages" || /^\/labour\/wages\/[^/]+$/.test(pathname)) {
    return can(access.permissions, "labour_wages", "view");
  }

  if (pathname === "/labour/advances") {
    return can(access.permissions, "labour_advances", "view");
  }

  return null;
}

function hasRouteAccess(
  pathname: string,
  access: CurrentUserAccess,
  navigation: ModuleNavigation,
) {
  if (isUnrestrictedPath(pathname)) return true;

  const globalAccess = hasGlobalAccess(access);

  if (globalAccess) return true;

  if (pathname === "/") {
    return can(access.permissions, "dashboard", "view");
  }

  if (pathname === "/reports" || pathname.startsWith("/reports/")) {
    return can(access.permissions, "reports", "view");
  }

  if (pathname === "/settings" || pathname === "/settings/password") return true;

  if (pathname === "/settings/policies/employee-attendance") {
    return can(access.permissions, "hr_employee_attendance_policy", "view");
  }

  if (pathname.startsWith("/settings")) {
    return globalAccess;
  }

  const explicitHrAccess = hasExplicitHrRouteAccess(pathname, access, navigation);
  if (explicitHrAccess !== null) return explicitHrAccess;

  const explicitLabourAccess = hasExplicitLabourRouteAccess(pathname, access);
  if (explicitLabourAccess !== null) return explicitLabourAccess;

  const matchedModule = (navigation.modules || [])
    .filter(
      (module) => pathname === module.route || pathname.startsWith(`${module.route}/`),
    )
    .sort((a, b) => b.route.length - a.route.length)[0];

  if (!matchedModule) return true;

  return can(access.permissions, matchedModule.module_code, actionForPath(pathname));
}

export default function AuthGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";
  const [authChecked, setAuthChecked] = useState(false);
  const [accessLoading, setAccessLoading] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [access, setAccess] = useState<CurrentUserAccess | null>(null);
  const [moduleNavigation, setModuleNavigation] =
    useState<ModuleNavigation>(EMPTY_NAVIGATION);
  const [error, setError] = useState<string | null>(null);
  const userRef = useRef<User | null>(null);
  const accessRef = useRef<CurrentUserAccess | null>(null);
  const moduleNavigationRef = useRef<ModuleNavigation>(EMPTY_NAVIGATION);

  useEffect(() => {
    userRef.current = user;
    accessRef.current = access;
    moduleNavigationRef.current = moduleNavigation;
  }, [access, moduleNavigation, user]);

  const clearAccessState = useCallback(() => {
    setUser(null);
    setAccess(null);
    setModuleNavigation(EMPTY_NAVIGATION);
    setError(null);
  }, []);

  const loadAccessAndNavigation = useCallback(async (accessToken?: string) => {
    setAccessLoading(true);
    setError(null);

    try {
      let token = accessToken;

      if (!token) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        token = session?.access_token;
      }

      if (!token) {
        throw new Error("Missing auth session.");
      }

      const response = await fetch("/api/admin/bootstrap", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const bootstrap = await response.json().catch(() => null);

      if (!response.ok) {
        const message = bootstrap?.error || "Failed to load app access.";

        if (bootstrap?.code === ACCOUNT_INACTIVE_CODE) {
          window.sessionStorage.setItem("auth_notice", INACTIVE_ACCOUNT_MESSAGE);
          await supabase.auth.signOut();
          clearAccessState();
          router.replace(`/login?account=${ACCOUNT_INACTIVE_CODE}`);
          throw new Error(message || INACTIVE_ACCOUNT_MESSAGE);
        }

        throw new Error(message);
      }

      const nextAccess = bootstrap.access as CurrentUserAccess;
      const nextNavigation = bootstrap.moduleNavigation || EMPTY_NAVIGATION;

      setAccess(nextAccess);
      setModuleNavigation(nextNavigation);
      setUser(bootstrap.user || nextAccess.user || null);
    } catch (loadError: any) {
      setError(loadError.message || "Failed to load user access.");
      setAccess(null);
      setModuleNavigation(EMPTY_NAVIGATION);
    } finally {
      setAccessLoading(false);
    }
  }, [clearAccessState, router]);

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      if (isLoginPage) {
        setAuthChecked(true);
        setAccessLoading(false);
        return;
      }

      setAuthChecked(false);
      setError(null);

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const currentUser = session?.user || null;

      if (cancelled) return;

      if (!currentUser) {
        clearAccessState();
        router.replace("/login");
        return;
      }

      setUser(currentUser);
      setAuthChecked(true);
      await loadAccessAndNavigation(session?.access_token);
    }

    checkAuth();

    return () => {
      cancelled = true;
    };
  }, [clearAccessState, isLoginPage, loadAccessAndNavigation, router]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        clearAccessState();
        setAuthChecked(false);
        const inactiveAccountNotice =
          window.sessionStorage.getItem("auth_notice") === INACTIVE_ACCOUNT_MESSAGE;
        router.replace(
          inactiveAccountNotice ? `/login?account=${ACCOUNT_INACTIVE_CODE}` : "/login",
        );
        return;
      }

      if (event === "SIGNED_IN") {
        if (!session?.access_token || isLoginPage) return;
        setUser(session.user);
        setAuthChecked(true);

        const bootstrapMissing =
          !accessRef.current ||
          (moduleNavigationRef.current.modules || []).length === 0 ||
          userRef.current?.id !== session.user.id;

        if (bootstrapMissing) {
          loadAccessAndNavigation(session.access_token);
        }
        return;
      }

      if (event === "TOKEN_REFRESHED") {
        if (!session?.user || isLoginPage) return;
        setUser(session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, [clearAccessState, isLoginPage, loadAccessAndNavigation, router]);

  const accessDenied = useMemo(() => {
    if (isLoginPage) return false;
    if (!authChecked) return false;
    if (isUnrestrictedPath(pathname)) return false;
    if (error && !access) return true;
    if (accessLoading || !access) return false;
    return !hasRouteAccess(pathname, access, moduleNavigation);
  }, [access, accessLoading, authChecked, error, isLoginPage, moduleNavigation, pathname]);

  useEffect(() => {
    if (pathname === "/" && accessDenied && access) {
      router.replace("/modules");
    }
  }, [access, accessDenied, pathname, router]);

  const contextValue = useMemo(
    () => ({
      user,
      access,
      moduleNavigation,
      loading: accessLoading,
      error,
      refresh: loadAccessAndNavigation,
    }),
    [access, accessLoading, error, loadAccessAndNavigation, moduleNavigation, user],
  );

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (!authChecked) {
    return <div className="p-8 text-gray-500">Checking login...</div>;
  }

  if (accessDenied) {
    return (
      <AccessProvider value={contextValue}>
        <AppShell>
          <div className="p-8">
            <div className="rounded-lg border bg-white p-6 text-sm text-gray-600">
              <h1 className="mb-2 text-xl font-semibold text-gray-900">
                Access Denied
              </h1>
              <p>You do not have permission to view this page.</p>
            </div>
          </div>
        </AppShell>
      </AccessProvider>
    );
  }

  if (accessLoading && !access && !isUnrestrictedPath(pathname)) {
    return (
      <AccessProvider value={contextValue}>
        <AppShell>
          <div className="p-8 text-sm font-medium text-slate-500">
            Checking access...
          </div>
        </AppShell>
      </AccessProvider>
    );
  }

  return (
    <AccessProvider value={contextValue}>
      <AppShell>{children}</AppShell>
    </AccessProvider>
  );
}
