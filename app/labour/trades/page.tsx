"use client";

import { Download, Edit2, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { useAccessContext } from "@/components/AccessContext";

type Trade = {
  id: string;
  trade_name: string;
  trade_code?: string | null;
  description?: string | null;
  status: string;
  usage_count?: number;
};

const EMPTY_FORM = { trade_name: "", trade_code: "", description: "", status: "active" };

function usageLabel(count?: number) {
  const total = Number(count || 0);
  if (!total) return "Unused";
  return `${total} ${total === 1 ? "Labourer" : "Labourers"}`;
}

export default function LabourTradesPage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const global = hasGlobalAccess(access);
  const canAdd = global || can(permissions, "labour_trades", "add");
  const canEdit = global || can(permissions, "labour_trades", "edit");
  const canDelete = global || can(permissions, "labour_trades", "delete");
  const canExport = global || can(permissions, "labour_trades", "export");
  const [trades, setTrades] = useState<Trade[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  async function token() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  }

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);
    return params.toString();
  }, [search, status]);

  async function loadTrades() {
    setLoading(true);
    setError("");
    const suffix = queryString ? `?${queryString}` : "";
    const response = await fetch(`/api/labour/trades${suffix}`, { headers: { Authorization: `Bearer ${await token()}` } });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) setTrades(payload.trades || []);
    else setError(payload.error || "Could not load labour categories.");
    setLoading(false);
  }

  function openAddModal() {
    setEditingTrade(null);
    setForm(EMPTY_FORM);
    setMessage("");
    setError("");
    setModalOpen(true);
  }

  function openEditModal(trade: Trade) {
    setEditingTrade(trade);
    setForm({
      trade_name: trade.trade_name || "",
      trade_code: trade.trade_code || "",
      description: trade.description || "",
      status: trade.status || "active",
    });
    setMessage("");
    setError("");
    setModalOpen(true);
  }

  async function saveTrade() {
    setSaving(true);
    setMessage("");
    setError("");
    const response = await fetch(editingTrade ? `/api/labour/trades/${editingTrade.id}` : "/api/labour/trades", {
      method: editingTrade ? "PUT" : "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify(form),
    });
    const payload = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setError(payload.error || "Could not save labour category.");
      return;
    }
    setModalOpen(false);
    setMessage("Labour category saved.");
    await loadTrades();
  }

  async function deleteTrade(trade: Trade) {
    if (!confirm(`Delete ${trade.trade_name}?`)) return;
    setMessage("");
    setError("");
    const response = await fetch(`/api/labour/trades/${trade.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${await token()}` } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.error || "Could not delete labour category.");
      return;
    }
    setMessage("Labour category deleted.");
    await loadTrades();
  }

  async function exportCsv() {
    const params = new URLSearchParams(queryString);
    params.set("export", "csv");
    const response = await fetch(`/api/labour/trades?${params.toString()}`, { headers: { Authorization: `Bearer ${await token()}` } });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "labour-categories.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => { loadTrades(); }, [queryString]);

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-slate-950 md:px-10">
      <div className="mx-auto max-w-[1200px] space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Labour Master</p>
            <h1 className="text-3xl font-semibold">Labour Categories</h1>
            <p className="text-sm text-slate-600">Maintain category names and codes used by labour operations.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canExport && <button type="button" onClick={exportCsv} className="inline-flex h-11 items-center gap-2 rounded-lg border bg-white px-4 text-sm font-semibold"><Download className="h-4 w-4" /> Export CSV</button>}
            {canAdd && <button type="button" onClick={openAddModal} className="inline-flex h-11 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> Add Category</button>}
          </div>
        </header>

        {(message || error) && <div className={`rounded-lg border p-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-700" : "bg-white text-slate-700"}`}>{error || message}</div>}

        <div className="grid gap-3 rounded-lg border bg-white p-4 shadow-sm md:grid-cols-[1fr_180px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, code or description" className="h-11 w-full rounded-lg border pl-9 pr-3 text-sm" />
          </label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-11 rounded-lg border px-3 text-sm">
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>{["Code", "Category", "Description", "Status", "Usage", "Actions"].map((h) => <th key={h} className="px-3 py-3">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {trades.map((trade) => (
                <tr key={trade.id}>
                  <td className="px-3 py-3 font-semibold text-slate-700">{trade.trade_code || "-"}</td>
                  <td className="px-3 py-3 font-semibold">{trade.trade_name}</td>
                  <td className="px-3 py-3 text-slate-600">{trade.description || "-"}</td>
                  <td className="px-3 py-3"><span className="rounded-full border px-2 py-1 text-xs font-semibold capitalize">{trade.status}</span></td>
                  <td className="px-3 py-3 text-slate-600">{usageLabel(trade.usage_count)}</td>
                  <td className="px-3 py-3">
                    <div className="flex gap-2">
                      {canEdit && <button type="button" onClick={() => openEditModal(trade)} className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-xs font-semibold"><Edit2 className="h-3.5 w-3.5" /> Edit</button>}
                      {canDelete && <button type="button" onClick={() => deleteTrade(trade)} className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-xs font-semibold text-red-600"><Trash2 className="h-3.5 w-3.5" /> Delete</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {!trades.length && !loading && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No labour categories found.</td></tr>}
              {loading && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">Loading labour categories...</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-xl rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">{editingTrade ? "Edit Category" : "Add Category"}</h2>
                <p className="text-sm text-slate-500">Category identity only. Rates are maintained in Manpower Work Orders.</p>
              </div>
              <button type="button" onClick={() => setModalOpen(false)} className="rounded-md border p-2"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4 p-5">
              <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">Name *
                <input value={form.trade_name} onChange={(e) => setForm({ ...form, trade_name: e.target.value })} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950" />
              </label>
              <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">Code *
                <input value={form.trade_code} onChange={(e) => setForm({ ...form, trade_code: e.target.value })} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950" />
              </label>
              <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">Description
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 min-h-24 w-full rounded-lg border px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-950" />
              </label>
              <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">Status
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t px-5 py-4">
              <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg border px-4 py-2 text-sm font-semibold">Cancel</button>
              <button type="button" disabled={saving} onClick={saveTrade} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Saving..." : "Save Category"}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
