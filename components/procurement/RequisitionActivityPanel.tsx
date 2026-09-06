"use client";

import { useState } from "react";
import { Clock3 } from "lucide-react";
import { apiFetch, formatDate } from "@/components/hr/hrClient";

export default function RequisitionActivityPanel({ requisitionId }: { requisitionId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activities, setActivities] = useState<any[]>([]);
  const [message, setMessage] = useState("");

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || activities.length) return;
    setLoading(true); setMessage("");
    try { const result = await apiFetch(`/api/procurement/requisitions/${requisitionId}/activity`); setActivities(result.activities || []); }
    catch (error: any) { setMessage(error.message || "Failed to load activity."); }
    finally { setLoading(false); }
  }

  return <section className="rounded-2xl border bg-white shadow-sm"><button type="button" onClick={toggle} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"><span><span className="block font-semibold text-slate-950">Activity / Audit Trail</span><span className="text-xs text-slate-500">Chronological Indent changes, approvals, attachments, and workflow events.</span></span><Clock3 className="h-5 w-5 text-slate-500" /></button>{open && <div className="border-t px-5 py-4">{loading ? <p className="text-sm text-slate-500">Loading activity...</p> : message ? <p className="text-sm text-red-600">{message}</p> : activities.length === 0 ? <p className="text-sm text-slate-500">No activity recorded yet.</p> : <div className="space-y-4">{activities.map((activity) => <div key={`${activity.source}-${activity.id}`} className="border-l-2 border-slate-200 pl-4"><p className="text-xs text-slate-500">{formatDate(activity.created_at)}{activity.context ? ` · ${activity.context}` : ""}</p><p className="mt-1 font-semibold text-slate-950">{activity.title || "Activity"}</p><p className="text-sm text-slate-600">{activity.actor?.name || activity.actor?.email || "System"}</p>{activity.description && <p className="mt-1 text-sm text-slate-700">{activity.description}</p>}{activity.material_name && !String(activity.title || "").includes(activity.material_name) && <p className="mt-1 text-sm font-medium text-slate-700">{activity.material_name}</p>}{activity.note && <p className="mt-1 text-sm text-slate-600">{activity.note}</p>}{activity.changes?.length > 0 && <ul className="mt-2 space-y-2 text-sm text-slate-700">{activity.changes.map((change: any, index: number) => <li key={`${change.label}-${index}`}><p className="font-semibold text-slate-800">{change.label}</p>{change.text ? <p>{change.text}</p> : <p><span className="text-slate-500">Before:</span> {change.before || "—"} <span className="text-slate-400">→</span> <span className="text-slate-500">After:</span> {change.after || "—"}</p>}</li>)}</ul>}</div>)}</div>}</div>}</section>;
}
