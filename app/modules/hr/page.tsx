"use client";

import Link from "next/link";
import { ArrowRight, ReceiptText, UsersRound } from "lucide-react";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";

const cards = [
  {
    title: "Employee Master",
    description: "Maintain employee records, departments, designations and reporting structure.",
    href: "/hr/employees",
    moduleCode: "hr_employees",
    icon: UsersRound,
    meta: "HR Master",
    tone: "bg-sky-50 text-sky-700",
  },
  {
    title: "Reimbursements",
    description: "Create, review and track employee reimbursement claims.",
    href: "/hr/reimbursements",
    moduleCode: "reimbursements",
    icon: ReceiptText,
    meta: "Claims",
    tone: "bg-emerald-50 text-emerald-700",
  },
];

export default function HrLauncherPage() {
  const { access, loading } = useAccessContext();
  const permissions = access?.permissions || [];
  const visibleCards = cards.filter((card) => can(permissions, card.moduleCode, "view"));

  if (loading) {
    return <section className="min-h-[60vh] bg-[#f6f3f5] px-6 py-8 text-sm font-medium text-slate-500 md:px-10">Loading HR...</section>;
  }

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-[#1b1b1d] md:px-10">
      <div className="mx-auto max-w-[1500px] space-y-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-black md:text-[28px] md:leading-9">HR</h1>
          <p className="max-w-2xl text-sm leading-5 text-slate-600">Manage employee master data and reimbursement workflows.</p>
        </header>

        {visibleCards.length === 0 ? (
          <div className="rounded-2xl border bg-white p-8 text-sm text-slate-500 shadow-sm">No HR modules are available for your permissions.</div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {visibleCards.map((card) => {
              const Icon = card.icon;
              return (
                <Link
                  key={card.title}
                  href={card.href}
                  className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className={`rounded-2xl p-3 ${card.tone}`}>
                      <Icon className="h-6 w-6" />
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                      {card.meta}
                    </span>
                  </div>
                  <h2 className="mt-5 text-xl font-semibold text-slate-950">{card.title}</h2>
                  <p className="mt-2 min-h-12 text-sm leading-6 text-slate-600">{card.description}</p>
                  <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
                    Open <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
