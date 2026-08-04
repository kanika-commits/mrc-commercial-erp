"use client";

import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Building2,
  FilePlus2,
  FileText,
  Settings,
  ShoppingCart,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { DEFAULT_MODULE_NAVIGATION } from "@/lib/defaultModuleNavigation";
import { getModuleGroupDisplayName } from "@/lib/moduleDisplayNames";
import { RELEASED_GROUPS } from "@/lib/releasedModuleRegistry";
import { useAccessContext } from "@/components/AccessContext";

const moduleCards = [
  {
    title: "Master Setup",
    href: "/modules/master-setup",
    description: "Companies, sites, vendors and bank accounts.",
    checkModules: ["companies", "sites", "vendors", "company_bank_accounts"],
    icon: Building2,
    tone: "emerald",
    status: "Active",
    meta: "System Online",
  },
  {
    title: "Contract Management",
    href: "/modules/contract-management",
    description: "Work orders, RA bills, invoices, payments and debit notes.",
    checkModules: [
      "work_orders",
      "ra_bills",
      "invoices",
      "payments",
      "debit_notes",
    ],
    icon: FileText,
    tone: "orange",
    status: "Idle",
    meta: "Commercial Workflow",
  },
  {
    title: "Reports",
    href: "/modules/reports",
    description: "Outstanding reports and exports.",
    checkModules: ["reports"],
    icon: BarChart3,
    tone: "violet",
    status: "Live",
    meta: "Analytics Ready",
  },
  {
    title: "Admin",
    href: "/modules/administration",
    description: "Users, roles, permissions and organization setup.",
    checkModules: ["users", "roles", "permissions", "organizations"],
    icon: Settings,
    tone: "blue",
    status: "Secure",
    meta: "Root Access",
  },
];

const groupMeta: Record<string, (typeof moduleCards)[number]> = {
  project_management: {
    title: "Project Management",
    href: "/modules/project-management",
    description: "RA bills, debit notes and commercial approvals.",
    checkModules: ["ra_bills", "debit_notes", "ra_approval"],
    icon: FileText,
    tone: "orange",
    status: "Idle",
    meta: "Project Workflow",
  },
  purchase: {
    title: "Purchase",
    href: "/modules/purchase",
    description: "Work orders and work order approvals.",
    checkModules: ["work_orders", "wo_approval"],
    icon: ShoppingCart,
    tone: "orange",
    status: "Active",
    meta: "Purchase Flow",
  },
  accounts: {
    title: "Accounts/Finance",
    href: "/modules/accounts",
    description: "Invoices, ITC review and payments.",
    checkModules: ["invoices", "itc_claims", "payments"],
    icon: Building2,
    tone: "blue",
    status: "Active",
    meta: "Finance Access",
  },
  hr: {
    title: "Human Resources",
    href: "/modules/hr",
    description: "Employee registration, import and reimbursement workflows.",
    checkModules: ["hr_employees", "hr_employee_import", "reimbursements", "hr_departments", "hr_designations"],
    icon: UsersRound,
    tone: "blue",
    status: "Pilot",
    meta: "HR Access",
  },
  settings: {
    title: "Settings",
    href: "/modules/settings",
    description: "Masters and password settings.",
    checkModules: ["companies", "sites", "vendors", "company_bank_accounts"],
    icon: Settings,
    tone: "emerald",
    status: "Active",
    meta: "System Online",
  },
  administration: {
    title: "Admin",
    href: "/modules/administration",
    description: "Users, roles, permissions and organization setup.",
    checkModules: ["users", "roles", "permissions", "organizations"],
    icon: Settings,
    tone: "blue",
    status: "Secure",
    meta: "Root Access",
  },
};

const toneClasses = {
  emerald: {
    iconShell: "bg-emerald-50",
    icon: "text-emerald-600",
    badge: "border-emerald-100 bg-emerald-50 text-emerald-700",
    dot: "bg-emerald-500",
  },
  orange: {
    iconShell: "bg-orange-50",
    icon: "text-orange-600",
    badge: "border-orange-100 bg-orange-50 text-orange-700",
    dot: "bg-orange-500",
  },
  violet: {
    iconShell: "bg-violet-50",
    icon: "text-violet-600",
    badge: "border-violet-100 bg-violet-50 text-violet-700",
    dot: "bg-violet-500",
  },
  blue: {
    iconShell: "bg-blue-50",
    icon: "text-blue-600",
    badge: "border-blue-100 bg-blue-50 text-blue-700",
    dot: "bg-blue-500",
  },
};

