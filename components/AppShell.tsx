"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Bell,
  Building2,
  FileText,
  Home,
  LayoutGrid,
  RefreshCcw,
  Settings,
} from "lucide-react";
import UserHeader from "@/components/UserHeader";
import { supabase } from "@/lib/supabase";
import {
  can,
  getCurrentUserAccess,
  hasSiteRestriction,
  type UserPermission,
} from "@/lib/accessControl";

const sidebarItems = [
  { label: "Dashboard", href: "/", icon: Home, groupCode: "dashboard" },
  { label: "Modules", href: "/modules", icon: LayoutGrid, superOnly: true },
  { label: "Master Setup", href: "/modules/master-setup", icon: Building2, groupCode: "master_setup" },
  { label: "Contract Management", href: "/modules/contract-management", icon: FileText, groupCode: "contract_management" },
  { label: "Reports", href: "/modules/reports", icon: BarChart3, groupCode: "reports" },
  { label: "Administration", href: "/modules/administration", icon: Settings, groupCode: "administration" },
];

const notificationLinks = [
  {
    label: "Pending Work Orders",
    key: "pendingWorkOrders",
    href: "/approvals/work-orders",
  },
  {
    label: "Pending RA Bills",
    key: "pendingRaBills",
    href: "/approvals",
  },
  {
    label: "Pending Debit Notes",
    key: "pendingDebitNotes",
    href: "/approvals",
  },
  {
    label: "Pending ITC Review",
    key: "pendingItcReview",
    href: "/invoices/itc",
  },
] as const;

