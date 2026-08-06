"use client";

import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useAccessContext } from "@/components/AccessContext";
import { supabase } from "@/lib/supabase";

const PAGE_SIZE = 25;
const PRESENCE_REFRESH_MS = 60 * 1000;

const EMPTY_SUMMARY = {
  activities: 0,
  created: 0,
  edited: 0,
  approved: 0,
  rejected: 0,
  deleted: 0,
  suspended: 0,
  sent_back: 0,
};

type ActivityUser = Record<string, any>;
type OnlineUser = Record<string, any>;
type SelectedSummary = typeof EMPTY_SUMMARY;

function titleize(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "-";
  return text.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatDateTime(value: unknown, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-IN", options || { dateStyle: "medium", timeStyle: "short" });
}

function formatDate(value: unknown) {
  return formatDateTime(value, { day: "2-digit", month: "short", year: "numeric" });
}

function formatTime(value: unknown) {
  return formatDateTime(value, { hour: "2-digit", minute: "2-digit" });
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== null && entryValue !== undefined && entryValue !== "")
      .slice(0, 6)
      .map(([key, entryValue]) => `${key}: ${formatValue(entryValue)}`);
    return entries.length ? entries.join(", ") : "—";
  }
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return formatDateTime(text);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return formatDate(text);
  if (/rate|amount|salary|value|wage/i.test(text)) return text;
  return text;
}

function displayDash(value: unknown) {
  if (!value || value === "-" || value === "Not Applicable") return "—";
  return String(value);
}

function activityLabel(activity: any) {
  return activity.display_activity || activity.activity || titleize(activity.action);
}

function activityBadgeClass(activity: any) {
  const action = String(activity.action || "").toLowerCase();
  const label = activityLabel(activity).toLowerCase();
  if (action === "create" || action === "add" || label.includes("registered") || label.includes("created") || label.includes("added")) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (action === "approve" || action === "finalize" || label.includes("approved") || label.includes("finalized")) return "border-purple-200 bg-purple-50 text-purple-700";
  if (action === "send_back" || label.includes("sent back")) return "border-orange-200 bg-orange-50 text-orange-700";
  if (action === "reject" || action === "delete" || label.includes("rejected") || label.includes("deleted")) return "border-red-200 bg-red-50 text-red-700";
  if (action === "suspended" || label.includes("suspended")) return "border-amber-200 bg-amber-50 text-amber-800";
  if (action === "login" || action === "logout") return "border-slate-200 bg-slate-50 text-slate-700";
  return "border-blue-200 bg-blue-50 text-blue-700";
}

function RecordCell({ activity }: { activity: any }) {
  const label = activity.record || "—";
  if (activity.record_url) {
    return <Link href={activity.record_url} className="font-semibold text-blue-700 hover:underline">{label}</Link>;
  }
  return <>{label}</>;
}

function PresenceStatus({ status }: { status: unknown }) {
  const online = status === "online";
  return (
    <span className="inline-flex items-center gap-2 font-semibold text-slate-700">
      <span className={`h-2.5 w-2.5 rounded-full ${online ? "bg-emerald-500" : "bg-slate-400"}`} />
      {online ? "Online" : "Offline"}
    </span>
  );
}

function deviceLabel(user: any) {
  const details = [user.browser, user.device_type ? titleize(user.device_type) : null].filter(Boolean);
  return details.length ? details.join(" · ") : "—";
}

function SummaryTile({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-lg border bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-950">{Number(value || 0)}</p>
    </div>
  );
}

function formatChangeValue(label: string, value: unknown) {
  const formatted = formatValue(value);
  if (formatted === "—") return formatted;
  if (/rate|amount|salary|value|wage/i.test(label) && /^-?\d+(\.\d+)?$/.test(formatted)) return `₹${formatted}`;
  return formatted;
}

