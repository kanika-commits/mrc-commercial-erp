"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { can, getCurrentUserAccess } from "@/lib/accessControl";

export default function RequirePermission({
  moduleCode,
  actionCode = "view",
  children,
  fallback,
}: {
  moduleCode: string;
  actionCode?: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkAccess() {
      const access = await getCurrentUserAccess();
      setAllowed(can(access.permissions, moduleCode, actionCode));
      setLoading(false);
    }

    checkAccess();
  }, [actionCode, moduleCode]);

  if (loading) {
    return <div className="p-8 text-gray-500">Checking access...</div>;
  }

  if (!allowed) {
    return (
      <>
        {fallback || (
          <div className="p-8">
            <div className="rounded-lg border bg-white p-6 text-sm text-gray-600">
              <h1 className="mb-2 text-xl font-semibold text-gray-900">
                Access Denied
              </h1>
              <p>You do not have permission to view this page.</p>
              <Link
                href="/modules"
                className="mt-4 inline-block rounded border px-4 py-2"
              >
                Back to Modules
              </Link>
            </div>
          </div>
        )}
      </>
    );
  }

  return <>{children}</>;
}
