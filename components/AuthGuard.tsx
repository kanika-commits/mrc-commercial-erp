"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import AppShell from "@/components/AppShell";
import { can, getCurrentUserAccess } from "@/lib/accessControl";

type ModuleRoute = {
  module_code: string;
  route: string;
};

export default function AuthGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const isLoginPage = pathname === "/login";

  useEffect(() => {
    async function checkAuth() {
      if (isLoginPage) {
        setChecking(false);
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      const unrestrictedPaths = ["/", "/modules"];

      if (!unrestrictedPaths.includes(pathname)) {
        const [access, navigationResponse] = await Promise.all([
          getCurrentUserAccess(),
          fetch("/api/admin/module-navigation"),
        ]);

        if (navigationResponse.ok) {
          const navigation = await navigationResponse.json();
          const modules: ModuleRoute[] = navigation.modules || [];
          const matchedModule = modules
            .filter(
              (module) =>
                pathname === module.route || pathname.startsWith(`${module.route}/`)
            )
            .sort((a, b) => b.route.length - a.route.length)[0];

          if (matchedModule) {
            const actionCode = pathname.endsWith("/new")
              ? "add"
              : pathname.includes("/edit")
              ? "edit"
              : "view";

            if (!can(access.permissions, matchedModule.module_code, actionCode)) {
              setAccessDenied(true);
              setChecking(false);
              return;
            }
          }
        }
      }

      setAccessDenied(false);
      setChecking(false);
    }

    checkAuth();
  }, [isLoginPage, router]);

  if (checking) {
    return <div className="p-8 text-gray-500">Checking login...</div>;
  }

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (accessDenied) {
    return (
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
    );
  }

  return <AppShell>{children}</AppShell>;
}
