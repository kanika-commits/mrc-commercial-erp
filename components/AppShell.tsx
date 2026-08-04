"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Building2,
  ChevronDown,
  FileText,
  Home,
  LayoutGrid,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCcw,
  Settings,
  ShoppingCart,
  UsersRound,
  X,
} from "lucide-react";
import UserHeader from "@/components/UserHeader";
import { useAccessContext } from "@/components/AccessContext";
import {
  EMPTY_NOTIFICATION_COUNTS,
  NotificationCountsProvider,
  type NotificationCounts,
} from "@/components/NotificationCountsContext";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { DEFAULT_MODULE_NAVIGATION } from "@/lib/defaultModuleNavigation";
import { RELEASED_MODULES } from "@/lib/releasedModuleRegistry";
import { supabase } from "@/lib/supabase";

const sidebarGroupMeta = {
  project_management: { label: "Project Management", href: "/modules/project-management", icon: FileText },
  purchase: { label: "Purchase", href: "/modules/purchase", icon: ShoppingCart },
  accounts: { label: "Accounts/Finance", href: "/modules/accounts", icon: Building2 },
  settings: { label: "Settings", href: "/modules/settings", icon: Settings },
  administration: { label: "Admin", href: "/modules/administration", icon: Settings },
  hr: { label: "Human Resources", href: "/modules/hr", icon: UsersRound },
} as const;

type SidebarLeaf = {
  type: "leaf";
  label: string;
  href: string;
  moduleCode: string;
};

type SidebarPlaceholder = {
  type: "placeholder";
  label: string;
};

type SidebarNode = SidebarLeaf | SidebarPlaceholder | SidebarNestedGroup;

type SidebarNestedGroup = {
  type: "group";
  label: string;
  id: string;
  href?: string;
  icon?: typeof Home;
  children: SidebarNode[];
};

type SidebarTopGroup = {
  id: keyof typeof sidebarGroupMeta | "dashboard" | "modules";
  label: string;
  href: string;
  icon: typeof Home;
  children?: SidebarNode[];
  superOnly?: boolean;
};

function findActiveSidebarLeaf(pathname: string, items: SidebarTopGroup[]) {
  const collectLeaves = (nodes: SidebarNode[] | undefined): SidebarLeaf[] =>
    (nodes || []).flatMap((node) => {
      if (node.type === "leaf") return [node];
      if (node.type === "group") return collectLeaves(node.children);
      return [];
    });

  return items
    .flatMap((item) => collectLeaves(item.children))
    .filter((child) => pathname === child.href || pathname.startsWith(`${child.href}/`))
    .sort((first, second) => second.href.length - first.href.length)[0] || null;
}

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

