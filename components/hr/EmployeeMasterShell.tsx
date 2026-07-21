"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Trash2 } from "lucide-react";
import EmployeePhoto from "./EmployeePhoto";
import StatusBadge from "./StatusBadge";
import { formatDate, labelize } from "./hrClient";

export type EmployeeMasterTab = {
  id: string;
  label: string;
};

export type EmployeeMasterSummary = {
  employeeName?: string | null;
  employeeCode?: string | null;
  department?: string | null;
  designation?: string | null;
  status?: string | null;
  company?: string | null;
  site?: string | null;
  employeeType?: string | null;
  joiningDate?: string | null;
  photoUrl?: string | null;
  photoPreviewUrl?: string | null;
};

type Props = {
  title: string;
  description: string;
  summary: EmployeeMasterSummary;
  tabs: EmployeeMasterTab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  children: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  dangerAction?: ReactNode;
};

function displayValue(value?: string | null) {
  const text = String(value || "").trim();
  return text || "-";
}

export default function EmployeeMasterShell({
  title,
  description,
  summary,
  tabs,
  activeTab,
  onTabChange,
  children,
  primaryAction,
  secondaryAction,
  dangerAction,
}: Props) {
  const employeeName = displayValue(summary.employeeName);

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">Employee Master</p>
            <h1 className="mt-2 text-3xl font-bold text-slate-950">{title}</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">{description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {secondaryAction}
            {dangerAction}
            {primaryAction}
          </div>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <EmployeePhoto
              name={summary.employeeName}
              photoUrl={summary.photoPreviewUrl || summary.photoUrl || null}
              size="lg"
            />
            <div className="min-w-0">
              <h2 className="text-2xl font-bold text-slate-950">{employeeName}</h2>
              <p className="mt-1 text-sm font-semibold text-slate-500">{displayValue(summary.employeeCode)}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <SummaryItem label="Department" value={displayValue(summary.department)} />
                <SummaryItem label="Designation" value={displayValue(summary.designation)} />
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-900 bg-slate-950 p-5 text-white shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Assignment</p>
            <StatusBadge status={summary.status || "active"} />
          </div>
          <div className="mt-5 space-y-4">
            <DarkSummaryItem label="Company" value={displayValue(summary.company)} />
            <DarkSummaryItem label="Site" value={displayValue(summary.site)} />
            <div className="grid grid-cols-2 gap-4">
              <DarkSummaryItem label="Type" value={labelize(summary.employeeType)} />
              <DarkSummaryItem label="Joining" value={formatDate(summary.joiningDate)} />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto border-b border-slate-200">
          <div className="flex min-w-max gap-1 px-4">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onTabChange(tab.id)}
                  className={`border-b-2 px-4 py-4 text-sm font-semibold transition-colors ${
                    isActive
                      ? "border-slate-950 text-slate-950"
                      : "border-transparent text-slate-500 hover:text-slate-900"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="bg-slate-50/60 p-4 sm:p-6">{children}</div>
      </section>
    </div>
  );
}

export function EmployeePrimaryButton({
  children,
  disabled,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Check className="h-4 w-4" />
      {children}
    </button>
  );
}

export function EmployeeCancelLink({ href = "/hr/employees", label = "Cancel" }: { href?: string; label?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </Link>
  );
}

export function EmployeeDangerButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
    >
      <Trash2 className="h-4 w-4" />
      {children}
    </button>
  );
}

function SummaryItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 truncate text-sm font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function DarkSummaryItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-1 truncate text-sm font-semibold text-white">{value}</div>
    </div>
  );
}
