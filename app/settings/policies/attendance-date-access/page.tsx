"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

function dateLabel(value: string) { return value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN") : "-"; }
function localDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export default function AttendanceDateAccessPage() {
  const [lookups, setLookups] = useState<any>({ companies: [], sites: [] });
  const [records, setRecords] = useState<any[]>([]);
  const [form, setForm] = useState({ attendance_type: "labour", site_id: "", from_date: "", to_date: "", reason: "", expires_at: "" });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const token = async () => (await supabase.auth.getSession()).data.session?.access_token || "";
  const sites = lookups.sites || [];

  async function load() {
    setLoading(true);
    const headers = { Authorization: `Bearer ${await token()}` };
    const [lookupResponse, recordResponse] = await Promise.all([fetch("/api/labour/lookups", { headers }), fetch("/api/labour/attendance/date-access", { headers })]);
    const lookupPayload = await lookupResponse.json(); const recordPayload = await recordResponse.json();
    if (!lookupResponse.ok || !recordResponse.ok) setMessage(lookupPayload.error || recordPayload.error || "Could not load attendance date access.");
    setLookups(lookupPayload); setRecords(recordPayload.records || []); setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function openAccess(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setMessage("");
    const expiry = form.expires_at ? new Date(form.expires_at) : null;
    if (form.expires_at && (!expiry || Number.isNaN(expiry.getTime()) || expiry <= new Date())) {
      setMessage("Access Valid Until must be a valid future date and time."); setSaving(false); return;
    }
    const response = await fetch("/api/labour/attendance/date-access", { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ ...form, expires_at: expiry ? expiry.toISOString() : null }) });
    const payload = await response.json();
    setMessage(response.ok ? "Historical attendance access opened successfully." : payload.error || "Could not open access.");
    if (response.ok) { setForm({ attendance_type: "labour", site_id: "", from_date: "", to_date: "", reason: "", expires_at: "" }); await load(); }
    setSaving(false);
  }

  async function closeAccess(id: string) {
    const closeReason = window.prompt("Optional close reason") || "";
    const response = await fetch("/api/labour/attendance/date-access", { method: "PATCH", headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ id, close_reason: closeReason }) });
    const payload = await response.json(); setMessage(response.ok ? "Historical attendance access closed." : payload.error || "Could not close access."); if (response.ok) await load();
  }

  const now = new Date();
  const isExpired = (row: any) => row.status === "open" && row.expires_at && new Date(row.expires_at) <= now;
  const activeRecords = records
    .filter((row) => row.status === "open" && !row.closed_at && !isExpired(row))
    .sort((left, right) => String(right.opened_at || "").localeCompare(String(left.opened_at || "")));
  const historyRecords = records
    .filter((row) => row.status === "closed" || Boolean(isExpired(row)))
    .sort((left, right) => String(right.opened_at || "").localeCompare(String(left.opened_at || "")));
  const typeLabel = (row: any) => row.attendance_type === "employee" ? "Employee Attendance" : "Labour Attendance";
  const siteLabel = (row: any) => lookups.sites?.find((site: any) => site.id === row.site_id)?.site_name || row.site_id;
  const statusBadge = (label: string) => {
    const styles = label === "Open"
      ? "border-green-200 bg-green-50 text-green-800"
      : label === "Expired"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-slate-200 bg-slate-100 text-slate-700";
    return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${styles}`}>{label}</span>;
  };
  const tableHeader = (includeAction: boolean) => ["Type", "Site", "From", "To", "Reason", "Opened By", "Opened At", "Valid Until", "Status", ...(includeAction ? ["Action"] : ["Closed By / Closed At"])];
  const table = (rows: any[], history: boolean) => (
    <div className="overflow-x-auto">
      <table className="min-w-[1100px] w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>{tableHeader(!history).map((label) => <th key={label} className="p-3">{label}</th>)}</tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => {
            const expired = Boolean(isExpired(row));
            const status = expired ? "Expired" : row.status === "closed" ? "Closed" : "Open";
            return (
              <tr key={row.id}>
                <td className="p-3">{typeLabel(row)}</td>
                <td className="p-3">{siteLabel(row)}</td>
                <td className="p-3">{dateLabel(row.from_date)}</td>
                <td className="p-3">{dateLabel(row.to_date)}</td>
                <td className="max-w-xs whitespace-normal p-3">{row.reason}</td>
                <td className="p-3">{row.opened_by_name || "-"}</td>
                <td className="p-3">{row.opened_at ? new Date(row.opened_at).toLocaleString("en-IN") : "-"}</td>
                <td className="p-3">{row.expires_at ? new Date(row.expires_at).toLocaleString("en-IN") : "No expiry"}</td>
                <td className="p-3">{statusBadge(status)}</td>
                <td className="p-3">
                  {history ? `${row.closed_by_name || "-"} / ${row.closed_at ? new Date(row.closed_at).toLocaleString("en-IN") : "-"}` : <button type="button" onClick={() => void closeAccess(row.id)} className="rounded border px-3 py-1.5 text-xs font-semibold">Close Access</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return <section className="space-y-6"><header><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Settings / Policies</p><h1 className="mt-1 text-3xl font-bold text-slate-950">Attendance Date Access</h1><p className="mt-1 text-sm text-slate-500">Open old Labour or Employee Attendance dates for authorized entry users without changing workflow status.</p></header>{message && <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-slate-900">{message}</div>}<form onSubmit={openAccess} className="rounded-xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">Open Attendance Dates</h2><div className="mt-4 grid gap-4 md:grid-cols-2"><label className="text-sm font-semibold">Attendance Type *<select required value={form.attendance_type} onChange={e => setForm({ ...form, attendance_type: e.target.value })} className="mt-1 h-10 w-full rounded border px-3"><option value="labour">Labour Attendance</option><option value="employee">Employee Attendance</option></select></label><label className="text-sm font-semibold">Site *<select required value={form.site_id} onChange={e => setForm({ ...form, site_id: e.target.value })} className="mt-1 h-10 w-full rounded border px-3"><option value="">Select site</option>{sites.map((x: any) => <option key={x.id} value={x.id}>{x.site_name}</option>)}</select></label><label className="text-sm font-semibold">From Date *<input required type="date" value={form.from_date} onChange={e => setForm({ ...form, from_date: e.target.value })} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="text-sm font-semibold">To Date *<input required type="date" value={form.to_date} onChange={e => setForm({ ...form, to_date: e.target.value })} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="text-sm font-semibold">Access Valid Until (Optional)<input type="datetime-local" min={localDateTimeValue()} value={form.expires_at} onChange={e => setForm({ ...form, expires_at: e.target.value })} className="mt-1 h-10 w-full rounded border px-3" /><span className="mt-1 block text-xs font-normal text-slate-500">After this time, these historical dates will automatically return to normal attendance restrictions.</span></label><label className="text-sm font-semibold md:col-span-2">Reason *<textarea required minLength={10} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} className="mt-1 min-h-24 w-full rounded border p-3 font-normal" /></label></div><button disabled={saving} className="mt-4 rounded bg-slate-950 px-4 py-2 text-sm font-semibold text-white">{saving ? "Opening..." : "Open Access"}</button></form><section className="rounded-xl border bg-white shadow-sm"><div className="border-b p-4"><h2 className="font-semibold">Active Access</h2></div>{loading ? <p className="p-5 text-sm text-slate-500">Loading...</p> : activeRecords.length ? table(activeRecords, false) : <p className="p-5 text-sm text-slate-500">No active historical attendance access.</p>}</section><section className="rounded-xl border bg-white shadow-sm"><div className="border-b p-4"><h2 className="font-semibold">Access History</h2></div>{loading ? <p className="p-5 text-sm text-slate-500">Loading...</p> : historyRecords.length ? table(historyRecords, true) : <p className="p-5 text-sm text-slate-500">No closed or expired historical attendance access.</p>}</section></section>;
}
