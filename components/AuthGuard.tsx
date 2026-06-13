"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import AppShell from "@/components/AppShell";

export default function AuthGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
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

  return <AppShell>{children}</AppShell>;
}