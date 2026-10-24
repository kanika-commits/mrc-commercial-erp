"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/components/hr/hrClient";

export default function WorkOrderItemMastersPage() {
  const [items, setItems] = useState<any[]>([]); const [form, setForm] = useState({ item_header: "", description: "", unit: "", mode_of_measurement: "" }); const [message, setMessage] = useState(""); const [pendingId, setPendingId] = useState<string | null>(null);
  async function load() { try { const data = await apiFetch("/api/work-orders/item-masters"); setItems(data.items || []); } catch (error: any) { setMessage(error.message); } }
  useEffect(() => { void load(); }, []);
  async function save(event: React.FormEvent) { event.preventDefault(); setMessage(""); try { await apiFetch("/api/work-orders/item-masters", { method: "POST", body: JSON.stringify(form) }); setForm({ item_header: "", description: "", unit: "", mode_of_measurement: "" }); await load(); } catch (error: any) { setMessage(error.message); } }
  async function remove(item: any) {
    if (!window.confirm(`Delete Work Order item “${item.item_header}”? Referenced items will be deactivated.`)) {
      return;
    }
    setPendingId(item.id); setMessage("");
    try { const result = await apiFetch("/api/work-orders/item-masters", { method: "DELETE", body: JSON.stringify({ id: item.id }) }); setMessage(result.message || "Item updated."); await load(); } catch (error: any) { setMessage(error.message); } finally { setPendingId(null); }
  }
  function itemActionLabel(item: any) {
    if (pendingId === item.id) return "Working…";
    if (item.status === "inactive") return "Deactivate";
    return "Delete";
  }
  return <section className="space-y-6"><header><p className="text-xs font-semibold uppercase text-emerald-700">Work Orders</p><h1 className="text-3xl font-bold">Work Order Item Master</h1><p className="mt-1 text-sm text-slate-500">Separate from the Purchase Order Item Master.</p></header><form onSubmit={save} className="grid gap-3 rounded-2xl border bg-white p-5 md:grid-cols-4"><input required placeholder="Item Header" value={form.item_header} onChange={e => setForm({ ...form, item_header: e.target.value })} className="rounded-xl border px-3 py-2" /><input placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="rounded-xl border px-3 py-2" /><input required placeholder="Unit" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} className="rounded-xl border px-3 py-2" /><input required placeholder="Mode of Measurement" value={form.mode_of_measurement} onChange={e => setForm({ ...form, mode_of_measurement: e.target.value })} className="rounded-xl border px-3 py-2" /><button type="submit" className="rounded-xl bg-slate-950 px-4 py-2 font-semibold text-white md:col-span-4">Add Item</button>{message && <p className="text-sm text-red-700 md:col-span-4">{message}</p>}</form><div className="overflow-x-auto rounded-2xl border bg-white"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50"><tr>{["Item Header", "Description", "Unit", "Mode of Measurement", "Status", "Actions"].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{items.map(item => <tr key={item.id} className="border-t"><td className="p-3 font-semibold">{item.item_header}</td><td className="p-3">{item.description || "-"}</td><td className="p-3">{item.unit}</td><td className="p-3">{item.mode_of_measurement}</td><td className="p-3">{item.status}</td><td className="p-3"><button type="button" disabled={pendingId === item.id} onClick={() => void remove(item)} className="rounded-lg border border-red-200 px-3 py-1.5 text-red-700 disabled:opacity-50">{itemActionLabel(item)}</button></td></tr>)}</tbody></table></div></section>;
}
