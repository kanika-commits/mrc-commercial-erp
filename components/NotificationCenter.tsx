"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { notificationBadgeCount, pendingActionsEmptyState, sanitizeNotificationTargetUrl } from "@/lib/notificationPresentation";

const workflowLinks = [
  ["Employee Attendance Sent Back", "employeeAttendanceSentBack", "/hr/attendance/daily"],
  ["Labour Attendance Sent Back", "labourAttendanceSentBack", "/labour/attendance/daily"],
] as const;

type NotificationPosition = { top: number; right: number; width: number };

export default function NotificationCenter({ workflowCounts, workflowCountsLoaded, workflowCountsError }: { workflowCounts: Record<string, number>; workflowCountsLoaded: boolean; workflowCountsError: boolean }) {
  const [open, setOpen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsLoaded, setNotificationsLoaded] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [position, setPosition] = useState<NotificationPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pendingActionTotal = workflowLinks.reduce((sum, [, key]) => sum + (workflowCounts[key] || 0), 0);
  const unreadBadgeCount = notificationBadgeCount(unreadCount);
  const pendingState = pendingActionsEmptyState({ count: pendingActionTotal, loaded: workflowCountsLoaded, hasError: workflowCountsError });

  function updatePosition() {
    const button = buttonRef.current;
    if (!button || typeof window === "undefined") return;
    const rect = button.getBoundingClientRect();
    const width = Math.max(0, Math.min(320, window.innerWidth - 32));
    const maxPanelHeight = Math.min(480, Math.max(0, window.innerHeight - 32));
    setPosition({
      top: Math.max(16, Math.min(rect.bottom + 8, window.innerHeight - maxPanelHeight - 16)),
      right: Math.max(16, window.innerWidth - rect.right),
      width,
    });
  }

  async function load() {
    setLoadError(false);
    setNotificationsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setUnreadCount(0);
        setLoadError(true);
        return;
      }
      const response = await fetch("/api/notifications?limit=20", { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
      if (!response.ok) {
        setUnreadCount(0);
        setLoadError(true);
        return;
      }
      const payload = await response.json();
      setNotifications(Array.isArray(payload.notifications) ? payload.notifications : []);
      setUnreadCount(Number.isFinite(payload.unread_count) ? Math.max(0, payload.unread_count) : 0);
      setNotificationsLoaded(true);
    } catch {
      setUnreadCount(0);
      setLoadError(true);
    } finally {
      setNotificationsLoading(false);
    }
  }

  useEffect(() => { setPortalReady(true); void load(); }, []);

  useEffect(() => {
    if (!open || !portalReady) return;
    updatePosition();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const reposition = () => updatePosition();
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, portalReady]);

  async function openNotification(notification: any) {
    const wasUnread = !notification.is_read;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        const response = await fetch("/api/notifications", {
          method: "PATCH",
          headers: { "content-type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ id: notification.id }),
        });
        if (response.ok) {
          const payload = await response.json();
          notification = { ...notification, ...payload.notification };
        }
      }
    } finally {
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, is_read: true, read_at: new Date().toISOString() } : item));
      if (wasUnread) setUnreadCount((current) => Math.max(0, current - 1));
      const target = sanitizeNotificationTargetUrl(notification.target_url);
      if (target) window.location.href = target;
    }
  }

  const panel = open && portalReady && position ? createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Notifications"
      className="fixed z-[1000] rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
      style={{ top: position.top, right: position.right, width: position.width, maxWidth: "calc(100vw - 2rem)", maxHeight: "calc(100vh - 2rem)" }}
    >
      <div className="border-b border-slate-100 px-2 pb-2">
        <p className="text-sm font-bold text-slate-950">Notifications</p>
        <p className="text-xs text-slate-500">Actions and recent updates</p>
      </div>
      <div className="mt-2 max-h-[calc(100vh-9rem)] space-y-3 overflow-y-auto">
        <section aria-label="Your Pending Actions">
          <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">Your Pending Actions</p>
          {pendingState === "error" ? <p role="status" className="px-2 py-2 text-xs text-rose-700">Unable to load pending actions</p>
            : pendingState === "loading" ? <p className="px-2 py-2 text-xs text-slate-500">Loading pending actions…</p>
              : pendingState === "empty" ? <p className="px-2 py-2 text-xs text-slate-500">No pending actions</p>
                : workflowLinks.map(([label, key, href]) => workflowCounts[key] > 0 && <Link key={key} href={href} onClick={() => setOpen(false)} className="flex items-center justify-between rounded-lg px-2 py-2 text-sm transition hover:bg-slate-50">
                  <span className="font-medium text-slate-700">{label}</span><span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-bold text-white">{workflowCounts[key]}</span>
                </Link>)}
        </section>
        <section aria-label="Recent Updates">
          <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">Recent Updates</p>
          {loadError ? <p role="status" className="px-2 py-2 text-xs text-rose-700">Unable to load notifications</p>
            : notificationsLoading && !notificationsLoaded ? <p className="px-2 py-2 text-xs text-slate-500">Loading notifications…</p>
              : notifications.length === 0 ? <p className="px-2 py-2 text-xs text-slate-500">No notifications yet</p>
              : notifications.map((notification) => <button key={notification.id} type="button" onClick={() => void openNotification(notification)} className={`block w-full rounded-lg px-2 py-2 text-left hover:bg-slate-50 ${notification.is_read ? "" : "bg-sky-50"}`}>
          <p className="text-xs font-bold text-slate-900">{notification.title}</p>
          <p className="mt-0.5 text-xs text-slate-600">{notification.message}</p>
          <p className="mt-1 text-[10px] text-slate-400">{new Date(notification.created_at).toLocaleString("en-IN")}</p>
        </button>)}
        </section>
      </div>
    </div>, document.body,
  ) : null;

  return <>
    <button ref={buttonRef} type="button" onClick={() => { const next = !open; setOpen(next); if (next) void load(); }} className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 transition hover:bg-slate-100" aria-label="Notifications" aria-expanded={open}>
      <Bell className="h-5 w-5" />{unreadBadgeCount > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-4 text-white">{unreadBadgeCount}</span>}
    </button>
    {panel}
  </>;
}
