"use client";

import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Building2,
  FilePlus2,
  FileText,
  Settings,
  UserPlus,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  getCurrentUserAccess,
  can,
  type UserPermission,
} from "@/lib/accessControl";

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
    title: "Administration",
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
  master_setup: moduleCards[0],
  construction_management: moduleCards[0],
  contract_management: moduleCards[1],
  accounts: {
    title: "Accounts",
    href: "/modules/accounts",
    description: "Accounts and finance workflows.",
    checkModules: [],
    icon: FileText,
    tone: "orange",
    status: "Active",
    meta: "Finance Access",
  },
  reports: moduleCards[2],
  administration: moduleCards[3],
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
  const [permissions, setPermissions] = useState<UserPermission[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [modules, setModules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAccess() {
      const [access, navigationResponse] = await Promise.all([
        getCurrentUserAccess(),
        fetch("/api/admin/module-navigation"),
      ]);

      setPermissions(access.permissions || []);

      if (navigationResponse.ok) {
        const navigation = await navigationResponse.json();
        setGroups(navigation.groups || []);
        setModules(navigation.modules || []);
      }

      setLoading(false);
    }

    loadAccess();
  }, []);

  if (loading) {
    return (
      <section className="min-h-[60vh] bg-[#f6f3f5] px-6 py-8 text-sm font-medium text-slate-500 md:px-10">
        Loading modules...
      </section>
    );
  }

  const visibleCards = groups
    .filter((group) =>
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
        title: group.module_name || meta.title,
        href: group.route || meta.href,
      };
    });

  const quickActions = [
    {
      label: "New User",
      href: "/admin/users/new",
      icon: UserPlus,
      show: can(permissions, "users", "add"),
    },
    {
      label: "Create Work Order",
      href: "/work-orders/new",
      icon: FilePlus2,
      show: can(permissions, "work_orders", "add"),
    },
  ].filter((action) => action.show);

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-[#1b1b1d] md:px-10">
      <div className="mx-auto max-w-[1500px] space-y-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-black md:text-[28px] md:leading-9">
            System Modules
          </h1>
          <p className="max-w-2xl text-sm leading-5 text-slate-600">
            Select a specialized tool to begin managing your enterprise
            infrastructure.
          </p>
        </header>

        <div className="grid grid-cols-12 items-start gap-6">
          <section className="col-span-12 space-y-4 lg:col-span-8">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Module Directory
            </h2>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {visibleCards.map((module) => {
                const Icon = module.icon;
                const tone = toneClasses[module.tone as keyof typeof toneClasses];

                return (
                  <Link
                    key={module.href}
                    href={module.href}
                    className="group/module block"
                  >
                    <article className="relative overflow-hidden rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-slate-300 hover:shadow-lg">
                      <div className="mb-4 flex items-start justify-between gap-4">
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

                      <h3 className="text-xl font-semibold leading-7 tracking-tight text-black">
                        {module.title}
                      </h3>
                      <p className="mt-2 min-h-[44px] text-xs leading-5 text-slate-600">
                        {module.description}
                      </p>

                      <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${tone.dot}`}
                          />
                          <span className="text-xs font-medium text-slate-500">
                            {module.meta}
                          </span>
                        </div>

                        <span className="flex items-center gap-1 text-xs font-bold text-[#00658b]">
                          Launch Module
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

          <aside className="col-span-12 space-y-4 lg:col-span-4">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Quick Actions
            </h2>

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              {quickActions.length > 0 ? (
                <div className="space-y-3">
                  {quickActions.map((action) => {
                    const Icon = action.icon;

                    return (
                      <Link
                        key={action.href}
                        href={action.href}
                        className="group/action flex items-center justify-between rounded-lg border border-slate-200 p-3 transition-colors hover:bg-[#f0edef]"
                      >
                        <span className="flex items-center gap-3">
                          <Icon className="h-4 w-4 text-[#00658b]" />
                          <span className="text-xs font-semibold text-slate-900">
                            {action.label}
                          </span>
                        </span>
                        <ArrowRight className="h-4 w-4 text-slate-400 transition-transform group-hover/action:translate-x-1" />
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm leading-5 text-slate-500">
                  No quick actions available for your current access.
                </p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
