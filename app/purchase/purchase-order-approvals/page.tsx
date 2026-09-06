"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { apiFetch } from "@/components/hr/hrClient";

function money(value: unknown) { return `₹ ${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function date(value: unknown) { const raw = String(value || ""); const parts = raw.slice(0, 10).split("-"); return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : "—"; }

export default function PurchaseOrderApprovalPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  async function load() {
    setLoading(true); setMessage("");
    try { const result = await apiFetch("/api/procurement/purchase-order-approvals"); setRows(result.purchase_orders || []); }
    catch (error: any) { setMessage(error.message || "Failed to load Purchase Order approvals."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  return <section className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Purchase</p><h1 className="mt-1 text-3xl font-bold text-slate-950">Purchase Order Approval</h1><p className="mt-1 text-sm text-slate-500">Review submitted Purchase Orders within your permitted company and site scope.</p></div>
      <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white"><RefreshCw className="h-4 w-4" />Refresh List</button>
    </header>
    {message && <p className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{message}</p>}
    <div className="overflow-hidden rounded border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Purchase Order</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Company / Site</th><th className="px-4 py-3">Vendor</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3">Submitted By</th><th className="px-4 py-3">Submitted At</th><th className="px-4 py-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{loading ? <tr><td colSpan={8} className="p-8 text-center text-slate-500">Loading Purchase Order approvals...</td></tr> : rows.length === 0 ? <tr><td colSpan={8} className="p-8 text-center text-slate-500">No pending Purchase Orders found.</td></tr> : rows.map((row) => { const event = row.submission_event; return <tr key={row.id} className="align-top hover:bg-slate-50"><td className="px-4 py-4 font-mono font-semibold text-sky-800">{row.po_number || "—"}</td><td className="whitespace-nowrap px-4 py-4">{date(row.po_date)}</td><td className="px-4 py-4"><div className="font-semibold text-slate-900">{row.company?.company_name || "—"}</div><div className="mt-1 text-slate-600">{row.site?.site_name || "—"}</div></td><td className="px-4 py-4">{row.vendor_name_snapshot || "—"}</td><td className="whitespace-nowrap px-4 py-4 text-right font-semibold">{money(row.total_amount)}</td><td className="px-4 py-4">{event?.actor_name || row.created_by_name || "—"}</td><td className="whitespace-nowrap px-4 py-4">{event?.created_at ? new Date(event.created_at).toLocaleString("en-IN") : date(row.submitted_at)}</td><td className="px-4 py-4 text-right"><Link href={`/purchase/purchase-orders/${row.id}?review=1`} className="rounded bg-slate-900 px-3 py-2 text-xs font-semibold text-white">Review</Link></td></tr>; })}</tbody></table></div></div>
  </section>;
}