export default function ModulesPage() {
  const { access, moduleNavigation, loading } = useAccessContext();
  const permissions = access?.permissions || [];
  const globalAccess = hasGlobalAccess(access);
  const effectiveNavigation =
    globalAccess && (moduleNavigation.groups || []).length === 0
      ? DEFAULT_MODULE_NAVIGATION
      : moduleNavigation;
  const groups = effectiveNavigation.groups || [];
  const modules = effectiveNavigation.modules || [];
  const releasedLauncherGroups = new Set(RELEASED_GROUPS.filter((group) => group.launcher).map((group) => group.code));

  if (loading) {
    return (
      <section className="min-h-[60vh] bg-[#f6f3f5] px-6 py-8 text-sm font-medium text-slate-500 md:px-10">
        Loading modules...
      </section>
    );
  }

  const visibleCards = groups
    .filter((group) => releasedLauncherGroups.has(group.module_code))
    .filter((group) =>
      globalAccess ||
      modules.some(
        (module) =>
          module.module_group === group.module_code &&
          can(permissions, module.module_code, "view")
      )
    )
    .map((group) => {
      const meta = groupMeta[group.module_code] || moduleCards[0];

      return {
        ...meta,
        title: getModuleGroupDisplayName(group.module_code, group.module_name || meta.title),
        href: group.route || meta.href,
      };
    });

  if (globalAccess || can(permissions, "reports", "view")) {
    visibleCards.push({
      ...moduleCards[2],
      description: "Existing production reports launcher.",
      meta: "Compatibility",
    });
  }

  const quickActions = [
    {
      label: "New User",
      href: "/admin/users/new",
      icon: UserPlus,
      show: globalAccess || can(permissions, "users", "add"),
    },
    {
      label: "Create Work Order",
      href: "/work-orders/new",
      icon: FilePlus2,
      show: globalAccess || can(permissions, "work_orders", "add"),
    },
  ].filter((action) => action.show);

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-5 py-5 text-[#1b1b1d] md:px-8">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-black">
            System Modules
          </h1>
          <p className="max-w-2xl text-sm leading-5 text-slate-600">
            Select a specialized tool to begin managing your enterprise
            infrastructure.
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Quick Actions
          </h2>

          {quickActions.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {quickActions.map((action) => {
                const Icon = action.icon;

                return (
                  <Link
                    key={action.href}
                    href={action.href}
                    className="group/action inline-flex h-11 items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 shadow-sm transition-colors hover:bg-[#f0edef] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00658b]"
                  >
                    <Icon className="h-4 w-4 text-[#00658b]" />
                    {action.label}
                    <ArrowRight className="h-4 w-4 text-slate-400 transition-transform group-hover/action:translate-x-1" />
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm leading-5 text-slate-500 shadow-sm">
              No quick actions available for your current access.
            </p>
          )}
        </section>

        <div className="space-y-4">
          <section className="space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Module Directory
            </h2>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {visibleCards.map((module) => {
                const Icon = module.icon;
                const tone = toneClasses[module.tone as keyof typeof toneClasses];

                return (
                  <Link
                    key={module.href}
                    href={module.href}
                    className="group/module block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00658b]"
                  >
                    <article className="relative flex min-h-[124px] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
                      <div className="mb-2.5 flex items-start justify-between gap-3">
                        <div className="rounded-lg border border-slate-200 bg-[#f6f3f5] p-1.5">
                          <div
                            className={`flex h-8 w-8 items-center justify-center rounded-md ${tone.iconShell}`}
                          >
                            <Icon
                              className={`h-4 w-4 transition-transform duration-200 group-hover/module:scale-110 ${tone.icon}`}
                            />
                          </div>
                        </div>

                        <span
                          className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase leading-4 ${tone.badge}`}
                        >
                          {module.status}
                        </span>
                      </div>

                      <h3 className="line-clamp-2 text-base font-semibold leading-5 tracking-tight text-black">
                        {module.title}
                      </h3>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">
                        {module.description}
                      </p>

                      <div className="mt-auto flex items-center justify-between pt-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${tone.dot}`}
                          />
                          <span className="text-xs font-medium text-slate-500">
                            {module.meta}
                          </span>
                        </div>

                        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-[#00658b] transition-colors group-hover/module:border-[#00658b]/30 group-hover/module:bg-sky-50">
                          <span className="sr-only">Open {module.title}</span>
                          <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/module:translate-x-1" />
                        </span>
                      </div>
                    </article>
                  </Link>
                );
              })}

              {visibleCards.length === 0 && (
                <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
                  No modules assigned to your user.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
