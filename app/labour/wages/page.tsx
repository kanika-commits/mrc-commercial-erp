"use client";

import Link from "next/link";
import { Download, Eye, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { useAccessContext } from "@/components/AccessContext";

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export default function LabourWagesPage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const global = hasGlobalAccess(access);
  const canAdd = global || can(permissions, "labour_wages", "add");
  const canExport = global || can(permissions, "labour_wages", "export");
  const [lookups, setLookups] = useState<any>({ companies: [], sites: [], contractors: [] });
  const [filters, setFilters] = useState({ company_id: "", site_id: "", contractor_profile_id: "", month: currentMonth() });
  const [periods, setPeriods] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const filteredSites = useMemo(() => lookups.sites || [], [lookups.sites]);

  async function token() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  }

  async function loadLookups() {
    const response = await fetch("/api/labour/lookups", { headers: { Authorization: `Bearer ${await token()}` } });
    const payload = await response.json();
    if (response.ok) setLookups(payload);
  }

  async function loadPeriods() {
    const params = new URLSearchParams();
    if (filters.company_id) params.set("company_id", filters.company_id);
    if (filters.site_id) params.set("site_id", filters.site_id);
    if (filters.month) params.set("month", filters.month);
    const response = await fetch(`/api/labour/wages?${params}`, { headers: { Authorization: `Bearer ${await token()}` } });
    const payload = await response.json();
    if (response.ok) setPeriods(payload.wage_periods || []);
    else setMessage(payload.error || "Could not load wage periods.");
  }

  async function createPeriod() {
    if (!filters.company_id || !filters.site_id || !filters.month) return setMessage("Company, site and month are required.");
    const response = await fetch("/api/labour/wages", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify(filters),
    });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.error || "Could not create wage period.");
    window.location.href = `/labour/wages/${payload.wage_period_id}`;
  }

  async function exportCsv() {
    const response = await fetch("/api/labour/wages?export=csv", { headers: { Authorization: `Bearer ${await token()}` } });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "labour-wage-register.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => { loadLookups(); loadPeriods(); }, []);

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-slate-950 md:px-10">
      <div className="mx-auto max-w-[1400px] space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Labour Wages</p>
            <h1 className="text-3xl font-semibold">Wage Register</h1>
            <p className="text-sm text-slate-600">Calculate and review labour wages after attendance is finalized.</p>
          </div>
          <div className="flex gap-2">
            {canExport && <button onClick={exportCsv} className="inline-flex h-11 items-center gap-2 rounded-lg border bg-white px-4 text-sm font-semibold"><Download className="h-4 w-4" /> Export CSV</button>}
            {canAdd && <button onClick={createPeriod} className="inline-flex h-11 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> Create Period</button>}
          </div>
        </header>
        {message && <div className="rounded-lg border bg-white p-3 text-sm">{message}</div>}
        <div className="grid gap-3 rounded-lg border bg-white p-4 shadow-sm md:grid-cols-5">
          <select value={filters.company_id} onChange={(e) => setFilters({ ...filters, company_id: e.target.value })} className="h-11 rounded-lg border px-3"><option value="">Company</option>{lookups.companies.map((c: any) => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select>
          <select value={filters.site_id} onChange={(e) => setFilters({ ...filters, site_id: e.target.value })} className="h-11 rounded-lg border px-3"><option value="">Site</option>{filteredSites.map((s: any) => <option key={s.id} value={s.id}>{s.site_name}</option>)}</select>
          <select value={filters.contractor_profile_id} onChange={(e) => setFilters({ ...filters, contractor_profile_id: e.target.value })} className="h-11 rounded-lg border px-3"><option value="">All Contractors</option>{lookups.contractors.map((c: any) => <option key={c.id} value={c.id}>{c.vendors?.vendor_name || c.contractor_code}</option>)}</select>
          <input type="month" value={filters.month} onChange={(e) => setFilters({ ...filters, month: e.target.value })} className="h-11 rounded-lg border px-3" />
          <button onClick={loadPeriods} className="h-11 rounded-lg border bg-white px-4 text-sm font-semibold">Load</button>
        </div>
        <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{["Month", "Company", "Site", "Contractor", "Status", "Workers", "Amount", "Advance", "Net", "Action"].map((h) => <th key={h} className="px-3 py-3">{h}</th>)}</tr></thead>
            <tbody className="divide-y">
              {periods.map((period) => (
                <tr key={period.id}>
                  <td className="px-3 py-3">{period.period_month}</td>
                  <td className="px-3 py-3">{period.companies?.company_name}</td>
                  <td className="px-3 py-3">{period.sites?.site_name}</td>
                  <td className="px-3 py-3">{period.labour_contractor_profiles?.vendors?.vendor_name || "No Contractor"}</td>
                  <td className="px-3 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">{period.status}</span></td>
                  <td className="px-3 py-3">{period.summary?.worker_count || 0}</td>
                  <td className="px-3 py-3">₹ {Number(period.summary?.gross_wages || 0).toLocaleString("en-IN")}</td>
                  <td className="px-3 py-3">₹ {Number(period.summary?.advance_recovery || 0).toLocaleString("en-IN")}</td>
                  <td className="px-3 py-3">₹ {Number(period.summary?.net_wages || 0).toLocaleString("en-IN")}</td>
                  <td className="px-3 py-3"><Link href={`/labour/wages/${period.id}`} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5"><Eye className="h-4 w-4" /> View</Link></td>
                </tr>
              ))}
              {!periods.length && <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-500">No wage periods found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
