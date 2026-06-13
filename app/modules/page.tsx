"use client";

import Link from "next/link";
import {
  BarChart3,
  Building2,
  FileText,
  Settings,
} from "lucide-react";
import { useEffect, useState } from "react";
import { getCurrentUserAccess, can } from "@/lib/accessControl";

const moduleCards = [
  {
    title: "Master Setup",
    href: "/modules/master-setup",
    description: "Companies, sites, vendors and bank accounts.",
    checkModules: ["companies", "sites", "vendors", "company_bank_accounts"],
    icon: Building2,
    className: "from-emerald-50 to-white border-emerald-100 text-emerald-700",
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
    className: "from-amber-50 to-white border-amber-100 text-amber-700",
  },
  {
    title: "Reports",
    href: "/modules/reports",
    description: "Outstanding reports and exports.",
    checkModules: ["reports"],
    icon: BarChart3,
    className: "from-violet-50 to-white border-violet-100 text-violet-700",
  },
  {
    title: "Administration",
    href: "/modules/administration",
    description: "Users, roles, permissions and organization setup.",
    checkModules: ["users", "roles", "permissions", "organizations"],
    icon: Settings,
    className: "from-blue-50 to-white border-blue-100 text-blue-700",
  },
];

export default function ModulesPage() {
  const [permissions, setPermissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAccess() {
  const access = await getCurrentUserAccess();

  console.log("MODULE ACCESS DEBUG", {
    user: access.user?.id,
    permissions: access.permissions,
  });

  setPermissions(access.permissions || []);
  setLoading(false);
}

    loadAccess();
  }, []);

  if (loading) {
    return <p className="text-sm text-slate-500">Loading modules...</p>;
  }

  const visibleCards = moduleCards.filter((card) =>
    card.checkModules.some((moduleCode) => can(permissions, moduleCode, "view"))
  );

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-950">Modules</h1>
        <p className="mt-1 text-sm text-slate-500">
          Open ERP modules based on your access.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {visibleCards.map((module) => {
          const Icon = module.icon;

          return (
            <Link key={module.href} href={module.href}>
              <div
                className={`group h-40 rounded-2xl border bg-gradient-to-br p-5 shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl ${module.className}`}
              >
                <div className="flex h-full flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <div className="rounded-2xl bg-white/80 p-3 shadow-sm">
                      <Icon className="h-6 w-6" />
                    </div>
                    <span className="text-xs font-medium opacity-60 group-hover:opacity-100">
                      Open
                    </span>
                  </div>

                  <div>
                    <h2 className="text-base font-bold text-slate-950">
                      {module.title}
                    </h2>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {module.description}
                    </p>
                  </div>
                </div>
              </div>
            </Link>
          );
        })}

        {visibleCards.length === 0 && (
          <div className="rounded-2xl border bg-white p-6 text-sm text-slate-500">
            No modules assigned to your user.
          </div>
        )}
      </div>
    </section>
  );
}