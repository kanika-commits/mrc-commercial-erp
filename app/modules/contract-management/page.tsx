"use client";

import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  FileCheck2,
  FileText,
  ReceiptText,
} from "lucide-react";
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
  amber: {
    iconShell: "bg-amber-50",
    icon: "text-amber-600",
    badge: "border-amber-100 bg-amber-50 text-amber-700",
    dot: "bg-amber-500",
  },
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
  red: {
    iconShell: "bg-red-50",
    icon: "text-red-600",
    badge: "border-red-100 bg-red-50 text-red-700",
    dot: "bg-red-500",
  },
  rose: {
    iconShell: "bg-rose-50",
    icon: "text-rose-600",
    badge: "border-rose-100 bg-rose-50 text-rose-700",
    dot: "bg-rose-500",
  },
  yellow: {
    iconShell: "bg-yellow-50",
    icon: "text-yellow-600",
    badge: "border-yellow-100 bg-yellow-50 text-yellow-700",
    dot: "bg-yellow-500",
  },
  blue: {
    iconShell: "bg-blue-50",
    icon: "text-blue-600",
    badge: "border-blue-100 bg-blue-50 text-blue-700",
    dot: "bg-blue-500",
  },
};

const contractModules = [
  {
    title: "Work Orders",
    description: "Create and manage work orders.",
    moduleCodes: ["work_orders"],
    routes: ["/work-orders"],
    icon: FileText,
    tone: "amber",
    status: "Active",
    meta: "Commercial Base",
  },
  {
    title: "WO Approval",
    description: "Review and approve work orders.",
    moduleCodes: ["wo_approval", "work_order_approvals"],
    routes: ["/approvals/work-orders"],
    icon: CheckCircle2,
    tone: "emerald",
    status: "Review",
    meta: "Approval Queue",
  },
  {
    title: "RA Bills",
    description: "Create and track RA bills.",
    moduleCodes: ["ra_bills"],
    routes: ["/ra-bills"],
    icon: ReceiptText,
    tone: "orange",
    status: "Active",
    meta: "Billing Workflow",
  },
  {
    title: "Debit Notes",
    description: "Create and manage debit notes.",
    moduleCodes: ["debit_notes"],
    routes: ["/debit-notes"],
    icon: ReceiptText,
    tone: "red",
    status: "Active",
    meta: "Adjustment Control",
  },
  {
    title: "RA Bills & Debit Notes Approval",
    description: "Review and approve submitted RA Bills and Debit Notes.",
    moduleCodes: ["ra_approval", "approvals", "commercial_approvals"],
    routes: ["/approvals"],
    icon: FileCheck2,
    tone: "emerald",
    status: "Review",
    meta: "HO Approval",
  },
  {
    title: "Invoices",
    description: "Upload and manage invoices.",
    moduleCodes: ["invoices"],
    routes: ["/invoices"],
    icon: FileText,
    tone: "rose",
    status: "Active",
    meta: "Invoice Register",
  },
  {
    title: "ITC Review",
    description: "Review ITC claim status.",
    moduleCodes: ["itc_claims", "itc_review"],
    routes: ["/invoices/itc"],
    icon: FileCheck2,
    tone: "yellow",
    status: "Review",
    meta: "Tax Review",
  },
  {
    title: "Payments",
    description: "Record and track payments.",
    moduleCodes: ["payments"],
    routes: ["/payments"],
    icon: CreditCard,
    tone: "blue",
    status: "Active",
    meta: "Finance Access",
  },
] as const;

function findModule(modules: ModuleRow[], item: (typeof contractModules)[number]) {
  return modules.find(
    (module) =>
      item.moduleCodes.includes(module.module_code as never) ||
      item.routes.includes(module.route as never),
  );
}

function isVisibleCard(
  card: ReturnType<typeof buildCard> | null,
): card is ReturnType<typeof buildCard> {
  return Boolean(card);
}

function buildCard(
  item: (typeof contractModules)[number],
  module: ModuleRow,
) {
  return {
    ...item,
    href: module.route,
    moduleCode: module.module_code,
  };
}

export default function ContractManagementPage() {
  const { access, moduleNavigation, loading } = useAccessContext();
  const permissions = access?.permissions || [];
  const modules = useMemo(
    () =>
      ((moduleNavigation.modules || []) as ModuleRow[]).filter(
        (module) => module.module_group === "contract_management",
      ),
    [moduleNavigation.modules],
  );

  const visibleCards = useMemo(
    () =>
      contractModules
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
        Loading contract management...
      </section>
    );
  }

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-[#1b1b1d] md:px-10">
      <div className="mx-auto max-w-[1500px] space-y-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-black md:text-[28px] md:leading-9">
            Contract Management
          </h1>
          <p className="max-w-2xl text-sm leading-5 text-slate-600">
            Manage work orders, RA bills, debit notes, invoices, ITC review and
            payments.
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Commercial Directory
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
