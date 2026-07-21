"use client";

import Link from "next/link";
import { ArrowRight, ReceiptText, UsersRound } from "lucide-react";
import { useAccessContext } from "@/components/AccessContext";
import HrSectionNav from "@/components/hr/HrSectionNav";
import { can } from "@/lib/accessControl";

const primaryModules = [
  {
    title: "Employees",
    description: "Manage employee profiles, company and site assignments, departments, designations, documents and ERP access.",
    href: "/hr/employees",
    moduleCode: "hr_employees",
    icon: UsersRound,
    meta: "Core HR",
    accent: "bg-sky-500",
    tone: "bg-sky-50 text-sky-700 border-sky-100",
  },
  {
    title: "Reimbursements",
    description: "Create, review and track employee reimbursement claims with supporting documents and status history.",
    href: "/hr/reimbursements",
    moduleCode: "reimbursements",
    icon: ReceiptText,
    meta: "Claims",
    accent: "bg-emerald-500",
    tone: "bg-emerald-50 text-emerald-700 border-emerald-100",
  },
];

export default function HrLauncherPage() {
  const { access, loading } = useAccessContext();
  const permissions = access?.permissions || [];
  const visiblePrimaryModules = primaryModules.filter((card) => can(permissions, card.moduleCode, "view"));

  if (loading) {
    return (
      <section className="min-h-[60vh] bg-slate-50 px-6 py-8 text-sm font-medium text-slate-500 md:px-10">
        Loading HR...
      </section>
    );
  }

  return (
    <section className="min-h-screen bg-slate-50 px-6 py-7 text-slate-950 md:px-10">
      <div className="mx-auto max-w-[1500px] space-y-8">
        <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <nav className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Link href="/modules" className="hover:text-slate-900">Modules</Link>
            <span>/</span>
            <span className="text-slate-800">HR</span>
          </nav>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">Human Resources</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Manage employees, reimbursement workflows and HR master records across companies and sites.
          </p>
        </header>

        <HrSectionNav />

        {visiblePrimaryModules.length === 0 ? (
          <div className="rounded-2xl border bg-white p-8 text-sm text-slate-500 shadow-sm">No HR modules are available for your permissions.</div>
        ) : (
          <>
            {visiblePrimaryModules.length > 0 && (
              <section>
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-slate-950">Module Cards</h2>
                  <p className="mt-1 text-sm text-slate-500">Primary HR workflows currently enabled in ConstructIQ.</p>
                </div>
                <div className="grid gap-5 lg:grid-cols-2">
                  {visiblePrimaryModules.map((card) => (
                    <PrimaryModuleCard key={card.title} card={card} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function PrimaryModuleCard({ card }: { card: (typeof primaryModules)[number] }) {
  const Icon = card.icon;

  return (
    <Link
      href={card.href}
      className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
    >
      <div className={`absolute left-0 top-0 h-1 w-full ${card.accent}`} />
      <div className="flex items-start justify-between gap-4">
        <div className={`rounded-2xl border p-3 ${card.tone}`}>
          <Icon className="h-6 w-6" />
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
          {card.meta}
        </span>
      </div>
      <h2 className="mt-5 text-xl font-semibold text-slate-950">{card.title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{card.description}</p>
      <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
        Open <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
      </div>
    </Link>
  );
}
