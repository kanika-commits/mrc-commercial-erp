"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Volume2, VolumeX } from "lucide-react";
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
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ top: 0, right: 16 });
  const bellRef = useRef<HTMLButtonElement>(null);
  const knownIdsRef = useRef<Set<string> | null>(null);
  const workflowTotal = workflowLinks.reduce((sum, [, key]) => sum + (workflowCounts[key] || 0), 0);
  const unread = notifications.filter((item) => !item.is_read).length;
  const total = workflowTotal + unread;

  const beep = useCallback(() => {
    if (!soundEnabled || typeof window === "undefined") return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.025, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.08);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.08);
      oscillator.addEventListener("ended", () => void context.close(), { once: true });
    } catch {
      // Browsers may reject audio until a user gesture; notifications still load normally.
    }
  }, [soundEnabled]);

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    const response = await fetch("/api/notifications?limit=20", { headers: { Authorization: `Bearer ${session.access_token}` } });
    if (!response.ok) return;
    const next = (await response.json()).notifications || [];
    const nextIds = new Set<string>(next.map((item: any) => String(item.id)));
    const previousIds = knownIdsRef.current;
    if (previousIds && [...nextIds].some((id) => !previousIds.has(id))) beep();
    knownIdsRef.current = nextIds;
    setNotifications(next);
  }, [beep]);

  useEffect(() => {
    try { setSoundEnabled(window.localStorage.getItem("erp-notification-sound") === "on"); } catch { /* local preference unavailable */ }
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  function toggleSound() {
    setSoundEnabled((current) => {
      const next = !current;
      try { window.localStorage.setItem("erp-notification-sound", next ? "on" : "off"); } catch { /* ignore storage failures */ }
      return next;
    });
  }

  async function openNotification(notification: any) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) await fetch("/api/notifications", { method: "PATCH", headers: { "content-type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ id: notification.id }) });
    } finally {
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, is_read: true, read_at: new Date().toISOString() } : item));
      if (notification.target_url) window.location.href = notification.target_url;
    }
  }

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = bellRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPanelPosition({ top: rect.bottom + 8, right: Math.max(16, window.innerWidth - rect.right) });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => { window.removeEventListener("resize", updatePosition); window.removeEventListener("scroll", updatePosition, true); };
  }, [open]);

  const panel = open && typeof document !== "undefined" ? createPortal(<div className="fixed z-[1000] w-[calc(100vw-2rem)] max-w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-2xl" style={{ top: panelPosition.top, right: panelPosition.right }}><div className="border-b border-slate-100 px-2 pb-2"><p className="text-sm font-bold text-slate-950">Notifications</p><p className="text-xs text-slate-500">Pending workflow alerts</p></div>{total === 0 ? <div className="px-2 py-4 text-sm text-slate-500">No pending alerts</div> : <div className="mt-2 max-h-80 space-y-1 overflow-y-auto">{notifications.map((notification) => <button key={notification.id} type="button" onClick={() => void openNotification(notification)} className={`block w-full rounded-lg px-2 py-2 text-left hover:bg-slate-50 ${notification.is_read ? "" : "bg-sky-50"}`}><p className="text-xs font-bold text-slate-900">{notification.title}</p><p className="mt-0.5 text-xs text-slate-600">{notification.message}</p><p className="mt-1 text-[10px] text-slate-400">{new Date(notification.created_at).toLocaleString("en-IN")}</p></button>)}{workflowLinks.map(([label, key, href]) => workflowCounts[key] > 0 && <Link key={key} href={href} className="flex items-center justify-between rounded-lg px-2 py-2 text-sm transition hover:bg-slate-50"><span className="font-medium text-slate-700">{label}</span><span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-bold text-white">{workflowCounts[key]}</span></Link>)}</div>}</div>, document.body) : null;
  return <><div className="relative flex items-center gap-1"><button ref={bellRef} type="button" onClick={() => setOpen((current) => !current)} className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 transition hover:bg-slate-100" aria-label="Notifications" aria-expanded={open}><Bell className="h-5 w-5" />{total > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-4 text-white">{total}</span>}</button><button type="button" onClick={toggleSound} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100" aria-label={soundEnabled ? "Mute notification sounds" : "Enable notification sounds"} aria-pressed={soundEnabled} title={soundEnabled ? "Notification sound on" : "Enable notification sounds"}>{soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}</button></div>{panel}</>;
}
