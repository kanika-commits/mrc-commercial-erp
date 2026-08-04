"use client";

import { Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function NewManpowerWorkOrderPage() {
  const router = useRouter();
  const [lookups, setLookups] = useState<any>({ companies: [], sites: [], contractors: [], work_orders: [] });
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<any>({ engagement_type: "daily_wage", overtime_basis: "category_rate", contractor_profit_type: "none", status: "draft" });
  const workOrders = useMemo(() => lookups.work_orders.filter((wo: any) => (!form.company_id || wo.company_id === form.company_id) && (!form.site_id || wo.site_id === form.site_id)), [lookups.work_orders, form.company_id, form.site_id]);
  async function token() { const { data: { session } } = await supabase.auth.getSession(); return session?.access_token || ""; }
  useEffect(() => { (async () => {
    const response = await fetch("/api/labour/lookups?purpose=manpower_work_order", { headers: { Authorization: `Bearer ${await token()}` } });
    const payload = await response.json();
    if (response.ok) setLookups(payload); else setMessage(payload.error || "Could not load Manpower Work Order lookups.");
  })(); }, []);
  async function save() {
    setMessage("");
    const response = await fetch("/api/labour/manpower-work-orders", { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify(form) });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.error || "Could not save Manpower Work Order.");
    router.push(`/labour/manpower-work-orders/${payload.manpower_work_order_id}`);
  }
  const field = "mt-1 h-11 w-full rounded-lg border px-3";
  const labelClass = "text-xs font-bold uppercase tracking-wide text-slate-500";
  const helpClass = "mt-1 text-xs text-slate-500";
  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-slate-950 md:px-10">
      <div className="mx-auto max-w-[1100px] space-y-5">
        <header><p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Manpower Work Order</p><h1 className="text-3xl font-semibold">New Manpower Work Order</h1></header>
        {message && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{message}</div>}
        <div className="grid gap-4 rounded-lg border bg-white p-5 shadow-sm md:grid-cols-2">
          <label className={labelClass}>Manpower WO Number<input className={field} value={form.manpower_wo_number || ""} onChange={(e) => setForm({ ...form, manpower_wo_number: e.target.value })} /></label>
          <label className={labelClass}>Title / Scope<input className={field} value={form.title || ""} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label className={labelClass}>Company<select className={field} value={form.company_id || ""} onChange={(e) => setForm({ ...form, company_id: e.target.value, commercial_work_order_id: "" })}><option value="">Select Company</option>{lookups.companies.map((c: any) => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label>
          <label className={labelClass}>Site<select className={field} value={form.site_id || ""} onChange={(e) => setForm({ ...form, site_id: e.target.value, commercial_work_order_id: "" })}><option value="">Select Site</option>{lookups.sites.map((s: any) => <option key={s.id} value={s.id}>{s.site_name}</option>)}</select></label>
          <label className={labelClass}>Labour Contractor<select className={field} value={form.contractor_profile_id || ""} onChange={(e) => setForm({ ...form, contractor_profile_id: e.target.value })}><option value="">Select Labour Contractor</option>{lookups.contractors.map((c: any) => <option key={c.id} value={c.id}>{c.vendors?.vendor_name || c.contractor_code}</option>)}</select></label>
          <label className={labelClass}>Linked Commercial Work Order (Optional)<select className={field} value={form.commercial_work_order_id || ""} onChange={(e) => setForm({ ...form, commercial_work_order_id: e.target.value })}><option value="">No linked Commercial WO</option>{workOrders.map((wo: any) => <option key={wo.id} value={wo.id}>{wo.wo_number}</option>)}</select></label>
          <label className={labelClass}>Effective From<input type="date" className={field} value={form.effective_from || ""} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} /></label>
          <label className={labelClass}>Effective To<input type="date" className={field} value={form.effective_to || ""} onChange={(e) => setForm({ ...form, effective_to: e.target.value })} /></label>
          <label className={labelClass}>Shift Start Time<input type="time" className={field} value={form.shift_start_time || ""} onChange={(e) => setForm({ ...form, shift_start_time: e.target.value })} /></label>
          <label className={labelClass}>Shift End Time<input type="time" className={field} value={form.shift_end_time || ""} onChange={(e) => setForm({ ...form, shift_end_time: e.target.value })} /></label>
          <label className={labelClass}>Contractor Profit Type<select className={field} value={form.contractor_profit_type} onChange={(e) => setForm({ ...form, contractor_profit_type: e.target.value })}><option value="none">No Contractor Profit</option><option value="percentage">Percentage</option><option value="fixed_per_labour_day">Fixed Per Labour Day</option></select></label>
          <label className={labelClass}>Contractor Profit Value<input className={field} type="number" min={0} value={form.contractor_profit_value || ""} onChange={(e) => setForm({ ...form, contractor_profit_value: e.target.value })} /></label>
          <label className={`${labelClass} md:col-span-2`}>Scope / Notes<textarea className="mt-1 min-h-24 w-full rounded-lg border px-3 py-2" value={form.scope || ""} onChange={(e) => setForm({ ...form, scope: e.target.value })} /></label>
        </div>
        <button onClick={save} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-5 py-3 text-sm font-semibold text-white"><Save className="h-4 w-4" /> Save Manpower Work Order</button>
      </div>
    </section>
  );
}
