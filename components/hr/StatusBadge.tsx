"use client";

import { labelize } from "./hrClient";

const classes: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  draft: "bg-slate-100 text-slate-700",
  pending: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
  paid: "bg-sky-50 text-sky-700",
  deleted: "bg-slate-100 text-slate-500",
  inactive: "bg-slate-100 text-slate-600",
};

export default function StatusBadge({ status }: { status?: string | null }) {
  const key = String(status || "").trim().toLowerCase();

  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
        classes[key] || "bg-slate-100 text-slate-700"
      }`}
    >
      {labelize(status)}
    </span>
  );
}
