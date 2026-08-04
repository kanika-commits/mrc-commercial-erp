"use client";

import Link from "next/link";
import { Eye, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { useAccessContext } from "@/components/AccessContext";
import { labelFromCode } from "@/lib/labour/constants";

function mwoStatusLabel(status: string | null | undefined) {
  return status === "submitted" ? "Pending Approval" : labelFromCode(status);
}

export default function ManpowerWorkOrdersPage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const global = hasGlobalAccess(access);
  const canAdd = global || can(permissions, "labour_manpower_work_orders", "add");
  const [rows, setRows] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  async function token() { const { data: { session } } = await supabase.auth.getSession(); return session?.access_token || ""; }
  async function load() {
    setMessage("");
    const response = await fetch("/api/labour/manpower-work-orders", { headers: { Authorization: `Bearer ${await token()}` } });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.error || "Could not load Manpower Work Orders.");
    setRows(payload.manpower_work_orders || []);
  }
  useEffect(() => { load(); }, []);
  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-slate-950 md:px-10">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Labour Management</p><h1 className="text-3xl font-semibold">Manpower Work Orders</h1><p className="text-sm text-slate-600">Daily-wage labour engagements, category rates and effective revisions.</p></div>
          <div className="flex gap-2"><button onClick={load} className="inline-flex items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm font-semibold"><RefreshCw className="h-4 w-4" /> Refresh</button>{canAdd && <Link href="/labour/manpower-work-orders/new" className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> New</Link>}</div>
        </header>
        {message && <div className="rounded-lg border bg-white p-3 text-sm">{message}</div>}
        <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{["MWO Number", "Title", "Contractor", "Company", "Site", "Effective Dates", "Linked WO", "Status", "Action"].map((h) => <th key={h} className="px-3 py-3">{h}</th>)}</tr></thead>
            <tbody className="divide-y">
              {rows.map((row) => <tr key={row.id}>
                <td className="px-3 py-3 font-semibold">{row.manpower_wo_number}</td><td className="px-3 py-3">{row.title}</td><td className="px-3 py-3">{row.labour_contractor_profiles?.vendors?.vendor_name || "-"}</td><td className="px-3 py-3">{row.companies?.company_name || "-"}</td><td className="px-3 py-3">{row.sites?.site_name || "-"}</td><td className="px-3 py-3">{row.effective_from} to {row.effective_to || "Open"}</td><td className="px-3 py-3">{row.work_orders?.wo_number || "-"}</td><td className="px-3 py-3">{mwoStatusLabel(row.status)}</td><td className="px-3 py-3"><Link href={`/labour/manpower-work-orders/${row.id}`} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5"><Eye className="h-4 w-4" /> View</Link></td>
              </tr>)}
              {!rows.length && <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-500">No Manpower Work Orders found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
