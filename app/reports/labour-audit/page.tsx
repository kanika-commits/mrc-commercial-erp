"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccessContext } from "@/components/AccessContext";

type Change = { field: string; before: string; after: string };
type Row = { id: string; at: string; labour_id: string; labour_name: string; event: string; summary: string; site: string; company: string; performed_by: string; reason: string; changes: Change[] };

const events = ["", "create", "update", "employment_change", "salary_revision", "transfer", "activate", "deactivate"];

export default function LabourAuditReportPage() {
  const { access, loading } = useAccessContext();
  const [rows, setRows] = useState<Row[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [event, setEvent] = useState("");
  const [search, setSearch] = useState("");
  const [siteId, setSiteId] = useState("");
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const organizations = access?.organizations || [];
  const query = useMemo(() => {
    const params = new URLSearchParams({ organization_id: organizationId });
    if (from) params.set("date_from", from);
    if (to) params.set("date_to", to);
    if (event) params.set("event", event);
    if (search) params.set("search", search);
    if (siteId) params.set("site_id", siteId);
    return params;
  }, [organizationId, from, to, event, search, siteId]);

  async function loadReport() {
    if (!organizationId) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/reports/labour-audit?${query.toString()}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load the report.");
      setRows(payload.rows || []);
    } catch (loadError: any) { setError(loadError.message || "Unable to load the report."); }
    finally { setBusy(false); }
  }

  async function loadSites() {
    if (!organizationId) return;
    const response = await fetch(`/api/reports/labour-audit?organization_id=${encodeURIComponent(organizationId)}&metadata=true`);
    if (!response.ok) return;
    const payload = await response.json();
    setSites((payload.sites || []).map((site: any) => ({ id: site.id, name: site.site_name || site.name })));
  }

  useEffect(() => { if (access?.organizations?.length === 1) setOrganizationId(access.organizations[0]); }, [access]);
  useEffect(() => { loadSites(); loadReport(); }, [organizationId]);

  function exportReport(format: "excel" | "pdf") { window.location.href = `/api/reports/labour-audit?${query.toString()}&format=${format}`; }

  if (loading) return <p className="text-sm text-slate-500">Loading Labour Audit Report...</p>;
  if (!access) return <p className="text-sm text-slate-500">Reports access is unavailable.</p>;

  return <section className="space-y-5">
    <header><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reports</p><h1 className="mt-2 text-2xl font-semibold">Labour Audit Report</h1><p className="mt-1 text-sm text-slate-500">Recorded labour-master and assignment changes, with historical values from the audit log.</p></header>
    <div className="grid gap-3 rounded-xl border bg-white p-4 shadow-sm md:grid-cols-3">
      {organizations.length > 1 && <label className="text-sm">Organization<select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} className="mt-1 w-full rounded border p-2"><option value="">Select organization</option>{organizations.map((id) => <option key={id} value={id}>{id}</option>)}</select></label>}
      <label className="text-sm">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
      <label className="text-sm">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
      <label className="text-sm">Event<select value={event} onChange={(e) => setEvent(e.target.value)} className="mt-1 w-full rounded border p-2"><option value="">All events</option>{events.slice(1).map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
      <label className="text-sm">Site<select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="mt-1 w-full rounded border p-2"><option value="">All sites</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
      <label className="text-sm">Search<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Labour ID or actor" className="mt-1 w-full rounded border p-2" /></label>
      <div className="flex items-end gap-2 md:col-span-3"><button type="button" onClick={loadReport} disabled={!organizationId || busy} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Loading..." : "Apply filters"}</button><button type="button" onClick={() => exportReport("excel")} disabled={!organizationId} className="rounded border px-4 py-2 text-sm disabled:opacity-50">Excel</button><button type="button" onClick={() => exportReport("pdf")} disabled={!organizationId} className="rounded border px-4 py-2 text-sm disabled:opacity-50">PDF</button></div>
    </div>
    {error && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="overflow-x-auto rounded-xl border bg-white shadow-sm"><table className="min-w-full text-left text-sm"><thead className="border-b bg-slate-50"><tr>{["Date", "Labour", "Event", "Summary", "Company", "Site", "Performed by", ""].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b last:border-0"><td className="whitespace-nowrap px-3 py-2">{new Date(row.at).toLocaleString()}</td><td className="px-3 py-2">{row.labour_name}<span className="block text-xs text-slate-500">{row.labour_id}</span></td><td className="px-3 py-2">{row.event}</td><td className="max-w-md px-3 py-2">{row.summary}</td><td className="px-3 py-2">{row.company}</td><td className="px-3 py-2">{row.site}</td><td className="px-3 py-2">{row.performed_by}</td><td className="px-3 py-2"><button type="button" onClick={() => setSelected(row)} className="text-slate-700 underline">Details</button></td></tr>)}</tbody></table>{!rows.length && <p className="p-6 text-sm text-slate-500">{organizationId ? "No audit events match these filters." : "Select an organization to view the report."}</p>}</div>
    {selected && <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setSelected(null)}><div className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}><div className="flex items-start justify-between"><div><h2 className="text-lg font-semibold">Audit details</h2><p className="text-sm text-slate-500">{selected.labour_name} · {selected.event}</p></div><button type="button" onClick={() => setSelected(null)} aria-label="Close">Close</button></div><dl className="mt-4 space-y-2 text-sm"><div><dt className="font-medium">Reason</dt><dd>{selected.reason}</dd></div><div><dt className="font-medium">Performed by</dt><dd>{selected.performed_by}</dd></div></dl><table className="mt-4 min-w-full text-left text-sm"><thead><tr><th className="py-2">Field</th><th className="py-2">Previous</th><th className="py-2">New</th></tr></thead><tbody>{selected.changes.map((change) => <tr key={change.field} className="border-t"><td className="py-2">{change.field}</td><td className="py-2">{change.before}</td><td className="py-2">{change.after}</td></tr>)}</tbody></table></div></div>}
  </section>;
}
