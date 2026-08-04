"use client";

import Link from "next/link";
import { ArrowRight, CalendarCheck, CheckCircle2, ReceiptText, UserRoundCog, UsersRound, WalletCards } from "lucide-react";
import { useEffect, useState } from "react";
import { useAccessContext } from "@/components/AccessContext";
import HrSectionNav from "@/components/hr/HrSectionNav";
import { can } from "@/lib/accessControl";
import {
  isLabourRouteAllowedForAttendanceSystem,
  labourWorkflowForNavigation,
  shouldShowLabourWorkspace,
  subscribeSelectedLabourContext,
  subscribeLabourWorkspaceSummary,
  type LabourWorkspaceSummary,
  type SelectedLabourContext,
} from "@/lib/labour/attendanceSystemContext";

const primaryModules = [
  {
    title: "Employee Registration",
    description: "Manage employee profiles, company and site assignments, departments, designations, documents and ERP access.",
    href: "/hr/employees",
    moduleCode: "hr_employees",
    icon: UsersRound,
    meta: "Core HR",
    accent: "bg-sky-500",
    tone: "bg-sky-50 text-sky-700 border-sky-100",
  },
  {
    title: "Attendance Workspace",
    description: "Choose the active Company and Site, then open the configured Labour attendance workflow.",
    href: "/labour",
    moduleCode: "labour_workspace",
    icon: CalendarCheck,
    meta: "Muster",
    accent: "bg-amber-500",
    tone: "bg-amber-50 text-amber-700 border-amber-100",
  },
  {
    title: "Labour Registration",
    description: "Register labourers for site muster and manage current labour identity records.",
    href: "/labour/workers",
    moduleCode: "labour_workers",
    icon: UsersRound,
    meta: "Muster",
    accent: "bg-amber-500",
    tone: "bg-amber-50 text-amber-700 border-amber-100",
  },
  {
    title: "Labour Attendance",
    description: "Enter Standard Labour Attendance for sites configured for Attendance System 1.",
    href: "/labour/attendance/daily",
    moduleCode: "labour_attendance",
    icon: CalendarCheck,
    meta: "Muster",
    accent: "bg-amber-500",
    tone: "bg-amber-50 text-amber-700 border-amber-100",
  },
  {
    title: "Site-In",
    description: "Mark labourers arriving at site before Attendance and Daily Work begin.",
    href: "/labour/site-in",
    moduleCode: "labour_site_in",
    icon: CalendarCheck,
    meta: "Muster",
    accent: "bg-amber-500",
    tone: "bg-amber-50 text-amber-700 border-amber-100",
  },
  {
    title: "Engineer Daily Labour",
    description: "Mark assigned labour attendance, OT, bonus hours and daily work from one page.",
    href: "/labour/engineer-daily",
    moduleCode: "labour_engineer_daily",
    icon: UserRoundCog,
    meta: "Muster",
    accent: "bg-amber-500",
    tone: "bg-amber-50 text-amber-700 border-amber-100",
  },
  {
    title: "Labour Approval",
    description: "Review Labour approvals and open the monthly read-only attendance view.",
    href: "/labour/approvals",
    moduleCode: "labour_daily_submission",
    icon: CheckCircle2,
    meta: "Muster",
    accent: "bg-amber-500",
    tone: "bg-amber-50 text-amber-700 border-amber-100",
  },
  {
    title: "Reimbursement",
    description: "Create, review and track employee reimbursement claims with supporting documents and status history.",
    href: "/hr/reimbursements",
    moduleCode: "reimbursements",
    icon: ReceiptText,
    meta: "Claims",
    accent: "bg-emerald-500",
    tone: "bg-emerald-50 text-emerald-700 border-emerald-100",
  },
  {
    title: "Mark Attendance",
    description: "Enter daily staff attendance and review the monthly attendance register.",
    href: "/hr/attendance/daily",
    moduleCode: "hr_attendance",
    icon: CalendarCheck,
    meta: "Staff Attendance",
    accent: "bg-indigo-500",
    tone: "bg-indigo-50 text-indigo-700 border-indigo-100",
  },
  {
    title: "Attendance Register",
    description: "Review monthly day-wise attendance, totals, period status and export CSV.",
    href: "/hr/attendance/monthly",
    moduleCode: "hr_attendance",
    icon: CalendarCheck,
    meta: "Staff Attendance",
    accent: "bg-indigo-500",
    tone: "bg-indigo-50 text-indigo-700 border-indigo-100",
  },
  {
    title: "Attendance Approval",
    description: "Review submitted employee attendance periods at the configured approval level.",
    href: "/hr/attendance-approval",
    moduleCode: "hr_attendance_approval",
    icon: CalendarCheck,
    meta: "Approvals",
    accent: "bg-violet-500",
    tone: "bg-violet-50 text-violet-700 border-violet-100",
  },
];

