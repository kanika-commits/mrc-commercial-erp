"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccessContext } from "@/components/AccessContext";
import { REPORT_AREAS, REPORT_REGISTRY } from "@/lib/reports/reportRegistry";

type Change = { field: string; before: string; after: string };
type Row = { id: string; at: string; labour_id: string; labour_name: string; event: string; summary: string; site: string; company: string; performed_by: string; reason: string; changes: Change[] };
const eventOptions = ["create", "update", "employment_change", "salary_revision", "transfer", "activate", "deactivate"];

export default function ReportsPage() {
  const { access, loading } = useAccessContext();
  const [area, setArea] = useState("hr_labour");
  const [subject, setSubject] = useState("labour");
  const [reportType, setReportType] = useState("audit_trail");
  const [organizationId, setOrganizationId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [siteId, setSiteId] = useState("");
  const [event, setEvent] = useState("");
  const [search, setSearch] = useState("");
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [available, setAvailable] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [generated, setGenerated] = useState(false);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const organizations = access?.organizations || [];
  const definition = REPORT_REGISTRY[0];

  const query = useMemo(() => {
    const params = new URLSearchParams({ organization_id: organizationId, page: String(page) });
    if (from) params.set("date_from", from); if (to) params.set("date_to", to); if (siteId) params.set("site_id", siteId); if (event) params.set("event", event); if (search) params.set("search", search);
    return params;
  }, [organizationId, from, to, siteId, event, search, page]);

  useEffect(() => { if (access?.organizations?.length === 1) setOrganizationId(access.organizations[0]); }, [access]);
  useEffect(() => {
    if (!organizationId) { setAvailable(false); setSites([]); return; }
    fetch(`/api/reports/labour-audit?organization_id=${encodeURIComponent(organizationId)}&metadata=true`)
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => { setAvailable(payload?.report_available === true); setSites((payload?.sites || []).map((site: any) => ({ id: site.id, name: site.site_name || site.name }))); });
  }, [organizationId]);

  async function generateReport(nextPage = 1) {
    if (!organizationId) return;
    setBusy(true); setError(""); setPage(nextPage);
    const params = new URLSearchParams(query); params.set("page", String(nextPage));
    try { const response = await fetch(`/api/reports/labour-audit?${params.toString()}`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Unable to generate report."); setRows(payload.rows || []); setGenerated(true); }
    catch (loadError: any) { setError(loadError.message || "Unable to generate report."); }
    finally { setBusy(false); }
  }

  function exportReport(format: "pdf" | "excel") { const params = new URLSearchParams(query); params.set("format", format); window.location.href = `/api/reports/labour-audit?${params.toString()}`; }

  if (loading) return <p className="text-sm text-slate-500">Loading Reports...</p>;
  if (!access) return <p className="text-sm text-slate-500">Reports access is unavailable.</p>;

  if (!available && organizationId) return <section className="space-y-5"><header><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reports</p><h1 className="mt-2 text-2xl font-semibold">Report Centre</h1></header><p className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">No authorized reports are available for this organization.</p></section>;
  return <section className="space-y-5">
    <header><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reports</p><h1 className="mt-2 text-2xl font-semibold">Report Centre</h1><p className="mt-1 text-sm text-slate-500">Generate operational and audit reports within your authorized scope.</p></header>
    <div className="grid gap-3 rounded-xl border bg-white p-4 shadow-sm md:grid-cols-3">
      <label className="text-sm">Area / Module<select value={area} onChange={(e) => setArea(e.target.value)} className="mt-1 w-full rounded border p-2">{REPORT_AREAS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      <label className="text-sm">Report For<select value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 w-full rounded border p-2"><option value="labour">Labour</option></select></label>
      <label className="text-sm">Report Type<select value={reportType} onChange={(e) => setReportType(e.target.value)} className="mt-1 w-full rounded border p-2"><option value="audit_trail">Audit Trail</option></select></label>
      {organizations.length > 1 && <label className="text-sm">Organization<select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} className="mt-1 w-full rounded border p-2"><option value="">Select organization</option>{organizations.map((id) => <option key={id} value={id}>{id}</option>)}</select></label>}
    </div>
    <div className="rounded-xl border bg-white p-4 shadow-sm"><h2 className="text-base font-semibold">Filters</h2><div className="mt-3 grid gap-3 md:grid-cols-3"><label className="text-sm">Date From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full rounded border p-2" /></label><label className="text-sm">Date To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full rounded border p-2" /></label><label className="text-sm">Site<select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="mt-1 w-full rounded border p-2"><option value="">All Sites</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label><label className="text-sm">Event Type<select value={event} onChange={(e) => setEvent(e.target.value)} className="mt-1 w-full rounded border p-2"><option value="">All Events</option>{eventOptions.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></label><label className="text-sm">Labour / Performed By<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ID or actor" className="mt-1 w-full rounded border p-2" /></label></div><button type="button" onClick={() => generateReport(1)} disabled={!organizationId || busy} className="mt-4 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Generating..." : "Generate Report"}</button></div>
    {error && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {generated && <section className="space-y-3"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">Labour Audit Report</h2><p className="text-sm text-slate-500">{from || "All dates"} to {to || "today"} · {siteId ? "Selected site" : "All Sites"}</p></div><div className="flex gap-2"><button type="button" onClick={() => exportReport("pdf")} className="rounded border px-3 py-2 text-sm">Download PDF</button><button type="button" onClick={() => exportReport("excel")} className="rounded border px-3 py-2 text-sm">Export Excel</button></div></div><div className="overflow-x-auto rounded-xl border bg-white shadow-sm"><table className="min-w-full text-left text-sm"><thead className="border-b bg-slate-50"><tr>{["Date & Time", "Labour", "Event", "Change Summary", "Site", "Performed By", ""].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b last:border-0"><td className="whitespace-nowrap px-3 py-2">{new Date(row.at).toLocaleString()}</td><td className="px-3 py-2">{row.labour_name}<span className="block text-xs text-slate-500">{row.labour_id}</span></td><td className="px-3 py-2">{row.event}</td><td className="max-w-md px-3 py-2">{row.summary}</td><td className="px-3 py-2">{row.site}</td><td className="px-3 py-2">{row.performed_by}</td><td className="px-3 py-2"><button type="button" onClick={() => setSelected(row)} className="underline">Details</button></td></tr>)}</tbody></table>{!rows.length && <p className="p-6 text-sm text-slate-500">No audit events match these filters.</p>}</div><div className="flex items-center justify-between text-sm"><button type="button" onClick={() => generateReport(page - 1)} disabled={page <= 1 || busy} className="rounded border px-3 py-2 disabled:opacity-50">Previous</button><span>Page {page}</span><button type="button" onClick={() => generateReport(page + 1)} disabled={rows.length < 50 || busy} className="rounded border px-3 py-2 disabled:opacity-50">Next</button></div></section>}
    {selected && <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setSelected(null)}><div className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}><div className="flex items-start justify-between"><div><h2 className="text-lg font-semibold">Audit details</h2><p className="text-sm text-slate-500">{selected.labour_name} · {selected.event}</p></div><button type="button" onClick={() => setSelected(null)} aria-label="Close">Close</button></div><dl className="mt-4 space-y-2 text-sm"><div><dt className="font-medium">Reason</dt><dd>{selected.reason}</dd></div><div><dt className="font-medium">Performed by</dt><dd>{selected.performed_by}</dd></div></dl><table className="mt-4 min-w-full text-left text-sm"><thead><tr><th className="py-2">Field</th><th className="py-2">Previous</th><th className="py-2">New</th></tr></thead><tbody>{selected.changes.map((change) => <tr key={change.field} className="border-t"><td className="py-2">{change.field}</td><td className="py-2">{change.before}</td><td className="py-2">{change.after}</td></tr>)}</tbody></table></div></div>}
  </section>;
}