function ChangeList({ changes }: { changes: any[] }) {
  const readableChanges = (changes || []).filter((change) => change?.label && change.label !== "Stage");
  if (!readableChanges.length) return <p className="text-sm text-slate-500">No readable field changes recorded for this activity.</p>;
  return (
    <dl className="grid gap-2 text-sm md:grid-cols-2">
      {readableChanges.map((change, index) => (
        <div key={`${change.label}-${index}`} className="rounded-md border border-slate-200 bg-white p-3">
          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{change.label}</dt>
          <dd className="mt-1 break-words text-slate-800">
            {change.before !== null && change.before !== undefined ? <>{formatChangeValue(change.label, change.before)} <span className="font-semibold text-slate-400">→</span> </> : null}
            {formatChangeValue(change.label, change.after)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function SystemActivityPage() {
  const { access, loading: accessLoading } = useAccessContext();
  const allowed = Boolean(access?.roleCodes?.includes("platform_owner") || access?.roleCodes?.includes("super_admin"));
  const [users, setUsers] = useState<ActivityUser[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [selectedSummary, setSelectedSummary] = useState<SelectedSummary>(EMPTY_SUMMARY);
  const [filters, setFilters] = useState({ date_from: "", date_to: "", user: "" });
  const [page, setPage] = useState(1);
  const [totalUsers, setTotalUsers] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [expandedUsers, setExpandedUsers] = useState<Record<string, boolean>>({});
  const [expandedActivities, setExpandedActivities] = useState<Record<string, boolean>>({});

  async function token() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  }

  const loadPresenceOnly = useCallback(async (activityUsers = users) => {
    if (!allowed) return;
    const accessToken = await token();
    if (!accessToken) return;
    const userIds = activityUsers.map((user) => user.user_id).filter(Boolean).join(",");
    const params = new URLSearchParams({ mode: "presence" });
    if (userIds) params.set("user_ids", userIds);
    const response = await fetch(`/api/admin/activity?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return;
    const presenceByUser = payload.users_presence || {};
    setOnlineUsers(payload.online_users || []);
    setUsers((current) => current.map((user) => ({
      ...user,
      ...(user.user_id && presenceByUser[user.user_id]
        ? presenceByUser[user.user_id]
        : { status: "offline", login_time: null, logout_time: null, last_seen_at: null, browser: null, device_type: null }),
    })));
  }, [allowed, users]);

  const loadActivity = useCallback(async (nextPage = page, overrideFilters = filters) => {
    setLoading(true);
    setMessage("");
    try {
      const accessToken = await token();
      if (!accessToken) throw new Error("Your session expired. Please log in again.");
      const params = new URLSearchParams({ page: String(nextPage), page_size: String(PAGE_SIZE) });
      Object.entries(overrideFilters).forEach(([key, value]) => { if (value) params.set(key, value); });
      const response = await fetch(`/api/admin/activity?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load system activity.");
      setUsers(payload.users || []);
      setOnlineUsers(payload.online_users || []);
      setSelectedSummary(payload.selected_summary || payload.today_summary || EMPTY_SUMMARY);
      setTotalUsers(payload.total_users || 0);
      setHasMore(Boolean(payload.has_more));
      setPage(nextPage);
      setExpandedUsers({});
      setExpandedActivities({});
    } catch (error: any) {
      setMessage(error.message || "Could not load system activity.");
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    if (!accessLoading && allowed) loadActivity(1, filters);
  }, [accessLoading, allowed]);

  useEffect(() => {
    if (!allowed) return;
    const interval = window.setInterval(() => {
      loadPresenceOnly();
    }, PRESENCE_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [allowed, loadPresenceOnly]);

  function updateFilter(patch: Partial<typeof filters>) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  function clearFilters() {
    const blank = { date_from: "", date_to: "", user: "" };
    setFilters(blank);
    setPage(1);
    window.setTimeout(() => loadActivity(1, blank), 0);
  }

  if (accessLoading) return <p className="p-8 text-sm text-slate-500">Loading system activity...</p>;
  if (!allowed) {
    return <section className="p-8"><div className="rounded-lg border bg-white p-6 text-sm text-slate-600"><h1 className="text-xl font-semibold text-slate-950">Access Denied</h1><p className="mt-2">Only Platform Owner and Super Admin can view System Activity.</p></div></section>;
  }

  return (
    <section className="space-y-5 p-6 text-slate-950 md:p-8">
      <div>
        <h1 className="text-3xl font-bold">System Activity</h1>
        <p className="mt-1 text-sm text-slate-500">Review live ERP sessions and user activity.</p>
      </div>

      {message && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{message}</div>}

      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Currently Online</h2>
          <p className="text-xs text-slate-500">Refreshes automatically.</p>
        </div>
        {onlineUsers.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {onlineUsers.map((onlineUser) => (
              <div key={`${onlineUser.user_id}-${onlineUser.login_time || onlineUser.last_seen_at}`} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-start gap-3">
                  <span className="mt-1 h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-950">{onlineUser.user_name || "Unknown User"}</p>
                    <p className="truncate text-xs text-slate-500">{onlineUser.user_email || "—"}</p>
                    <div className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
                      <span>Logged in: <strong className="font-semibold text-slate-800">{formatTime(onlineUser.login_time)}</strong></span>
                      <span>Last seen: <strong className="font-semibold text-slate-800">{formatTime(onlineUser.last_seen_at)}</strong></span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{deviceLabel(onlineUser)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-md bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">No users currently online.</p>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Selected Period Summary</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          <SummaryTile label="Activities" value={selectedSummary.activities} />
          <SummaryTile label="Created" value={selectedSummary.created} />
          <SummaryTile label="Edited" value={selectedSummary.edited} />
          <SummaryTile label="Approved" value={selectedSummary.approved} />
          <SummaryTile label="Rejected" value={selectedSummary.rejected} />
          <SummaryTile label="Deleted" value={selectedSummary.deleted} />
          <SummaryTile label="Suspended" value={selectedSummary.suspended} />
          <SummaryTile label="Sent Back" value={selectedSummary.sent_back} />
        </div>
      </div>

      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Date From<input type="date" value={filters.date_from} onChange={(e) => updateFilter({ date_from: e.target.value })} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950" /></label>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Date To<input type="date" value={filters.date_to} onChange={(e) => updateFilter({ date_to: e.target.value })} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950" /></label>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">User<input value={filters.user} onChange={(e) => updateFilter({ user: e.target.value })} placeholder="Name or email" className="mt-1 h-10 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950 placeholder:text-slate-400" /></label>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-500">One row per user. Showing {users.length} users.</p>
          <div className="flex gap-2"><button type="button" onClick={clearFilters} className="h-10 rounded-lg border px-4 text-sm font-semibold">Clear Filters</button><button type="button" onClick={() => loadActivity(1)} disabled={loading} className="h-10 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60">{loading ? "Loading..." : "Apply Filters"}</button></div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr>{["User Name", "Email", "Status", "Login Time", "Logout Time", "Last Seen", "Activities", "Last Activity", "Last Activity Date", "Details"].map((heading) => <th key={heading} className="px-3 py-3 font-bold">{heading}</th>)}</tr></thead>
          <tbody className="divide-y">
            {users.map((user) => {
              const key = user.user_id || user.user_email || user.user_name;
              const open = Boolean(expandedUsers[key]);
              return (
                <>
                  <tr key={key} className="hover:bg-slate-50">
                    <td className="px-3 py-3 font-semibold text-slate-950">{user.user_name || "Unknown User"}</td>
                    <td className="px-3 py-3 text-slate-600">{user.user_email || "—"}</td>
                    <td className="px-3 py-3"><PresenceStatus status={user.status} /></td>
                    <td className="px-3 py-3 text-slate-600">{formatDateTime(user.login_time)}</td>
                    <td className="px-3 py-3 text-slate-600">{user.status === "online" ? "—" : formatDateTime(user.logout_time)}</td>
                    <td className="px-3 py-3 text-slate-600">{formatDateTime(user.last_seen_at)}</td>
                    <td className="px-3 py-3 font-semibold">
                      {Number(user.total_activities || 0) === 0 ? (
                        <span className="inline-flex items-center gap-2">
                          <span>0</span>
                          <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600">New Session</span>
                        </span>
                      ) : user.total_activities}
                    </td>
                    <td className="px-3 py-3 text-slate-700">{Number(user.total_activities || 0) === 0 ? "No activity yet" : user.last_activity_description || "—"}</td>
                    <td className="px-3 py-3 text-slate-700">{Number(user.total_activities || 0) === 0 ? "—" : formatDateTime(user.last_activity_at)}</td>
                    <td className="px-3 py-3"><button type="button" onClick={() => setExpandedUsers((current) => ({ ...current, [key]: !current[key] }))} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold">{open ? "Hide" : "Expand"} {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button></td>
                  </tr>
                  {open && <tr key={`${key}-details`}><td colSpan={10} className="bg-slate-50 p-3"><ActivityTable activities={user.activities || []} expanded={expandedActivities} setExpanded={setExpandedActivities} /></td></tr>}
                </>
              );
            })}
            {!users.length && <tr><td colSpan={10} className="px-3 py-10 text-center text-slate-500">{loading ? "Loading activity..." : "No users matched the selected activity filters."}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between"><button type="button" onClick={() => loadActivity(Math.max(1, page - 1))} disabled={loading || page <= 1} className="inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-sm font-semibold disabled:opacity-50"><ChevronLeft className="h-4 w-4" /> Previous</button><p className="text-sm text-slate-500">Page {page}</p><button type="button" onClick={() => loadActivity(page + 1)} disabled={loading || !hasMore} className="inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-sm font-semibold disabled:opacity-50">Next <ChevronRight className="h-4 w-4" /></button></div>
    </section>
  );
}

function ActivityTable({ activities, expanded, setExpanded }: { activities: any[]; expanded: Record<string, boolean>; setExpanded: Dispatch<SetStateAction<Record<string, boolean>>> }) {
  return (
    <div className="overflow-x-auto rounded-md border bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-white text-left text-xs uppercase tracking-wide text-slate-500"><tr>{["Date", "Time", "Module", "Activity", "Record", "Stage", "Reason", "Description", "Details"].map((heading) => <th key={heading} className="px-3 py-2 font-bold">{heading}</th>)}</tr></thead>
        <tbody className="divide-y">
          {activities.map((activity) => {
            const open = Boolean(expanded[activity.id]);
            return (
              <>
                <tr key={activity.id}>
                  <td className="px-3 py-2">{formatDate(activity.created_at)}</td>
                  <td className="px-3 py-2">{formatTime(activity.created_at)}</td>
                  <td className="px-3 py-2">{titleize(activity.module)}</td>
                  <td className="px-3 py-2"><span className={`inline-flex rounded-full border px-1.5 py-[1px] text-xs font-semibold leading-5 ${activityBadgeClass(activity)}`}>{activityLabel(activity)}</span></td>
                  <td className="px-3 py-2"><RecordCell activity={activity} /></td>
                  <td className="px-3 py-2">{displayDash(activity.stage)}</td>
                  <td className="px-3 py-2 text-slate-700">{displayDash(activity.reason)}</td>
                  <td className="px-3 py-2 text-slate-700">{activity.description || "—"}</td>
                  <td className="px-3 py-2"><button type="button" onClick={() => setExpanded((current) => ({ ...current, [activity.id]: !current[activity.id] }))} className="rounded-md border px-2 py-1 text-xs font-semibold">{open ? "Hide" : "View"}</button></td>
                </tr>
                {open && <tr key={`${activity.id}-expanded`}><td colSpan={9} className="bg-slate-50 p-3"><div className="space-y-3"><ChangeList changes={activity.changes || []} /><details className="rounded-md border bg-white p-3"><summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-slate-500">Technical Details</summary><dl className="mt-3 grid gap-2 text-sm md:grid-cols-3"><div><dt className="font-semibold text-slate-500">Source</dt><dd>{activity.technical?.source_table || "—"}</dd></div><div><dt className="font-semibold text-slate-500">Entity</dt><dd>{activity.technical?.entity_type || "—"}</dd></div><div><dt className="font-semibold text-slate-500">Record UUID</dt><dd className="break-all">{activity.technical?.record_id || "—"}</dd></div><div><dt className="font-semibold text-slate-500">Browser</dt><dd>{activity.technical?.browser || "—"}</dd></div><div><dt className="font-semibold text-slate-500">Device</dt><dd>{activity.technical?.device_type || "—"}</dd></div><div><dt className="font-semibold text-slate-500">IP Address</dt><dd>{activity.technical?.ip_address || "—"}</dd></div></dl></details></div></td></tr>}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
