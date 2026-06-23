"use client";

import type { ReimbursementHistoryRow } from "@/types/hr";
import { formatDate, labelize } from "./hrClient";

export default function StatusTimeline({ history }: { history: ReimbursementHistoryRow[] }) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-slate-950">Status Timeline</h3>
      <div className="mt-4 space-y-3">
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">No status history available.</p>
        ) : (
          history.map((row) => (
            <div key={row.id} className="rounded-xl border bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-semibold text-slate-900">
                  {labelize(row.action)}: {labelize(row.from_status)} {"->"} {labelize(row.to_status)}
                </p>
                <span className="text-xs font-medium text-slate-500">{formatDate(row.changed_at)}</span>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                {row.changed_by_name || row.changed_by_email || "-"}
              </p>
              {row.remarks && <p className="mt-2 text-sm text-slate-700">{row.remarks}</p>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