const SIDEBAR_COLLAPSED_STORAGE_KEY = "constructiq-sidebar-collapsed";
const SIDEBAR_EXPANDED_GROUPS_STORAGE_KEY = "constructiq-sidebar-expanded-groups";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const {
    access,
    moduleNavigation,
    loading: accessLoading,
    user,
  } = useAccessContext();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationCounts, setNotificationCounts] = useState<NotificationCounts>(
    EMPTY_NOTIFICATION_COUNTS,
  );
  const [notificationCountsLoading, setNotificationCountsLoading] = useState(false);
  const [notificationCountsLoaded, setNotificationCountsLoaded] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [expandedTopGroup, setExpandedTopGroup] = useState<string | null>(null);
  const [expandedNestedGroups, setExpandedNestedGroups] = useState<Set<string>>(new Set());
  const notificationsStartedRef = useRef(false);

  const permissions = access?.permissions || [];
  const globalAccess = hasGlobalAccess(access);
  const effectiveNavigation =
    globalAccess && (moduleNavigation.groups || []).length === 0
      ? DEFAULT_MODULE_NAVIGATION
      : moduleNavigation;
  const dashboardHref = globalAccess || can(permissions, "dashboard", "view") ? "/" : "/modules";
  const compactSidebar = sidebarCollapsed && !mobileSidebarOpen;
  const navigationModuleCodes = useMemo(
    () =>
      new Set(
        (effectiveNavigation.modules || [])
          .map((module: any) => String(module.module_code || ""))
          .filter(Boolean),
      ),
    [effectiveNavigation.modules],
  );
  const canViewModule = useCallback(
    (moduleCode: string) => globalAccess || can(permissions, moduleCode, "view"),
    [globalAccess, permissions],
  );

  const sidebarTree = useMemo<SidebarTopGroup[]>(() => {
    const compact = <T,>(items: Array<T | null>) => items.filter(Boolean) as T[];
    const releasedLeaf = (moduleCode: string): SidebarLeaf | null => {
      const releasedModule = RELEASED_MODULES.find(
        (module) => module.code === moduleCode && module.sidebar,
      );
      if (!releasedModule) return null;
      if (!navigationModuleCodes.has(releasedModule.permissionModule)) return null;
      if (!canViewModule(releasedModule.permissionModule)) return null;
      return {
        type: "leaf",
        label: releasedModule.title,
        moduleCode: releasedModule.permissionModule,
        href: releasedModule.route,
      };
    };
    const nested = (
      id: string,
      label: string,
      children: Array<SidebarNode | null>,
      href?: string,
      icon?: typeof Home,
    ): SidebarNestedGroup | null => {
      const visibleChildren = compact(children);
      if (visibleChildren.length === 0) return null;
      return { type: "group", id, label, href, icon, children: visibleChildren };
    };

    const moduleGroups = compact<SidebarNestedGroup>([
      nested(
        "module-project-management",
        "Project Management",
        [
          releasedLeaf("ra_bills"),
          releasedLeaf("debit_notes"),
          releasedLeaf("ra_approval"),
        ],
        "/modules/project-management",
        FileText,
      ),
      nested(
        "module-purchase",
        "Purchase",
        [
          releasedLeaf("work_orders"),
          releasedLeaf("wo_approval"),
        ],
        "/modules/purchase",
        ShoppingCart,
      ),
      nested(
        "module-accounts",
        "Accounts/Finance",
        [
          releasedLeaf("invoices"),
          releasedLeaf("payments"),
          releasedLeaf("itc_claims"),
        ],
        "/modules/accounts",
        Building2,
      ),
      nested(
        "module-hr",
        "Human Resources",
        [
          releasedLeaf("hr_employees"),
          releasedLeaf("hr_employee_import"),
          releasedLeaf("reimbursements"),
          releasedLeaf("hr_departments"),
          releasedLeaf("hr_designations"),
        ],
        "/modules/hr",
        UsersRound,
      ),
      nested(
        "module-settings",
        "Settings",
        [
          nested("settings-masters", "Masters", [
            releasedLeaf("companies"),
            releasedLeaf("sites"),
            releasedLeaf("vendors"),
            releasedLeaf("company_bank_accounts"),
          ]),
        ],
        "/modules/settings",
        Settings,
      ),
    ]);

    const adminChildren = compact<SidebarNode>([
      releasedLeaf("organizations"),
      releasedLeaf("users"),
      releasedLeaf("roles"),
      releasedLeaf("permissions"),
    ]);

    const topGroups: SidebarTopGroup[] = compact([
      canViewModule("dashboard")
        ? { id: "dashboard", label: "Dashboard", href: dashboardHref, icon: Home }
        : null,
      moduleGroups.length > 0 || globalAccess
        ? { id: "modules", label: "Modules", href: "/modules", icon: LayoutGrid, children: moduleGroups }
        : null,
      adminChildren.length > 0 || globalAccess
        ? { id: "administration", label: "Admin", href: "/modules/administration", icon: Settings, children: adminChildren }
        : null,
    ]);

    return topGroups.filter((group) => {
      if (group.id === "dashboard") return true;
      return globalAccess || (group.children || []).length > 0;
    });
  }, [canViewModule, dashboardHref, globalAccess, navigationModuleCodes]);

  const activeSidebarLeaf = useMemo(
    () => findActiveSidebarLeaf(pathname, sidebarTree),
    [pathname, sidebarTree],
  );

  const activeTopGroup = useMemo(() => {
    const findActiveLeaf = (
      children: SidebarNode[] | undefined,
    ): { nested: string[] } | null => {
      if (!children) return null;

      for (const child of children) {
        if (child.type === "leaf" && child.href === activeSidebarLeaf?.href) {
          return { nested: [] };
        }
        if (child.type === "group") {
          if (child.href && isActiveHref(pathname, child.href)) {
            return { nested: [child.id] };
          }
          const nestedActive = findActiveLeaf(child.children);
          if (nestedActive) {
            return { nested: [child.id, ...nestedActive.nested] };
          }
        }
      }

      return null;
    };

    for (const group of sidebarTree) {
      const groupHrefActive =
        group.id === "modules"
          ? pathname === "/modules"
          : group.href === "/"
            ? pathname === "/"
            : pathname.startsWith(group.href);

      if (groupHrefActive) {
        return { id: group.id, nested: [] };
      }

      const childActive = findActiveLeaf(group.children);
      if (childActive) {
        return { id: group.id, nested: childActive.nested };
      }
    }

    return null;
  }, [activeSidebarLeaf, pathname, sidebarTree]);

  useEffect(() => {
    if (!activeTopGroup) return;
    setExpandedTopGroup(String(activeTopGroup.id));
    if (activeTopGroup.nested.length > 0) {
      setExpandedNestedGroups((current) => {
        const next = new Set(current);
        activeTopGroup.nested.forEach((id) => next.add(id));
        persistExpandedGroups(next, sidebarTree);
        return next;
      });
    }
  }, [activeTopGroup, sidebarTree]);

  useEffect(() => {
    try {
      setSidebarCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true");
    } catch {
      setSidebarCollapsed(false);
    }
  }, []);

  useEffect(() => {
    try {
      const savedExpandedGroups = JSON.parse(
        window.localStorage.getItem(SIDEBAR_EXPANDED_GROUPS_STORAGE_KEY) || "[]"
      );
      if (Array.isArray(savedExpandedGroups)) {
        const validGroupIds = validExpandedGroupIds(sidebarTree);
        setExpandedNestedGroups((current) => {
          const next = new Set(current);
          savedExpandedGroups
            .filter((value): value is string => typeof value === "string" && validGroupIds.has(value))
            .forEach((value) => next.add(value));
          return next;
        });
      }
    } catch {
      // Keep any active-route expansion already applied.
    }
  }, [sidebarTree]);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
      } catch {
        // Ignore storage failures; the visual toggle should still work for this session.
      }
      return next;
    });
  }, []);

  const loadNotificationCounts = useCallback(async () => {
    try {
      setNotificationCountsLoading(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        return;
      }

      const response = await fetch("/api/notifications/counts", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const counts = await response.json();

      if (!response.ok) {
        throw new Error(counts.error || "Failed to load notification counts.");
      }

      setNotificationCounts({
        pendingWorkOrders: counts.pendingWorkOrders || 0,
        pendingRaBills: counts.pendingRaBills || 0,
        pendingDebitNotes: counts.pendingDebitNotes || 0,
        pendingItcReview: counts.pendingItcReview || 0,
        pendingInvoiceApprovals: counts.pendingInvoiceApprovals || 0,
        totalVendors: counts.totalVendors || 0,
        panAadhaarPending: counts.panAadhaarPending || 0,
        blockedVendors: counts.blockedVendors || 0,
        inactiveVendors: counts.inactiveVendors || 0,
      });
      setNotificationCountsLoaded(true);
    } catch (error) {
      console.error("Notification count load failed:", error);
    } finally {
      setNotificationCountsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user || notificationsStartedRef.current) return;

    notificationsStartedRef.current = true;
    const timer = window.setTimeout(() => {
      loadNotificationCounts();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadNotificationCounts, user]);

  useEffect(() => {
    setNotificationsOpen(false);
    setMobileSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileSidebarOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileSidebarOpen]);

  const totalNotifications = notificationLinks.reduce(
    (sum, item) => sum + (notificationCounts[item.key] || 0),
    0,
  );

  const notificationCountsContextValue = useMemo(
    () => ({
      counts: notificationCounts,
      loading: notificationCountsLoading,
      loaded: notificationCountsLoaded,
      refresh: loadNotificationCounts,
    }),
    [loadNotificationCounts, notificationCounts, notificationCountsLoaded, notificationCountsLoading],
  );

  const sidebarContent = (
    <>
      <div className={`mb-7 flex items-center gap-2 ${compactSidebar ? "justify-center px-0" : "justify-between px-2"}`}>
        <Link
          href={dashboardHref}
          className={`min-w-0 ${compactSidebar ? "grid h-11 w-11 place-items-center rounded-xl bg-white/10" : "block"}`}
          onClick={() => setMobileSidebarOpen(false)}
          title={compactSidebar ? "ConstructIQ" : undefined}
        >
          {compactSidebar ? (
            <span className="text-lg font-bold tracking-tight">C</span>
          ) : (
            <>
              <h1 className="text-2xl font-bold tracking-tight">ConstructIQ</h1>
              <p className="mt-2 text-sm font-medium text-white/50">
                Enterprise ERP
              </p>
            </>
          )}
        </Link>
        <button
          type="button"
          onClick={toggleSidebarCollapsed}
          className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 lg:flex"
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {sidebarCollapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
        </button>
      </div>

      <nav className="space-y-1">
        {accessLoading && sidebarTree.length === 0
          ? Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="h-13 animate-pulse rounded-md bg-white/10"
              />
            ))
          : sidebarTree.map((group) => (
              <SidebarTopItem
                key={group.id}
                group={group}
                pathname={pathname}
                activeLeafHref={activeSidebarLeaf?.href || null}
                expandedTopGroup={expandedTopGroup}
                expandedNestedGroups={expandedNestedGroups}
                compact={compactSidebar}
                onToggleTop={(groupId) =>
                  setExpandedTopGroup((current) => (current === groupId ? null : groupId))
                }
                onToggleNested={(groupId) =>
                  setExpandedNestedGroups((current) => {
                    const next = new Set(current);
                    if (next.has(groupId)) {
                      next.delete(groupId);
                    } else {
                      next.add(groupId);
                    }
                    persistExpandedGroups(next, sidebarTree);
                    return next;
                  })
                }
                onNavigate={() => setMobileSidebarOpen(false)}
              />
            ))}
      </nav>
    </>
  );

  return (
    <NotificationCountsProvider value={notificationCountsContextValue}>
    <div className="min-h-screen overflow-x-hidden bg-[#f3f6f8]">
      {mobileSidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="fixed inset-0 z-40 bg-black/45 lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      <aside
        id="mobile-navigation"
        className={`fixed left-0 top-0 z-50 flex h-[100dvh] w-[min(82vw,280px)] flex-col overflow-y-auto bg-black px-4 py-6 text-white transition-[width,transform] duration-200 ease-out lg:z-40 lg:h-screen lg:translate-x-0 lg:px-4 lg:py-8 ${
          sidebarCollapsed ? "lg:w-[72px]" : "lg:w-[240px]"
        } ${
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-3 flex items-center justify-end lg:hidden">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(false)}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white"
            aria-label="Close navigation menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {sidebarContent}
      </aside>

      <main className={`min-h-screen min-w-0 transition-[padding] duration-200 ${sidebarCollapsed ? "lg:pl-[72px]" : "lg:pl-[240px]"}`}>
        <header className="sticky top-0 z-30 border-b border-[#d7dde3] bg-[#fbf9fa] px-3 py-3 sm:px-5 lg:px-10 lg:py-4">
          <div className="flex min-w-0 items-center justify-between gap-2 lg:justify-end">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-700 transition hover:bg-slate-100 lg:hidden"
              aria-label="Open navigation menu"
              aria-controls="mobile-navigation"
              aria-expanded={mobileSidebarOpen}
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="flex min-w-0 items-center gap-2 sm:gap-4 lg:gap-5">
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
                  <div className="absolute right-0 top-11 z-50 w-[calc(100vw-2rem)] max-w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
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
              <div className="min-w-0">
                <UserHeader />
              </div>
            </div>
          </div>
        </header>

        <div className="min-w-0">{children}</div>
      </main>
    </div>
    </NotificationCountsProvider>
  );
}

function isActiveHref(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function validExpandedGroupIds(items: SidebarTopGroup[]) {
  const ids = new Set<string>();

  const collect = (nodes: SidebarNode[] | undefined) => {
    (nodes || []).forEach((node) => {
      if (node.type !== "group") return;
      ids.add(node.id);
      collect(node.children);
    });
  };

  items.forEach((item) => collect(item.children));
  return ids;
}

function persistExpandedGroups(groups: Set<string>, items: SidebarTopGroup[]) {
  try {
    const validGroupIds = validExpandedGroupIds(items);
    const filteredGroups = Array.from(groups).filter((id) => validGroupIds.has(id));
    window.localStorage.setItem(
      SIDEBAR_EXPANDED_GROUPS_STORAGE_KEY,
      JSON.stringify(filteredGroups)
    );
  } catch {
    // Expanded navigation state is a convenience; keep the live UI working if storage is unavailable.
  }
}

function SidebarTopItem({
  group,
  pathname,
  activeLeafHref,
  expandedTopGroup,
  expandedNestedGroups,
  compact,
  onToggleTop,
  onToggleNested,
  onNavigate,
}: {
  group: SidebarTopGroup;
  pathname: string;
  activeLeafHref: string | null;
  expandedTopGroup: string | null;
  expandedNestedGroups: Set<string>;
  compact: boolean;
  onToggleTop: (groupId: string) => void;
  onToggleNested: (groupId: string) => void;
  onNavigate: () => void;
}) {
  const Icon = group.icon;
  const hasChildren = (group.children || []).length > 0;
  const topChildrenAlwaysVisible = group.id === "modules";
  const expanded = topChildrenAlwaysVisible || expandedTopGroup === group.id;
  const active =
    (group.id === "modules" ? pathname === "/modules" : isActiveHref(pathname, group.href)) ||
    hasActiveChild(group.children, activeLeafHref);
  const showDivider = group.id === "settings";

  return (
    <div>
      {showDivider && <div className="my-4 border-t border-white/10" />}
      <div
        className={`flex min-h-11 items-center rounded-md text-[13px] font-bold transition ${compact ? "justify-center" : ""} ${
          active ? "bg-[#7bc8ef] text-[#07516c]" : "text-white/65 hover:bg-white/10 hover:text-white"
        }`}
        title={compact ? group.label : undefined}
      >
        {hasChildren ? (
          <>
            <Link
              href={group.href}
              onClick={onNavigate}
              className={`flex min-h-11 min-w-0 items-center gap-2.5 px-2.5 ${topChildrenAlwaysVisible ? "rounded-md" : "rounded-l-md"} ${compact ? "justify-center px-0" : "flex-1"}`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!compact && <span className="min-w-0 flex-1 whitespace-normal leading-4">{group.label}</span>}
            </Link>
            {!compact && !topChildrenAlwaysVisible && (
              <button
                type="button"
                onClick={() => onToggleTop(String(group.id))}
                className="flex min-h-11 w-9 shrink-0 items-center justify-center rounded-r-md"
                aria-label={`${expanded ? "Collapse" : "Expand"} ${group.label}`}
                aria-expanded={expanded}
              >
                <ChevronDown className={`h-4 w-4 shrink-0 transition ${expanded ? "rotate-180" : ""}`} />
              </button>
            )}
          </>
        ) : (
          <Link
            href={group.href}
            onClick={onNavigate}
            className={`flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 ${compact ? "justify-center px-0" : ""}`}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {!compact && <span className="min-w-0 whitespace-normal leading-4">{group.label}</span>}
          </Link>
        )}
      </div>

      {hasChildren && expanded && !compact && (
        <div className="ml-4 mt-1 space-y-1 border-l border-white/10 pl-3">
          {group.children?.map((child) => (
            <SidebarChildItem
              key={`${child.type}-${child.label}`}
              child={child}
              activeLeafHref={activeLeafHref}
              expandedNestedGroups={expandedNestedGroups}
              compact={compact}
              onToggleNested={onToggleNested}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SidebarChildItem({
  child,
  activeLeafHref,
  expandedNestedGroups,
  compact,
  onToggleNested,
  onNavigate,
}: {
  child: SidebarNode;
  activeLeafHref: string | null;
  expandedNestedGroups: Set<string>;
  compact: boolean;
  onToggleNested: (groupId: string) => void;
  onNavigate: () => void;
}) {
  if (child.type === "placeholder") {
    return (
      <div className="rounded-md px-2 py-2 text-xs font-semibold leading-4 text-white/35">
        {child.label}
      </div>
    );
  }

  if (child.type === "leaf") {
    const active = child.href === activeLeafHref;
    return (
      <Link
        href={child.href}
        onClick={onNavigate}
        className={`block rounded-md px-2 py-2 text-xs font-semibold leading-4 transition ${
          active ? "bg-white/15 text-white" : "text-white/55 hover:bg-white/10 hover:text-white"
        }`}
      >
        {child.label}
      </Link>
    );
  }

  const expanded = expandedNestedGroups.has(child.id);
  const active = hasActiveChild(child.children, activeLeafHref);
  const Icon = child.icon;

  return (
    <div>
      <div
        className={`flex min-h-9 items-center rounded-md text-xs font-bold leading-4 transition ${
          active ? "bg-white/15 text-white" : "text-white/60 hover:bg-white/10 hover:text-white"
        }`}
      >
        {child.href ? (
          <Link
            href={child.href}
            onClick={onNavigate}
            className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-l-md px-2"
          >
            {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
            <span className="min-w-0 flex-1">{child.label}</span>
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => onToggleNested(child.id)}
            className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-l-md px-2 text-left"
            aria-expanded={expanded}
          >
            {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
            <span className="min-w-0 flex-1">{child.label}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => onToggleNested(child.id)}
          className="flex min-h-9 w-8 shrink-0 items-center justify-center rounded-r-md"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${child.label}`}
          aria-expanded={expanded}
        >
          <ChevronDown className={`h-3.5 w-3.5 transition ${expanded ? "rotate-180" : ""}`} />
        </button>
      </div>
      {expanded && (
        <div className="ml-3 mt-1 space-y-1 border-l border-white/10 pl-2">
          {child.children.map((nestedChild) => (
            <SidebarChildItem
              key={`${nestedChild.type}-${nestedChild.label}`}
              child={nestedChild}
              activeLeafHref={activeLeafHref}
              expandedNestedGroups={expandedNestedGroups}
              compact={compact}
              onToggleNested={onToggleNested}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function hasActiveChild(
  children: SidebarNode[] | undefined,
  activeLeafHref: string | null,
): boolean {
  return (children || []).some((child) => {
    if (child.type === "leaf") return child.href === activeLeafHref;
    if (child.type === "group") return hasActiveChild(child.children, activeLeafHref);
    return false;
  });
}
