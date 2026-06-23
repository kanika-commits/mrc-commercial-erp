"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import AppShell from "@/components/AppShell";
import { AccessProvider } from "@/components/AccessContext";
import { can, type CurrentUserAccess } from "@/lib/accessControl";

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
  return pathname === "/" || pathname === "/modules";
}

function actionForPath(pathname: string) {
  if (pathname.endsWith("/new")) return "add";
  if (pathname.includes("/edit")) return "edit";
  return "view";
}

function hasRouteAccess(
  pathname: string,
  access: CurrentUserAccess,
  navigation: ModuleNavigation,
) {
  if (isUnrestrictedPath(pathname)) return true;

  if (pathname.startsWith("/settings")) {
    return (
      access.roleCodes.includes("platform_owner") ||
      access.roleCodes.includes("super_admin")
    );
  }

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
  const [accessDenied, setAccessDenied] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [access, setAccess] = useState<CurrentUserAccess | null>(null);
  const [moduleNavigation, setModuleNavigation] =
    useState<ModuleNavigation>(EMPTY_NAVIGATION);
  const [error, setError] = useState<string | null>(null);

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
      const bootstrap = await response.json();

      if (!response.ok) {
        throw new Error(bootstrap.error || "Failed to load app access.");
      }

      const nextAccess = bootstrap.access as CurrentUserAccess;
      const nextNavigation = bootstrap.moduleNavigation || EMPTY_NAVIGATION;

      setAccess(nextAccess);
      setModuleNavigation(nextNavigation);
      setUser(bootstrap.user || nextAccess.user || null);
      setAccessDenied(!hasRouteAccess(pathname, nextAccess, nextNavigation));
    } catch (loadError: any) {
      setError(loadError.message || "Failed to load user access.");
      setAccessDenied(true);
    } finally {
      setAccessLoading(false);
    }
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      if (isLoginPage) {
        setAuthChecked(true);
        setAccessLoading(false);
        return;
      }

      setAuthChecked(false);
      setAccessDenied(false);
      setError(null);

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const currentUser = session?.user || null;

      if (cancelled) return;

      if (!currentUser) {
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
  }, [isLoginPage, loadAccessAndNavigation, router]);

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

  if (accessLoading && !isUnrestrictedPath(pathname)) {
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
