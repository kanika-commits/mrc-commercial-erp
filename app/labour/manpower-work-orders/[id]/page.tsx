"use client";

import Link from "next/link";
import { Plus, RefreshCw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { useAccessContext } from "@/components/AccessContext";
import { labelFromCode } from "@/lib/labour/constants";

function mwoStatusLabel(status: string | null | undefined) {
  return status === "submitted" ? "Pending Approval" : labelFromCode(status);
}

export default function ManpowerWorkOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const global = hasGlobalAccess(access);
  const canEdit = global || can(permissions, "labour_manpower_work_orders", "edit");
  const canSubmit = global || can(permissions, "labour_manpower_work_orders", "submit");
  const canApprove = global || can(permissions, "labour_manpower_work_orders", "approve");
  const canReject = global || can(permissions, "labour_manpower_work_orders", "reject");
  const canSuspend = global || can(permissions, "labour_manpower_work_orders", "suspend");
  const canResume = global || can(permissions, "labour_manpower_work_orders", "resume");
  const canRevise = global || can(permissions, "labour_rate_overrides", "approve");
  const [record, setRecord] = useState<any>(null);
  const [lookups, setLookups] = useState<any>({ trades: [] });
  const [message, setMessage] = useState("");
  const [rate, setRate] = useState<any>({});
  const [bulk, setBulk] = useState<any>({});
  const tradeOptions = useMemo(() => lookups.trades || [], [lookups.trades]);
  async function token() { const { data: { session } } = await supabase.auth.getSession(); return session?.access_token || ""; }
  async function load() {
    const accessToken = await token();
    const [detailResponse, lookupResponse] = await Promise.all([
      fetch(`/api/labour/manpower-work-orders/${params.id}`, { headers: { Authorization: `Bearer ${accessToken}` } }),
      fetch("/api/labour/lookups", { headers: { Authorization: `Bearer ${accessToken}` } }),
    ]);
    const detailPayload = await detailResponse.json();
    if (!detailResponse.ok) return setMessage(detailPayload.error || "Could not load Manpower Work Order.");
    setRecord(detailPayload.manpower_work_order);
    const lookupPayload = await lookupResponse.json();
    if (lookupResponse.ok) setLookups(lookupPayload);
  }
  useEffect(() => { load(); }, [params.id]);
  async function saveRate() {
    setMessage("");
    const response = await fetch(`/api/labour/manpower-work-orders/${params.id}/rates`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify(rate) });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.error || "Could not save rate.");
    setRate({});
    setMessage("Category rate saved.");
    load();
  }
  async function reviseRate(previewOnly = false) {
    setMessage("");
    const response = await fetch(`/api/labour/manpower-work-orders/${params.id}/bulk-rate-update`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ ...bulk, preview_only: previewOnly }) });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.error || "Could not revise rate.");
    setMessage(previewOnly ? `Preview: ${payload.affected_worker_count || 0} worker(s) affected.` : `Rate revised for ${payload.affected_worker_count || 0} worker(s).`);
    if (!previewOnly) { setBulk({}); load(); }
  }
  async function action(next: string) {
    const reason = ["approve", "send_back", "reject", "suspend", "resume"].includes(next) ? prompt("Reason") || "" : "";
    const response = await fetch("/api/labour/manpower-work-orders", { method: "PATCH", headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ id: params.id, action: next, reason }) });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.error || "Could not update status.");
    load();
  }
  if (!record) return <section className="p-8 text-sm text-slate-500">Loading...</section>;
  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-slate-950 md:px-10">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Manpower Work Order</p><h1 className="text-3xl font-semibold">{record.manpower_wo_number}</h1><p className="text-sm text-slate-600">{record.title}</p></div>
          <div className="flex flex-wrap gap-2">
            <button onClick={load} className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold"><RefreshCw className="inline h-4 w-4" /> Refresh</button>
            {canEdit && record.status === "draft" && <Link href={`/labour/manpower-work-orders/${record.id}/edit`} className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold">Edit Draft</Link>}
            {canSubmit && record.status === "draft" && <button onClick={() => action("submit")} className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold">Submit</button>}
            {canApprove && record.status === "submitted" && <button onClick={() => action("approve")} className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white">Approve</button>}
            {canReject && record.status === "submitted" && <button onClick={() => action("send_back")} className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold">Send Back</button>}
            {canReject && record.status === "submitted" && <button onClick={() => action("reject")} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white">Reject</button>}
            {canSuspend && record.status === "approved" && <button onClick={() => action("suspend")} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white">Suspend</button>}
            {canResume && record.status === "suspended" && <button onClick={() => action("resume")} className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold">Resume</button>}
          </div>
        </header>
        {message && <div className="rounded-lg border bg-white p-3 text-sm">{message}</div>}
        <div className="grid gap-4 md:grid-cols-4">
          {[["Contractor", record.labour_contractor_profiles?.vendors?.vendor_name], ["Company", record.companies?.company_name], ["Site", record.sites?.site_name], ["Status", mwoStatusLabel(record.status)], ["Effective", `${record.effective_from} to ${record.effective_to || "Open"}`], ["Commercial WO", record.work_orders?.wo_number || "-"], ["Profit", `${labelFromCode(record.contractor_profit_type)} ${record.contractor_profit_value || ""}`]].map(([label, value]) => <div key={label} className="rounded-lg border bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase text-slate-500">{label}</p><p className="mt-1 font-semibold">{value || "-"}</p></div>)}
        </div>
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="rounded-lg border bg-white shadow-sm">
            <div className="border-b p-4"><h2 className="font-semibold">Category Rates</h2><p className="text-sm text-slate-500">Effective-dated daily rates. Historical compatibility fields stay intact.</p></div>
            <table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{["Category", "Daily Rate", "Effective", "Revision", "Status"].map((h) => <th key={h} className="px-3 py-3">{h}</th>)}</tr></thead><tbody className="divide-y">{(record.manpower_work_order_rates || []).map((r: any) => <tr key={r.id}><td className="px-3 py-3">{r.labour_trades?.trade_name}</td><td className="px-3 py-3">₹ {r.daily_rate}</td><td className="px-3 py-3">{r.effective_from} to {r.effective_to || "Open"}</td><td className="px-3 py-3">{r.revision_number}</td><td className="px-3 py-3">{labelFromCode(r.status)}</td></tr>)}</tbody></table>
          </div>
          {canEdit && record.status === "draft" && <div className="space-y-3 rounded-lg border bg-white p-4 shadow-sm"><h2 className="font-semibold">Add Category Rate</h2><select className="h-11 w-full rounded-lg border px-3" value={rate.labour_trade_id || ""} onChange={(e) => setRate({ ...rate, labour_trade_id: e.target.value })}><option value="">Labour Category</option>{tradeOptions.map((t: any) => <option key={t.id} value={t.id}>{t.trade_name}</option>)}</select><input className="h-11 w-full rounded-lg border px-3" type="number" placeholder="Daily Rate" value={rate.daily_rate || ""} onChange={(e) => setRate({ ...rate, daily_rate: e.target.value })} /><input className="h-11 w-full rounded-lg border px-3" type="date" value={rate.effective_from || ""} onChange={(e) => setRate({ ...rate, effective_from: e.target.value })} /><button onClick={saveRate} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> Add Rate</button></div>}
        </div>
        {canRevise && <div className="grid gap-3 rounded-lg border bg-white p-4 shadow-sm md:grid-cols-5"><select className="h-11 rounded-lg border px-3" value={bulk.labour_trade_id || ""} onChange={(e) => setBulk({ ...bulk, labour_trade_id: e.target.value })}><option value="">Category</option>{tradeOptions.map((t: any) => <option key={t.id} value={t.id}>{t.trade_name}</option>)}</select><input className="h-11 rounded-lg border px-3" type="number" placeholder="New Daily Rate" value={bulk.daily_rate || ""} onChange={(e) => setBulk({ ...bulk, daily_rate: e.target.value })} /><input className="h-11 rounded-lg border px-3" type="date" value={bulk.effective_from || ""} onChange={(e) => setBulk({ ...bulk, effective_from: e.target.value })} /><input className="h-11 rounded-lg border px-3" placeholder="Reason" value={bulk.reason || ""} onChange={(e) => setBulk({ ...bulk, reason: e.target.value })} /><div className="flex gap-2"><button onClick={() => reviseRate(true)} className="rounded-lg border px-3 text-sm font-semibold">Preview</button><button onClick={() => reviseRate(false)} className="rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white"><Save className="inline h-4 w-4" /> Apply</button></div></div>}
      </div>
    </section>
  );
}