const plannedModules = [
  {
    title: "Salary",
    description: "Salary workflows will be configured in a later phase.",
    icon: WalletCards,
    meta: "Planned",
  },
];

const directHrModuleCodes = new Set(["hr_employees", "hr_attendance", "hr_attendance_approval", "reimbursements"]);
const musterModuleCodes = new Set(["labour_workspace", "labour_workers", "labour_attendance", "labour_site_in", "labour_engineer_daily", "labour_daily_submission"]);

export default function HrLauncherPage() {
  const { access, loading } = useAccessContext();
  const [labourContext, setLabourContext] = useState<SelectedLabourContext | null>(null);
  const [labourWorkspace, setLabourWorkspace] = useState<LabourWorkspaceSummary>({ pairs: [], attendance_systems: [] });
  const permissions = access?.permissions || [];
  const labourWorkflow = labourWorkflowForNavigation(labourContext, labourWorkspace);
  const global = Boolean(access?.isGlobalAccess || access?.roleCodes?.includes("platform_owner") || access?.roleCodes?.includes("super_admin") || permissions.some((permission) => permission.allowed === true && permission.module_code === "*" && permission.action_code === "*"));
  const showLabourWorkspace = shouldShowLabourWorkspace(labourWorkspace, global);
  const visiblePrimaryModules = primaryModules.filter((card) => {
    if (card.moduleCode === "labour_workspace") {
      return showLabourWorkspace && (can(permissions, "labour_workers", "view") || can(permissions, "labour_attendance", "view") || can(permissions, "labour_site_in", "view") || can(permissions, "labour_engineer_daily", "view") || can(permissions, "labour_daily_submission", "view") || can(permissions, "labour_muster_configuration", "view"));
    }
    if (card.moduleCode === "labour_daily_submission" && !can(permissions, "labour_daily_submission", "view") && !can(permissions, "labour_attendance", "view")) return false;
    if (card.moduleCode !== "labour_daily_submission" && !can(permissions, card.moduleCode, "view")) return false;
    if (!isLabourRouteAllowedForAttendanceSystem(card.moduleCode, labourWorkflow)) return false;
    if (!isLabourRouteAllowedForAttendanceSystem(card.href, labourWorkflow)) return false;
    return true;
  });
  const directHrModules = visiblePrimaryModules.filter((card) => directHrModuleCodes.has(card.moduleCode));
  const musterModules = visiblePrimaryModules.filter((card) => musterModuleCodes.has(card.moduleCode));

  useEffect(() => subscribeSelectedLabourContext(setLabourContext), []);
  useEffect(() => subscribeLabourWorkspaceSummary(setLabourWorkspace), []);

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
            Manage employee registration, attendance, salary, reimbursement and muster workflows across companies and sites.
          </p>
        </header>

        <HrSectionNav />

        {visiblePrimaryModules.length === 0 ? (
          <div className="rounded-2xl border bg-white p-8 text-sm text-slate-500 shadow-sm">No HR modules are available for your permissions.</div>
        ) : (
          <>
            {directHrModules.length > 0 && (
              <CompactModuleSection title="Human Resources" cards={directHrModules} />
            )}
            {musterModules.length > 0 && (
              <CompactModuleSection title="Muster" cards={musterModules} />
            )}
            <section>
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-slate-950">Planned HR Areas</h2>
                <p className="mt-1 text-sm text-slate-500">Approved HR structure items without active workflows yet.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {plannedModules.map((card) => (
                  <PlannedModuleCard key={card.title} card={card} />
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </section>
  );
}

function CompactModuleSection({
  title,
  cards,
}: {
  title: string;
  cards: Array<(typeof primaryModules)[number]>;
}) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          {title}
        </h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <PrimaryModuleCard key={card.title} card={card} />
        ))}
      </div>
    </section>
  );
}

function PlannedModuleCard({ card }: { card: (typeof plannedModules)[number] }) {
  const Icon = card.icon;

  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white p-4 text-slate-500 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-2 text-slate-400">
          <Icon className="h-5 w-5" />
        </div>
        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
          {card.meta}
        </span>
      </div>
      <h2 className="mt-4 text-base font-semibold text-slate-700">{card.title}</h2>
      <p className="mt-1 text-xs leading-5 text-slate-500">{card.description}</p>
    </div>
  );
}

function PrimaryModuleCard({ card }: { card: (typeof primaryModules)[number] }) {
  const Icon = card.icon;

  return (
    <Link
      href={card.href}
      className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
    >
      <div className={`absolute left-0 top-0 h-1 w-full ${card.accent}`} />
      <div className="flex items-start justify-between gap-3">
        <div className={`rounded-xl border p-2 ${card.tone}`}>
          <Icon className="h-5 w-5" />
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
          {card.meta}
        </span>
      </div>
      <h2 className="mt-4 text-base font-semibold text-slate-950">{card.title}</h2>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{card.description}</p>
      <div className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-slate-900">
        Open <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
      </div>
    </Link>
  );
}
