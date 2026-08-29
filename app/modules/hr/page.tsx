"use client";

import Link from "next/link";
import { ArrowRight, CalendarCheck, CheckCircle2, FileText, ReceiptText, UserRoundCog, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import {
  isLabourRouteAllowedForAttendanceSystem,
  labourWorkflowForNavigation,
  shouldShowLabourWorkspace,
  subscribeLabourWorkspaceSummary,
  subscribeSelectedLabourContext,
  type LabourWorkspaceSummary,
  type SelectedLabourContext,
} from "@/lib/labour/attendanceSystemContext";

const primaryModules = [
  {
    title: "Employee Registration",
    description: "Manage employee profiles, assignments, departments, designations, documents and ERP access.",
    href: "/hr/employees",
    moduleCode: "hr_employees",
    icon: UsersRound,
    className: "from-amber-50 to-white border-amber-100 text-amber-700",
  },
  {
    title: "Reimbursements",
    description: "Create, review and track employee reimbursement claims.",
    href: "/hr/reimbursements",
    moduleCode: "reimbursements",
    icon: ReceiptText,
    className: "from-orange-50 to-white border-orange-100 text-orange-700",
  },
  {
    title: "Mark Attendance",
    description: "Enter daily staff attendance.",
    href: "/hr/attendance/daily",
    moduleCode: "hr_attendance",
    icon: CalendarCheck,
    className: "from-green-50 to-white border-green-100 text-green-700",
  },
  {
    title: "Attendance Register",
    description: "Review monthly day-wise attendance, totals and period status.",
    href: "/hr/attendance/monthly",
    moduleCode: "hr_attendance_register",
    icon: CalendarCheck,
    className: "from-green-50 to-white border-green-100 text-green-700",
  },
  {
    title: "Attendance Approval",
    description: "Review submitted employee attendance periods.",
    href: "/hr/attendance-approval",
    moduleCode: "hr_attendance_approval",
    icon: CheckCircle2,
    className: "from-green-50 to-white border-green-100 text-green-700",
  },
  {
    title: "Attendance Workspace",
    description: "Choose the active company and site, then open the configured labour workflow.",
    href: "/labour",
    moduleCode: "labour_workspace",
    icon: FileText,
    className: "from-amber-50 to-white border-amber-100 text-amber-700",
  },
  {
    title: "Labour Registration",
    description: "Register labourers for site muster and manage labour identity records.",
    href: "/labour/workers",
    moduleCode: "labour_workers",
    icon: UsersRound,
    className: "from-amber-50 to-white border-amber-100 text-amber-700",
  },
  {
    title: "Labour Attendance",
    description: "Enter standard labour attendance for configured sites.",
    href: "/labour/attendance/daily",
    moduleCode: "labour_attendance",
    icon: CalendarCheck,
    className: "from-green-50 to-white border-green-100 text-green-700",
  },
  {
    title: "Labour Approval",
    description: "Review labour approvals and monthly attendance submissions.",
    href: "/labour/approvals",
    moduleCode: "labour_daily_submission",
    icon: CheckCircle2,
    className: "from-green-50 to-white border-green-100 text-green-700",
  },
  {
    title: "Site-In",
    description: "Mark labourers arriving at site before daily work begins.",
    href: "/labour/site-in",
    moduleCode: "labour_site_in",
    icon: CalendarCheck,
    className: "from-amber-50 to-white border-amber-100 text-amber-700",
  },
  {
    title: "Engineer Daily Labour",
    description: "Mark assigned labour attendance, OT, bonus hours and daily work.",
    href: "/labour/engineer-daily",
    moduleCode: "labour_engineer_daily",
    icon: UserRoundCog,
    className: "from-amber-50 to-white border-amber-100 text-amber-700",
  },
];

const directHrModuleCodes = new Set(["hr_employees", "hr_attendance", "hr_attendance_register", "hr_attendance_approval", "reimbursements"]);
const musterModuleCodes = new Set(["labour_workspace", "labour_workers", "labour_attendance", "labour_site_in", "labour_engineer_daily", "labour_daily_submission"]);

export default function HrLauncherPage() {
  const { access, loading } = useAccessContext();
  const [labourContext, setLabourContext] = useState<SelectedLabourContext | null>(null);
  const [labourWorkspace, setLabourWorkspace] = useState<LabourWorkspaceSummary>({ pairs: [], attendance_systems: [] });
  const permissions = access?.permissions || [];
  const labourWorkflow = labourWorkflowForNavigation(labourContext, labourWorkspace);
  const global = Boolean(access?.isGlobalAccess || access?.roleCodes?.includes("platform_owner") || access?.roleCodes?.includes("super_admin") || permissions.some((permission) => permission.allowed === true && permission.module_code === "*" && permission.action_code === "*"));
  const showLabourWorkspace = shouldShowLabourWorkspace(labourWorkspace, global);

  useEffect(() => subscribeSelectedLabourContext(setLabourContext), []);
  useEffect(() => subscribeLabourWorkspaceSummary(setLabourWorkspace), []);

  const visiblePrimaryModules = primaryModules.filter((card) => {
    if (card.moduleCode === "labour_workspace") {
      return showLabourWorkspace && (can(permissions, "labour_workers", "view") || can(permissions, "labour_attendance", "view") || can(permissions, "labour_site_in", "view") || can(permissions, "labour_engineer_daily", "view") || can(permissions, "labour_daily_submission", "view") || can(permissions, "labour_muster_configuration", "view"));
    }
    if (card.moduleCode === "labour_daily_submission" && !can(permissions, "labour_daily_submission", "view")) return false;
    if (card.moduleCode !== "labour_daily_submission" && !can(permissions, card.moduleCode, "view")) return false;
    if (!isLabourRouteAllowedForAttendanceSystem(card.moduleCode, labourWorkflow)) return false;
    if (!isLabourRouteAllowedForAttendanceSystem(card.href, labourWorkflow)) return false;
    return true;
  });
  const directHrModules = visiblePrimaryModules.filter((card) => directHrModuleCodes.has(card.moduleCode));
  const musterModules = visiblePrimaryModules.filter((card) => musterModuleCodes.has(card.moduleCode));

  if (loading) return <p className="text-sm text-gray-500">Loading module...</p>;

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Module
        </p>
        <h1 className="text-2xl font-bold text-slate-950">Human Resources</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage employee registration, attendance, reimbursement and labour workflows.
        </p>
      </div>

      {visiblePrimaryModules.length === 0 ? (
        <div className="rounded-2xl border bg-white p-6 text-sm text-slate-500 shadow-sm">
          No accessible pages found in this module.
        </div>
      ) : (
        <div className="space-y-5">
          {directHrModules.length > 0 && (
            <ModuleSection title="Human Resources" cards={directHrModules} />
          )}
          {musterModules.length > 0 && (
            <ModuleSection title="Muster" cards={musterModules} />
          )}
        </div>
      )}
    </section>
  );
}

function ModuleSection({
  title,
  cards,
}: {
  title: string;
  cards: Array<(typeof primaryModules)[number]>;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        {title}
      </h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <ModuleCard key={`${card.moduleCode}-${card.href}`} card={card} />
        ))}
      </div>
    </section>
  );
}

function ModuleCard({ card }: { card: (typeof primaryModules)[number] }) {
  const Icon = card.icon;

  return (
    <Link key={card.href} href={card.href}>
      <div className={`group rounded-xl border bg-gradient-to-br p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${card.className}`}>
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-white/80 p-2 shadow-sm">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-sm font-bold leading-5 text-slate-950">
                {card.title}
              </h2>
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 opacity-40 transition group-hover:translate-x-1 group-hover:opacity-100" />
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
              {card.description}
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
}
