"use client";

import Link from "next/link";
import { Activity, ArrowRight, Landmark, Settings, ShieldCheck, Users } from "lucide-react";
import { useMemo } from "react";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";

type ModuleRow = {
  id: string;
  module_group: string;
  module_code: string;
  module_name: string;
  route: string;
  sort_order: number;
};

const adminModules = [
  {
    title: "Organizations",
    description: "Manage organization-level setup.",
    moduleCodes: ["organizations"],
    routes: ["/organizations"],
    icon: Landmark,
    className: "from-blue-50 to-white border-blue-100 text-blue-700",
  },
  {
    title: "Users",
    description: "Manage ERP users and access.",
    moduleCodes: ["users"],
    routes: ["/admin/users"],
    icon: Users,
    className: "from-indigo-50 to-white border-indigo-100 text-indigo-700",
  },
  {
    title: "Roles",
    description: "Manage role templates.",
    moduleCodes: ["roles"],
    routes: ["/admin/roles"],
    icon: ShieldCheck,
    className: "from-purple-50 to-white border-purple-100 text-purple-700",
  },
  {
    title: "Permissions",
    description: "Configure access permissions.",
    moduleCodes: ["permissions"],
    routes: ["/admin/permissions"],
    icon: Settings,
    className: "from-slate-50 to-white border-slate-200 text-slate-700",
  },
  {
    title: "System Activity",
    description: "Review ERP activity, changes, approvals and audit history.",
    moduleCodes: ["system_activity"],
    routes: ["/admin/activity"],
    icon: Activity,
    className: "from-slate-50 to-white border-slate-200 text-slate-700",
  },
] as const;

function findModule(modules: ModuleRow[], item: (typeof adminModules)[number]) {
  return modules.find(
    (module) =>
      item.moduleCodes.includes(module.module_code as never) ||
      item.routes.includes(module.route as never),
  );
}

function buildCard(item: (typeof adminModules)[number], module: ModuleRow) {
  return {
    ...item,
    title: module.module_name || item.title,
    href: module.route,
    moduleCode: module.module_code,
  };
}

function isVisibleCard(
  card: ReturnType<typeof buildCard> | null,
): card is ReturnType<typeof buildCard> {
  return Boolean(card);
}

export default function AdministrationPage() {
  const { access, moduleNavigation, loading } = useAccessContext();
  const permissions = access?.permissions || [];
  const canViewSystemActivity = Boolean(access?.roleCodes?.includes("platform_owner") || access?.roleCodes?.includes("super_admin"));
  const modules = useMemo(
    () =>
      ((moduleNavigation.modules || []) as ModuleRow[]).filter(
        (module) => module.module_group === "administration",
      ),
    [moduleNavigation.modules],
  );

  const visibleCards = useMemo(
    () =>
      adminModules
        .map((item) => {
          const module = findModule(modules, item);
          if (!module) {
            return null;
          }
          if (module.module_code === "system_activity") {
            return canViewSystemActivity ? buildCard(item, module) : null;
          }
          if (!can(permissions, module.module_code, "view")) {
            return null;
          }

          return buildCard(item, module);
        })
        .filter(isVisibleCard),
    [modules, permissions, canViewSystemActivity],
  );

  if (loading) {
    return (
      <section className="min-h-[60vh] bg-[#f6f3f5] px-6 py-8 text-sm font-medium text-slate-500 md:px-10">
        Loading administration...
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Module
        </p>
        <h1 className="text-2xl font-bold text-slate-950">Admin &amp; Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage organizations, users, roles and permissions.
        </p>
      </div>

      <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Administration Directory
          </h2>

          {visibleCards.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
              No accessible pages found in this module.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {visibleCards.map((module) => {
                const Icon = module.icon;

                return (
                  <Link key={module.moduleCode} href={module.href}>
                    <div
                      className={`group rounded-xl border bg-gradient-to-br p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${module.className}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="rounded-xl bg-white/80 p-2 shadow-sm">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <h2 className="text-sm font-bold leading-5 text-slate-950">
                              {module.title}
                            </h2>
                            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 opacity-40 transition group-hover:translate-x-1 group-hover:opacity-100" />
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                            {module.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
      </section>
    </section>
  );
}
