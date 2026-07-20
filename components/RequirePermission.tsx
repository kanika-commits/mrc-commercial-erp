"use client";

import Link from "next/link";
import { useAccessContext } from "@/components/AccessContext";
import { can, hasGlobalAccess } from "@/lib/accessControl";

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
  const { access, loading } = useAccessContext();
  const permissions = access?.permissions || [];
  const allowed =
    hasGlobalAccess(access) ||
    can(permissions, moduleCode, actionCode);

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
