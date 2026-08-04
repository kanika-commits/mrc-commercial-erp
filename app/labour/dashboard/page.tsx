"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function LabourSiteDashboardPage() {
  const [lookups, setLookups] = useState<any>({ companies: [], sites: [] });
  const [filters, setFilters] = useState({ company_id: "", site_id: "", date: today() });
  const [data, setData] = useState<any>(null);
  const [message, setMessage] = useState("");
  const sites = useMemo(() => lookups.sites || [], [lookups.sites]);
  async function token() { const { data: { session } } = await supabase.auth.getSession(); return session?.access_token || ""; }
  async function loadLookups() {
    const response = await fetch("/api/labour/lookups", { headers: { Authorization: `Bearer ${await token()}` } });
    const payload = await response.json();
    if (response.ok) setLookups(payload);
  }
  async function load() {
    if (!filters.company_id || !filters.site_id || !filters.date) return setMessage("Select company, site and date.");
    setMessage("");
    const response = await fetch(`/api/labour/dashboard?${new URLSearchParams(filters)}`, { headers: { Authorization: `Bearer ${await token()}` } });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.error || "Could not load dashboard.");
    setData(payload);
  }
  useEffect(() => { loadLookups(); }, []);
  const summary = data?.summary || {};
  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-slate-950 md:px-10">
      <div className="mx-auto max-w-[1400px] space-y-5">
        <header><p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Labour Dashboard</p><h1 className="text-3xl font-semibold">Daily Site Manpower</h1></header>
        <div className="grid gap-3 rounded-lg border bg-white p-4 shadow-sm md:grid-cols-4"><select className="h-11 rounded-lg border px-3" value={filters.company_id} onChange={(e) => setFilters({ ...filters, company_id: e.target.value })}><option value="">Company</option>{lookups.companies.map((c: any) => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select><select className="h-11 rounded-lg border px-3" value={filters.site_id} onChange={(e) => setFilters({ ...filters, site_id: e.target.value })}><option value="">Site</option>{sites.map((s: any) => <option key={s.id} value={s.id}>{s.site_name}</option>)}</select><input className="h-11 rounded-lg border px-3" type="date" value={filters.date} onChange={(e) => setFilters({ ...filters, date: e.target.value })} /><button onClick={load} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white"><RefreshCw className="h-4 w-4" /> Load</button></div>
        {message && <div className="rounded-lg border bg-white p-3 text-sm">{message}</div>}
        <div className="grid gap-4 md:grid-cols-4">{[["Total Deployed", summary.total_deployed], ["Present", summary.present], ["Absent", summary.absent], ["Half Day", summary.half_day], ["Contract Basis", summary.contract_basis], ["Daily Wage", summary.daily_wage], ["Productive Logs", summary.productive_work_logs], ["OT Approved", summary.ot_approved], ["Missing Work Logs", summary.missing_work_logs]].map(([label, value]) => <div key={label} className="rounded-lg border bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold">{value ?? "-"}</p></div>)}</div>
        <div className="grid gap-4 md:grid-cols-3">{[["Contractor", data?.contractor_counts], ["Labour Category", data?.category_counts], ["Commercial Model", data?.model_counts]].map(([title, rows]: any) => <div key={title} className="rounded-lg border bg-white p-4 shadow-sm"><h2 className="font-semibold">{title}</h2><div className="mt-3 space-y-2">{(rows || []).map((row: any) => <div key={row.label} className="flex justify-between text-sm"><span>{row.label}</span><b>{row.count}</b></div>)}</div></div>)}</div>
      </div>
    </section>
  );
}
