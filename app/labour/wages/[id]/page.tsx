"use client";

import Link from "next/link";
import { ArrowLeft, Calculator, CheckCircle2, RotateCcw, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { useAccessContext } from "@/components/AccessContext";
import { labelFromCode } from "@/lib/labour/constants";

function formatNumber(value: unknown) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "0";
}

function formatMoney(value: unknown) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export default function LabourWageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const global = hasGlobalAccess(access);
  const canCalculate = global || can(permissions, "labour_wages", "add");
  const canEdit = global || can(permissions, "labour_wages", "edit");
  const canSubmit = global || can(permissions, "labour_wages", "submit");
  const canApprove = global || can(permissions, "labour_wage_approval", "approve");
  const canReject = global || can(permissions, "labour_wage_approval", "reject");
  const [id, setId] = useState("");
  const [period, setPeriod] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [message, setMessage] = useState("");

  async function token() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  }

  async function load() {
    if (!id) return;
    const response = await fetch(`/api/labour/wages/${id}`, { headers: { Authorization: `Bearer ${await token()}` } });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.error || "Could not load wage period.");
    setPeriod(payload.wage_period);
    setLines(payload.lines || []);
  }

  async function postAction(action: string, body: any = {}) {
    const response = await fetch(`/api/labour/wages/${id}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.error || `Could not ${action}.`);
    setMessage(`${action.replace("-", " ")} complete.`);
    load();
  }

  async function reopen() {
    const reason = prompt("Reopen reason") || "";
    if (!reason.trim()) return;
    const response = await fetch(`/api/labour/wages/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ reason }),
    });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.error || "Could not reopen.");
    setMessage("Wage period reopened.");
    load();
  }

  async function saveLines() {
    const response = await fetch(`/api/labour/wages/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ lines }),
    });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.error || "Could not save lines.");
    setMessage("Wage lines saved.");
    load();
  }

  useEffect(() => { params.then((value) => setId(value.id)); }, [params]);
  useEffect(() => { load(); }, [id]);

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-slate-950 md:px-10">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/labour/wages" className="inline-flex items-center gap-2 text-sm text-slate-600"><ArrowLeft className="h-4 w-4" /> Back to Wage Register</Link>
            <h1 className="text-3xl font-semibold">Wage Period</h1>
            <p className="text-sm text-slate-600">{period?.period_month} · {period?.companies?.company_name} · {period?.sites?.site_name}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canCalculate && period?.status !== "finalized" && <button onClick={() => postAction("calculate")} className="inline-flex h-11 items-center gap-2 rounded-lg border bg-white px-4 text-sm font-semibold"><Calculator className="h-4 w-4" /> Calculate</button>}
            {canEdit && period?.status !== "finalized" && <button onClick={saveLines} className="h-11 rounded-lg border bg-white px-4 text-sm font-semibold">Save Lines</button>}
            {canSubmit && ["calculated", "reopened"].includes(period?.status) && <button onClick={() => postAction("submit")} className="inline-flex h-11 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white"><Send className="h-4 w-4" /> Submit</button>}
            {canApprove && period?.status === "submitted" && <button onClick={() => postAction("finalize")} className="inline-flex h-11 items-center gap-2 rounded-lg bg-green-700 px-4 text-sm font-semibold text-white"><CheckCircle2 className="h-4 w-4" /> Finalize</button>}
            {canReject && period?.status === "submitted" && <button onClick={() => postAction("send-back", { reason: prompt("Send back reason") || "" })} className="h-11 rounded-lg border bg-white px-4 text-sm font-semibold">Send Back</button>}
            {canReject && period?.status === "finalized" && <button onClick={reopen} className="inline-flex h-11 items-center gap-2 rounded-lg border bg-white px-4 text-sm font-semibold"><RotateCcw className="h-4 w-4" /> Reopen</button>}
          </div>
        </header>
        {message && <div className="rounded-lg border bg-white p-3 text-sm">{message}</div>}
        <div className="grid gap-3 md:grid-cols-5">
          {[["Status", period?.status], ["Workers", period?.summary?.worker_count || 0], ["Amount", formatMoney(period?.summary?.gross_wages)], ["Advance", formatMoney(period?.summary?.advance_recovery)], ["Net", formatMoney(period?.summary?.net_wages)]].map(([label, value]) => (
            <div key={label} className="rounded-lg border bg-white p-4 shadow-sm"><p className="text-xs uppercase text-slate-500">{label}</p><p className="text-xl font-semibold">{value}</p></div>
          ))}
        </div>
        <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{["Labour Code", "Worker", "Type", "Days", "OT Hrs", "OT Days", "Rate", "Amount", "Advance", "Other Deduction", "Net", "Payment", "Review"].map((h) => <th key={h} className="px-3 py-3">{h}</th>)}</tr></thead>
            <tbody className="divide-y">
              {lines.map((line) => {
                const otDays = line.calculation_details?.ot_days ?? 0;
                return (
                <tr key={line.id}>
                  <td className="px-3 py-3 font-semibold">{line.labour_workers?.labour_code}</td>
                  <td className="px-3 py-3">{line.labour_workers?.worker_name}</td>
                  <td className="px-3 py-3">{labelFromCode(line.wage_type)}</td>
                  <td className="px-3 py-3">{formatNumber(line.payable_days)}</td>
                  <td className="px-3 py-3">{formatNumber(line.overtime_hours)}</td>
                  <td className="px-3 py-3">{formatNumber(otDays)}</td>
                  <td className="px-3 py-3">{formatMoney(line.base_rate)}</td>
                  <td className="px-3 py-3">{formatMoney(line.gross_wages)}</td>
                  <td className="px-3 py-3">{formatMoney(line.advance_recovery)}</td>
                  <td className="px-3 py-3"><input disabled={!canEdit || period?.status === "finalized"} type="number" min="0" value={line.other_deductions || 0} onChange={(e) => setLines((items) => items.map((item) => item.id === line.id ? { ...item, other_deductions: e.target.value } : item))} className="h-10 w-28 rounded-md border px-2" /></td>
                  <td className="px-3 py-3">{formatMoney(line.net_wages)}</td>
                  <td className="px-3 py-3"><select disabled={!canEdit || period?.status === "finalized"} value={line.payment_status || "unpaid"} onChange={(e) => setLines((items) => items.map((item) => item.id === line.id ? { ...item, payment_status: e.target.value } : item))} className="h-10 rounded-md border px-2"><option value="unpaid">Unpaid</option><option value="partially_paid">Partially Paid</option><option value="paid">Paid</option></select></td>
                  <td className="px-3 py-3">{line.calculation_details?.review_required ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">Review</span> : "-"}</td>
                </tr>
              );})}
              {!lines.length && <tr><td colSpan={13} className="px-3 py-8 text-center text-slate-500">Calculate this wage period to generate lines.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
