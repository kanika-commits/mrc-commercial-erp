"use client";

import { Download, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { useAccessContext } from "@/components/AccessContext";
import { recordClientAuditEvent } from "@/lib/clientAudit";

export default function LabourAdvancesPage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const global = hasGlobalAccess(access);
  const canAdd = global || can(permissions, "labour_advances", "add");
  const canDelete = global || can(permissions, "labour_advances", "delete");
  const canExport = global || can(permissions, "labour_advances", "export");
  const [workers, setWorkers] = useState<any[]>([]);
  const [advances, setAdvances] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ labour_worker_id: "", advance_date: new Date().toISOString().slice(0, 10), amount: "", recovery_mode: "manual", installment_amount: "", purpose: "", payment_reference: "", remarks: "" });

  async function token() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  }

  async function load() {
    const bearer = await token();
    const [workerRes, advanceRes] = await Promise.all([
      fetch("/api/labour/workers?limit=100", { headers: { Authorization: `Bearer ${bearer}` } }),
      fetch("/api/labour/advances", { headers: { Authorization: `Bearer ${bearer}` } }),
    ]);
    const workerPayload = await workerRes.json();
    const advancePayload = await advanceRes.json();
    if (workerRes.ok) setWorkers(workerPayload.workers || []);
    if (advanceRes.ok) setAdvances(advancePayload.advances || []);
  }

  async function createAdvance() {
    const response = await fetch("/api/labour/advances", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify(form),
    });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.error || "Could not create advance.");
    setMessage("Advance created.");
    setForm({ labour_worker_id: "", advance_date: new Date().toISOString().slice(0, 10), amount: "", recovery_mode: "manual", installment_amount: "", purpose: "", payment_reference: "", remarks: "" });
    load();
  }

  async function cancelAdvance(id: string) {
    if (!confirm("Cancel this advance?")) return;
    const response = await fetch(`/api/labour/advances/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${await token()}` } });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.error || "Could not cancel advance.");
    setMessage("Advance cancelled.");
    load();
  }

  async function exportCsv() {
    recordClientAuditEvent({ eventType: "export", entityType: "labour_worker", source: "labour_advances" });
    const response = await fetch("/api/labour/advances?export=csv", { headers: { Authorization: `Bearer ${await token()}` } });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "labour-advances.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => { load(); }, []);

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-slate-950 md:px-10">
      <div className="mx-auto max-w-[1400px] space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Labour Wages</p>
            <h1 className="text-3xl font-semibold">Advances</h1>
            <p className="text-sm text-slate-600">Track labour advances and wage-period recoveries without Payment module posting.</p>
          </div>
          {canExport && <button onClick={exportCsv} className="inline-flex h-11 items-center gap-2 rounded-lg border bg-white px-4 text-sm font-semibold"><Download className="h-4 w-4" /> Export CSV</button>}
        </header>
        {message && <div className="rounded-lg border bg-white p-3 text-sm">{message}</div>}
        {canAdd && (
          <div className="grid gap-3 rounded-lg border bg-white p-4 shadow-sm md:grid-cols-4">
            <select value={form.labour_worker_id} onChange={(e) => setForm({ ...form, labour_worker_id: e.target.value })} className="h-11 rounded-lg border px-3"><option value="">Select Labourer</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.labour_code} · {worker.worker_name}</option>)}</select>
            <input type="date" value={form.advance_date} onChange={(e) => setForm({ ...form, advance_date: e.target.value })} className="h-11 rounded-lg border px-3" />
            <input type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="Amount" className="h-11 rounded-lg border px-3" />
            <select value={form.recovery_mode} onChange={(e) => setForm({ ...form, recovery_mode: e.target.value })} className="h-11 rounded-lg border px-3"><option value="manual">Manual</option><option value="one_time">One Time</option><option value="installment">Installment</option></select>
            <input type="number" min="0" value={form.installment_amount} onChange={(e) => setForm({ ...form, installment_amount: e.target.value })} placeholder="Installment amount" className="h-11 rounded-lg border px-3" />
            <input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Purpose" className="h-11 rounded-lg border px-3" />
            <input value={form.payment_reference} onChange={(e) => setForm({ ...form, payment_reference: e.target.value })} placeholder="Reference" className="h-11 rounded-lg border px-3" />
            <button onClick={createAdvance} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> Add Advance</button>
          </div>
        )}
        <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{["Labour", "Contractor", "Site", "Date", "Amount", "Recovered", "Balance", "Mode", "Status", "Action"].map((h) => <th key={h} className="px-3 py-3">{h}</th>)}</tr></thead>
            <tbody className="divide-y">
              {advances.map((advance) => (
                <tr key={advance.id}>
                  <td className="px-3 py-3"><b>{advance.labour_workers?.labour_code}</b><br />{advance.labour_workers?.worker_name}</td>
                  <td className="px-3 py-3">{advance.labour_contractor_profiles?.vendors?.vendor_name || "No Contractor"}</td>
                  <td className="px-3 py-3">{advance.sites?.site_name}</td>
                  <td className="px-3 py-3">{advance.advance_date}</td>
                  <td className="px-3 py-3">₹ {Number(advance.amount || 0).toLocaleString("en-IN")}</td>
                  <td className="px-3 py-3">₹ {Number(advance.recovered_amount || 0).toLocaleString("en-IN")}</td>
                  <td className="px-3 py-3">₹ {Number(advance.balance_amount || 0).toLocaleString("en-IN")}</td>
                  <td className="px-3 py-3">{advance.recovery_mode}</td>
                  <td className="px-3 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">{advance.status}</span></td>
                  <td className="px-3 py-3">{canDelete && advance.status === "active" && Number(advance.recovered_amount || 0) === 0 ? <button onClick={() => cancelAdvance(advance.id)} className="rounded-md border px-3 py-2 text-red-600"><Trash2 className="h-4 w-4" /></button> : "-"}</td>
                </tr>
              ))}
              {!advances.length && <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-500">No advances found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
