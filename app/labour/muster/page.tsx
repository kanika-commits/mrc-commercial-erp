"use client";

import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { useAccessContext } from "@/components/AccessContext";
import { labelFromCode } from "@/lib/labour/constants";

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export default function LabourMusterPage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const canExport = hasGlobalAccess(access) || can(permissions, "labour_attendance", "export");
  const [lookups, setLookups] = useState<any>({ companies: [], sites: [], company_site_pairs: [], contractors: [], trades: [] });
  const [filters, setFilters] = useState({ company_id: "", site_id: "", contractor_profile_id: "", trade_id: "", month: currentMonth() });
  const [rows, setRows] = useState<any[]>([]);
  const [dayCount, setDayCount] = useState(31);
  const [period, setPeriod] = useState<any>(null);
  const [message, setMessage] = useState("");
  const filteredSites = useMemo(() => lookups.sites || [], [lookups.sites]);

  async function token() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  }

  async function loadLookups() {
    const response = await fetch(`/api/labour/lookups?purpose=labour_attendance&attendance_date=${filters.month}-01`, { headers: { Authorization: `Bearer ${await token()}` } });
    const payload = await response.json();
    if (response.ok) setLookups(payload);
  }

  async function loadMuster() {
    if (!filters.company_id || !filters.site_id) return;
    const params = new URLSearchParams(filters as any);
    const response = await fetch(`/api/labour/attendance/monthly?${params}`, { headers: { Authorization: `Bearer ${await token()}` } });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.error || "Could not load muster.");
    setRows(payload.rows || []);
    setDayCount(payload.day_count || 31);
    setPeriod(payload.period || null);
  }

  async function exportCsv() {
    const params = new URLSearchParams(filters as any);
    const response = await fetch(`/api/labour/muster/export?${params}`, { headers: { Authorization: `Bearer ${await token()}` } });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "labour-muster.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => { loadLookups(); }, [filters.month]);

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-slate-950 md:px-10">
      <div className="mx-auto max-w-[1600px] space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Labour Attendance</p>
            <h1 className="text-3xl font-semibold">Muster Roll</h1>
            <p className="text-sm text-slate-600">Monthly day-wise labour attendance derived from saved attendance records.</p>
          </div>
          {canExport && <button onClick={exportCsv} className="inline-flex h-11 items-center gap-2 rounded-lg border bg-white px-4 text-sm font-semibold"><Download className="h-4 w-4" /> Export CSV</button>}
        </header>
        {message && <div className="rounded-lg border bg-white p-3 text-sm">{message}</div>}
        <div className="grid gap-3 rounded-lg border bg-white p-4 shadow-sm md:grid-cols-6">
          <select value={filters.company_id} onChange={(e) => setFilters({ ...filters, company_id: e.target.value })} className="h-11 rounded-lg border px-3"><option value="">Company</option>{lookups.companies.map((c: any) => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select>
          <select value={filters.site_id} onChange={(e) => setFilters({ ...filters, site_id: e.target.value })} className="h-11 rounded-lg border px-3"><option value="">Site</option>{filteredSites.map((s: any) => <option key={s.id} value={s.id}>{s.site_name}</option>)}</select>
          <select value={filters.contractor_profile_id} onChange={(e) => setFilters({ ...filters, contractor_profile_id: e.target.value })} className="h-11 rounded-lg border px-3"><option value="">All Contractors</option>{lookups.contractors.map((c: any) => <option key={c.id} value={c.id}>{c.vendors?.vendor_name || c.contractor_code}</option>)}</select>
          <input type="month" value={filters.month} onChange={(e) => setFilters({ ...filters, month: e.target.value })} className="h-11 rounded-lg border px-3" />
          <select value={filters.trade_id} onChange={(e) => setFilters({ ...filters, trade_id: e.target.value })} className="h-11 rounded-lg border px-3"><option value="">All Labour Categories</option>{lookups.trades.map((t: any) => <option key={t.id} value={t.id}>{t.trade_name}</option>)}</select>
          <button onClick={loadMuster} className="h-11 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white">Load</button>
        </div>
        <div className="rounded-lg border bg-white p-4 text-sm shadow-sm">Period status: <b>{period?.status || "draft"}</b>. Codes: P, A, HD, WO, H, L, ND.</div>
        <div className="overflow-auto rounded-lg border bg-white shadow-sm">
          <table className="min-w-max text-xs">
            <thead className="bg-slate-50 text-left uppercase text-slate-500">
              <tr>
                {["Labour Code", "Worker Name", "Father/Husband", "Labour Category", "Skill", "Payment Model", "Work Order", "Wage", ...Array.from({ length: dayCount }, (_, i) => String(i + 1)), "Present", "Half", "Absent", "WO", "Holiday", "Leave", "OT Hrs", "Payable", "Missing", "Recorded"].map((h) => <th key={h} className="whitespace-nowrap px-2 py-3">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.labour_worker_id}>
                  <td className="px-2 py-2 font-semibold">{row.worker?.labour_code}</td>
                  <td className="px-2 py-2">{row.worker?.worker_name}</td>
                  <td className="px-2 py-2">{row.worker?.father_or_husband_name || "-"}</td>
                  <td className="px-2 py-2">{row.trade?.trade_name || "-"}</td>
                  <td className="px-2 py-2">{labelFromCode(row.skill_level)}</td>
                  <td className="px-2 py-2">{labelFromCode(row.commercial_model)}</td>
                  <td className="px-2 py-2">{row.assignment_label || row.work_order?.wo_number || row.manpower_work_order?.manpower_wo_number || "-"}</td>
                  <td className="px-2 py-2">{labelFromCode(row.wage_type)} {row.wage_rate || ""}</td>
                  {Array.from({ length: dayCount }, (_, i) => <td key={i} className="px-2 py-2 text-center">{row.days[String(i + 1)] || "-"}</td>)}
                  <td className="px-2 py-2">{row.totals.present}</td>
                  <td className="px-2 py-2">{row.totals.half_day}</td>
                  <td className="px-2 py-2">{row.totals.absent}</td>
                  <td className="px-2 py-2">{row.totals.weekly_off}</td>
                  <td className="px-2 py-2">{row.totals.holiday}</td>
                  <td className="px-2 py-2">{row.totals.leave}</td>
                  <td className="px-2 py-2">{Math.round((row.totals.overtime_minutes / 60) * 100) / 100}</td>
                  <td className="px-2 py-2">{row.totals.payable_days}</td>
                  <td className="px-2 py-2">{row.totals.missing}</td>
                  <td className="px-2 py-2">{row.totals.total_recorded}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={dayCount + 18} className="px-3 py-8 text-center text-slate-500">Select filters and load the muster roll.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
