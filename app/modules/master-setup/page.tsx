"use client";

import Link from "next/link";
import { ArrowRight, Building2, Landmark, LandmarkIcon, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  can,
  getCurrentUserAccess,
  type UserPermission,
} from "@/lib/accessControl";

type ModuleRow = {
  id: string;
  module_group: string;
  module_code: string;
  module_name: string;
  route: string;
  sort_order: number;
};

const toneClasses = {
  emerald: {
    iconShell: "bg-emerald-50",
    icon: "text-emerald-600",
    badge: "border-emerald-100 bg-emerald-50 text-emerald-700",
    dot: "bg-emerald-500",
  },
  teal: {
    iconShell: "bg-teal-50",
    icon: "text-teal-600",
    badge: "border-teal-100 bg-teal-50 text-teal-700",
    dot: "bg-teal-500",
  },
  cyan: {
    iconShell: "bg-cyan-50",
    icon: "text-cyan-600",
    badge: "border-cyan-100 bg-cyan-50 text-cyan-700",
    dot: "bg-cyan-500",
  },
  blue: {
    iconShell: "bg-blue-50",
    icon: "text-blue-600",
    badge: "border-blue-100 bg-blue-50 text-blue-700",
    dot: "bg-blue-500",
  },
};

const masterModules = [
  {
    title: "Companies",
    description: "Manage company master data.",
    moduleCodes: ["companies"],
    routes: ["/companies"],
    icon: Building2,
    tone: "emerald",
    status: "Active",
    meta: "Company Setup",
  },
  {
    title: "Sites",
    description: "Manage project sites.",
    moduleCodes: ["sites"],
    routes: ["/sites"],
    icon: Landmark,
    tone: "teal",
    status: "Active",
    meta: "Site Setup",
  },
  {
    title: "Vendors",
    description: "Manage contractors and suppliers.",
    moduleCodes: ["vendors"],
    routes: ["/vendors"],
    icon: Users,
    tone: "cyan",
    status: "Active",
    meta: "Vendor Master",
  },
  {
    title: "Bank Accounts",
    description: "Manage company bank accounts.",
    moduleCodes: ["company_bank_accounts"],
    routes: ["/company-bank-accounts"],
    icon: LandmarkIcon,
    tone: "blue",
    status: "Active",
    meta: "Bank Master",
  },
] as const;

function findModule(modules: ModuleRow[], item: (typeof masterModules)[number]) {
  return modules.find(
    (module) =>
      item.moduleCodes.includes(module.module_code as never) ||
      item.routes.includes(module.route as never),
  );
}

function buildCard(item: (typeof masterModules)[number], module: ModuleRow) {
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

export default function MasterSetupPage() {
  const [permissions, setPermissions] = useState<UserPermission[]>([]);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadPages() {
      const [access, navigationResponse] = await Promise.all([
        getCurrentUserAccess(),
        fetch("/api/admin/module-navigation"),
      ]);

      setPermissions(access.permissions || []);

      if (navigationResponse.ok) {
        const navigation = await navigationResponse.json();
        setModules(
          ((navigation.modules || []) as ModuleRow[]).filter(
            (module) => module.module_group === "master_setup",
          ),
        );
      }

      setLoading(false);
    }

    loadPages();
  }, []);

  const visibleCards = useMemo(
    () =>
      masterModules
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
        Loading master setup...
      </section>
    );
  }

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-[#1b1b1d] md:px-10">
      <div className="mx-auto max-w-[1500px] space-y-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-black md:text-[28px] md:leading-9">
            Master Setup
          </h1>
          <p className="max-w-2xl text-sm leading-5 text-slate-600">
            Manage companies, sites, vendors and bank accounts.
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Setup Directory
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
