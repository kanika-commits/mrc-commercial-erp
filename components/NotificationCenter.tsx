"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { supabase } from "@/lib/supabase";

const workflowLinks = [
  ["Pending Work Orders", "pendingWorkOrders", "/approvals/work-orders"],
  ["Pending RA Bills", "pendingRaBills", "/approvals"],
  ["Pending Debit Notes", "pendingDebitNotes", "/approvals"],
  ["Pending ITC Review", "pendingItcReview", "/invoices/itc"],
  ["Employee Attendance Sent Back", "employeeAttendanceSentBack", "/hr/attendance/daily"],
  ["Labour Attendance Sent Back", "labourAttendanceSentBack", "/labour/attendance/daily"],
] as const;

export default function NotificationCenter({ workflowCounts }: { workflowCounts: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const workflowTotal = workflowLinks.reduce((sum, [, key]) => sum + (workflowCounts[key] || 0), 0);
  const unread = notifications.filter((item) => !item.is_read).length;
  const total = workflowTotal + unread;

  async function load() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    const response = await fetch("/api/notifications?limit=20", { headers: { Authorization: `Bearer ${session.access_token}` } });
    if (response.ok) setNotifications((await response.json()).notifications || []);
  }
  useEffect(() => { void load(); }, []);

  async function openNotification(notification: any) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) await fetch("/api/notifications", { method: "PATCH", headers: { "content-type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ id: notification.id }) });
    } finally {
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, is_read: true, read_at: new Date().toISOString() } : item));
      if (notification.target_url) window.location.href = notification.target_url;
    }
  }

  return <div className="relative"><button type="button" onClick={() => setOpen((current) => !current)} className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 transition hover:bg-slate-100" aria-label="Notifications" aria-expanded={open}><Bell className="h-5 w-5" />{total > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-4 text-white">{total}</span>}</button>{open && <div className="absolute right-0 top-11 z-50 w-[calc(100vw-2rem)] max-w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-xl"><div className="border-b border-slate-100 px-2 pb-2"><p className="text-sm font-bold text-slate-950">Notifications</p><p className="text-xs text-slate-500">Pending workflow alerts</p></div>{total === 0 ? <div className="px-2 py-4 text-sm text-slate-500">No pending alerts</div> : <div className="mt-2 max-h-80 space-y-1 overflow-y-auto">{notifications.map((notification) => <button key={notification.id} type="button" onClick={() => void openNotification(notification)} className={`block w-full rounded-lg px-2 py-2 text-left hover:bg-slate-50 ${notification.is_read ? "" : "bg-sky-50"}`}><p className="text-xs font-bold text-slate-900">{notification.title}</p><p className="mt-0.5 text-xs text-slate-600">{notification.message}</p><p className="mt-1 text-[10px] text-slate-400">{new Date(notification.created_at).toLocaleString("en-IN")}</p></button>)}{workflowLinks.map(([label, key, href]) => workflowCounts[key] > 0 && <Link key={key} href={href} className="flex items-center justify-between rounded-lg px-2 py-2 text-sm transition hover:bg-slate-50"><span className="font-medium text-slate-700">{label}</span><span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-bold text-white">{workflowCounts[key]}</span></Link>)}</div>}</div>}</div>;
}