type NotificationCounts = Record<(typeof notificationLinks)[number]["key"], number>;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [visibleGroupCodes, setVisibleGroupCodes] = useState<Set<string>>(new Set());
  const [permissions, setPermissions] = useState<UserPermission[]>([]);
  const [roleCodes, setRoleCodes] = useState<string[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationCounts, setNotificationCounts] = useState<NotificationCounts>({
    pendingWorkOrders: 0,
    pendingRaBills: 0,
    pendingDebitNotes: 0,
    pendingItcReview: 0,
  });

  useEffect(() => {
    async function loadNavigationAccess() {
      const [access, navigationResponse] = await Promise.all([
        getCurrentUserAccess(),
        fetch("/api/admin/module-navigation"),
      ]);

      setPermissions(access.permissions || []);
      setRoleCodes(access.roleCodes || []);
      loadNotificationCounts(access);

      if (!navigationResponse.ok) {
        setVisibleGroupCodes(new Set());
        return;
      }

      const navigation = await navigationResponse.json();
      const modules = navigation.modules || [];
      const nextVisibleGroups = new Set<string>();

      modules.forEach((module: any) => {
        if (can(access.permissions, module.module_code, "view")) {
          nextVisibleGroups.add(module.module_group);
        }
      });

      setVisibleGroupCodes(nextVisibleGroups);
    }

    loadNavigationAccess();
  }, []);

  useEffect(() => {
    setNotificationsOpen(false);
  }, [pathname]);

  async function loadNotificationCounts(access: Awaited<ReturnType<typeof getCurrentUserAccess>>) {
    try {
      const restrictedSiteIds = hasSiteRestriction(access) ? access.sites : [];
      let allowedWorkOrderIds: string[] | null = null;

      if (restrictedSiteIds.length > 0) {
        const { data: allowedWorkOrders, error } = await supabase
          .from("work_orders")
          .select("id")
          .in("site_id", restrictedSiteIds);

        if (error) throw error;

        allowedWorkOrderIds = (allowedWorkOrders || [])
          .map((workOrder) => workOrder.id)
          .filter(Boolean);
      }

      const applyWorkOrderScope = (query: any, column = "work_order_id") => {
        if (allowedWorkOrderIds === null) return query;
        if (allowedWorkOrderIds.length === 0) return null;
        return query.in(column, allowedWorkOrderIds);
      };

      const pendingWorkOrdersQuery = applyWorkOrderScope(
        supabase
          .from("work_orders")
          .select("id", { count: "exact", head: true })
          .ilike("approval_status", "pending"),
        "id",
      );
      const pendingRaBillsQuery = applyWorkOrderScope(
        supabase
          .from("ra_bills")
          .select("id", { count: "exact", head: true })
          .ilike("approval_status", "pending"),
      );
      const pendingDebitNotesQuery = applyWorkOrderScope(
        supabase
          .from("debit_notes")
          .select("id", { count: "exact", head: true })
          .ilike("approval_status", "pending"),
      );
      const pendingItcQuery = applyWorkOrderScope(
        supabase
          .from("invoices")
          .select("id", { count: "exact", head: true })
          .or("itc_status.is.null,itc_status.ilike.pending"),
      );

      const [
        pendingWorkOrders,
        pendingRaBills,
        pendingDebitNotes,
        pendingItcReview,
      ] = await Promise.all([
        pendingWorkOrdersQuery || Promise.resolve({ count: 0, error: null }),
        pendingRaBillsQuery || Promise.resolve({ count: 0, error: null }),
        pendingDebitNotesQuery || Promise.resolve({ count: 0, error: null }),
        pendingItcQuery || Promise.resolve({ count: 0, error: null }),
      ]);

      for (const result of [
        pendingWorkOrders,
        pendingRaBills,
        pendingDebitNotes,
        pendingItcReview,
      ]) {
        if (result.error) throw result.error;
      }

      setNotificationCounts({
        pendingWorkOrders: pendingWorkOrders.count || 0,
        pendingRaBills: pendingRaBills.count || 0,
        pendingDebitNotes: pendingDebitNotes.count || 0,
        pendingItcReview: pendingItcReview.count || 0,
      });
    } catch (error) {
      console.error("Notification count load failed:", error);
    }
  }

  const visibleSidebarItems = sidebarItems.filter((item) => {
    if (item.superOnly) {
      return (
        roleCodes.includes("platform_owner") ||
        roleCodes.includes("super_admin") ||
        can(permissions, "*", "*")
      );
    }
    if (item.groupCode === "dashboard") {
      return can(permissions, "dashboard", "view");
    }
    if (!item.groupCode) return true;
    return visibleGroupCodes.has(item.groupCode);
  });
  const totalNotifications = Object.values(notificationCounts).reduce(
    (sum, value) => sum + value,
    0,
  );

  return (
    <div className="min-h-screen bg-[#f3f6f8]">
      <aside className="fixed left-0 top-0 z-40 flex h-screen w-[224px] flex-col bg-black px-4 py-8 text-white">
        <Link href="/" className="mb-8 block px-2">
          <h1 className="text-2xl font-bold tracking-tight">ConstructIQ</h1>
          <p className="mt-2 text-sm font-medium text-white/50">
            Enterprise ERP
          </p>
        </Link>

        <nav className="space-y-2">
          {visibleSidebarItems.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            const showDivider = item.groupCode === "master_setup";

            return (
              <div key={item.href}>
                {showDivider && (
                  <div className="my-5 border-t border-white/10" />
                )}

                <Link
                  href={item.href}
                  className={`flex h-13 items-center gap-3 rounded-md px-3 text-sm font-bold transition ${
                    active
                      ? "bg-[#7bc8ef] text-[#07516c]"
                      : "text-white/60 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              </div>
            );
          })}
        </nav>

        <div className="mt-auto space-y-2 border-t border-white/10 pt-7">
          {visibleGroupCodes.has("administration") && (
            <Link
              href="/settings/appearance"
              className="flex h-12 items-center gap-3 rounded-md px-3 text-sm font-bold text-white/55 transition hover:bg-white/10 hover:text-white"
            >
              <Settings className="h-5 w-5" />
              Settings
            </Link>
          )}
          <div className="flex h-12 items-center gap-3 rounded-md px-3 text-sm font-bold text-white/55">
            <span className="grid h-5 w-5 place-items-center rounded-full border border-white/55 text-xs">
              ?
            </span>
            Support
          </div>
        </div>
      </aside>

      <main className="min-h-screen pl-[224px]">
        <header className="sticky top-0 z-30 border-b border-[#d7dde3] bg-[#fbf9fa] px-10 py-4">
          <div className="flex flex-wrap items-center justify-end gap-4">
            <div className="flex items-center gap-5">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNotificationsOpen((open) => !open)}
                  className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 transition hover:bg-slate-100"
                  aria-label="Notifications"
                  aria-expanded={notificationsOpen}
                >
                  <Bell className="h-5 w-5" />
                  {totalNotifications > 0 && (
                    <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-4 text-white">
                      {totalNotifications}
                    </span>
                  )}
                </button>

                {notificationsOpen && (
                  <div className="absolute right-0 top-11 z-50 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
                    <div className="border-b border-slate-100 px-2 pb-2">
                      <p className="text-sm font-bold text-slate-950">
                        Notifications
                      </p>
                      <p className="text-xs text-slate-500">
                        Pending workflow alerts
                      </p>
                    </div>

                    {totalNotifications === 0 ? (
                      <div className="px-2 py-4 text-sm text-slate-500">
                        No pending alerts
                      </div>
                    ) : (
                      <div className="mt-2 space-y-1">
                        {notificationLinks
                          .filter((item) => notificationCounts[item.key] > 0)
                          .map((item) => (
                            <Link
                              key={item.key}
                              href={item.href}
                              className="flex items-center justify-between rounded-lg px-2 py-2 text-sm transition hover:bg-slate-50"
                            >
                              <span className="font-medium text-slate-700">
                                {item.label}
                              </span>
                              <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-bold text-white">
                                {notificationCounts[item.key]}
                              </span>
                            </Link>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 transition hover:bg-slate-100"
                aria-label="Refresh"
              >
                <RefreshCcw className="h-5 w-5" />
              </button>
              <div className="hidden h-8 w-px bg-slate-300 md:block" />
              <UserHeader />
            </div>
          </div>
        </header>

        <div>{children}</div>
      </main>
    </div>
  );
}
