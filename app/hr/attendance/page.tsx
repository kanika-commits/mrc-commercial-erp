"use client";

import Link from "next/link";
import { CalendarCheck, CalendarDays, ClipboardCheck } from "lucide-react";
import HrSectionNav from "@/components/hr/HrSectionNav";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";

const cards = [
  {
    title: "Mark Attendance",
    description: "Enter and lock staff attendance site-wise for a selected date.",
    href: "/hr/attendance/daily",
    icon: CalendarCheck,
  },
  {
    title: "Attendance Register",
    description: "Review employee day-wise attendance, totals, period status and export CSV.",
    href: "/hr/attendance/monthly",
    icon: CalendarDays,
  },
];

export default function AttendancePage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const canView = can(permissions, "hr_attendance", "view") || can(permissions, "hr_attendance_register", "view");

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
            <ClipboardCheck className="h-3.5 w-3.5" />
            HR Attendance
          </div>
          <h1 className="text-3xl font-bold text-slate-950">Employee Attendance</h1>
          <p className="max-w-3xl text-sm text-slate-500">Manage salaried staff attendance by company, site, date and monthly period.</p>
        </div>
      </header>
      <HrSectionNav />

      {!canView ? (
        <div className="rounded-2xl border bg-white p-8 text-sm text-slate-500 shadow-sm">Attendance is not available for your permissions.</div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <Link key={card.href} href={card.href} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="inline-flex rounded-2xl border border-sky-100 bg-sky-50 p-3 text-sky-700">
                  <Icon className="h-6 w-6" />
                </div>
                <h2 className="mt-5 text-xl font-semibold text-slate-950">{card.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{card.description}</p>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
