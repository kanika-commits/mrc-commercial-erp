"use client";

import Link from "next/link";
import { ArrowRight, Landmark, Settings, ShieldCheck, Users } from "lucide-react";
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

const toneClasses = {
  blue: {
    iconShell: "bg-blue-50",
    icon: "text-blue-600",
    badge: "border-blue-100 bg-blue-50 text-blue-700",
    dot: "bg-blue-500",
  },
  indigo: {
    iconShell: "bg-indigo-50",
    icon: "text-indigo-600",
    badge: "border-indigo-100 bg-indigo-50 text-indigo-700",
    dot: "bg-indigo-500",
  },
  violet: {
    iconShell: "bg-violet-50",
    icon: "text-violet-600",
    badge: "border-violet-100 bg-violet-50 text-violet-700",
    dot: "bg-violet-500",
  },
  slate: {
    iconShell: "bg-slate-100",
    icon: "text-slate-600",
    badge: "border-slate-200 bg-slate-50 text-slate-700",
    dot: "bg-slate-500",
  },
};

const adminModules = [
  {
    title: "Organizations",
    description: "Manage organization-level setup.",
    moduleCodes: ["organizations"],
    routes: ["/organizations"],
    icon: Landmark,
    tone: "blue",
    status: "Secure",
    meta: "Organization Root",
  },
  {
    title: "Users",
    description: "Manage ERP users and access.",
    moduleCodes: ["users"],
    routes: ["/admin/users"],
    icon: Users,
    tone: "indigo",
    status: "Secure",
    meta: "User Access",
  },
  {
    title: "Roles",
    description: "Manage designation templates.",
    moduleCodes: ["roles"],
    routes: ["/admin/roles"],
    icon: ShieldCheck,
    tone: "violet",
    status: "Secure",
    meta: "Role Templates",
  },
  {
    title: "Permissions",
    description: "Configure access permissions.",
    moduleCodes: ["permissions"],
    routes: ["/admin/permissions"],
    icon: Settings,
    tone: "slate",
    status: "Secure",
    meta: "Access Matrix",
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
          if (!module || !can(permissions, module.module_code, "view")) {
            return null;
          }

          return buildCard(item, module);
        })
        .filter(isVisibleCard),
    [modules, permissions],
  );

  if (loading) {
    return (
      <section className="min-h-[60vh] bg-[#f6f3f5] px-6 py-8 text-sm font-medium text-slate-500 md:px-10">
        Loading administration...
      </section>
    );
  }

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-[#1b1b1d] md:px-10">
      <div className="mx-auto max-w-[1500px] space-y-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-black md:text-[28px] md:leading-9">
            Admin &amp; Settings
          </h1>
          <p className="max-w-2xl text-sm leading-5 text-slate-600">
            Manage organizations, users, roles and permissions.
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Administration Directory
          </h2>

          {visibleCards.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
              No accessible pages found in this module.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
              {visibleCards.map((module) => {
                const Icon = module.icon;
                const tone =
                  toneClasses[module.tone as keyof typeof toneClasses];

                return (
                  <Link
                    key={module.moduleCode}
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
                          Launch
                          <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/module:translate-x-1" />
                        </span>
                      </div>
                    </article>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
