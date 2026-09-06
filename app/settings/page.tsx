"use client";

import Link from "next/link";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";

export default function SettingsPage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const roleCodes = access?.roleCodes || [];
  const canManageAppearance =
    roleCodes.includes("platform_owner") || can(permissions, "*", "*");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-950">Settings</h1>
        <p className="text-slate-500">Manage your account and ERP preferences.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Link
          href="/settings/password"
          className="rounded-lg border bg-white p-6 shadow-sm transition hover:border-blue-200 hover:shadow-md"
        >
          <h2 className="text-xl font-semibold text-slate-950">Change Password</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Update your own login password using your current password.
          </p>
        </Link>

        {canManageAppearance && (
          <Link
            href="/settings/appearance"
            className="rounded-lg border bg-white p-6 shadow-sm transition hover:border-blue-200 hover:shadow-md"
          >
            <h2 className="text-xl font-semibold text-slate-950">Appearance</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Adjust ConstructIQ display density and typography on this device.
            </p>
          </Link>
        )}

        {(roleCodes.includes("platform_owner") ||
          can(permissions, "procurement_purchase_orders", "view") ||
          can(permissions, "procurement_purchase_orders", "add") ||
          can(permissions, "procurement_purchase_orders", "edit")) && (
          <Link href="/settings/purchase-order-masters" className="rounded-lg border bg-white p-6 shadow-sm transition hover:border-blue-200 hover:shadow-md">
            <h2 className="text-xl font-semibold text-slate-950">Purchase Order Master Data</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">Manage company billing addresses, site delivery contacts, and standard terms.</p>
          </Link>
        )}
      </div>
    </div>
  );
}
