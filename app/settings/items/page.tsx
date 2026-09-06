"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Boxes, Pencil, Plus, Search, Trash2 } from "lucide-react";
import AlertMessage from "@/components/AlertMessage";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import { apiFetch } from "@/components/hr/hrClient";

const emptyForm = { item_name: "", item_type_id: "", item_group_id: "", default_uom_id: "", description: "", hsn_sac: "", status: "active" };

export default function ItemsPage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const canAdd = can(permissions, "procurement_items", "add");
  const canEdit = can(permissions, "procurement_items", "edit");
  const canDelete = can(permissions, "procurement_items", "delete");
  const [items, setItems] = useState<any[]>([]);
  const [uoms, setUoms] = useState<any[]>([]);
  const [itemTypes, setItemTypes] = useState<any[]>([]);
  const [itemGroups, setItemGroups] = useState<any[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<any | null>(null);
  const [search, setSearch] = useState("");
  const [typeId, setTypeId] = useState("all");
  const [groupId, setGroupId] = useState("all");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");

  async function loadData() {
    setLoading(true);
    setMessage("");
    try {
      const [itemResult, lookupResult] = await Promise.all([
        apiFetch(`/api/procurement/items?search=${encodeURIComponent(search)}&item_type_id=${encodeURIComponent(typeId)}&item_group_id=${encodeURIComponent(groupId)}&status=${encodeURIComponent(status)}`),
        apiFetch("/api/procurement/lookups"),
      ]);
      setItems(itemResult.items || []);
      setUoms((lookupResult.uoms || []).filter((uom: any) => uom.status === "active"));
      setItemTypes((lookupResult.item_types || []).filter((type: any) => type.status === "active"));
      setItemGroups((lookupResult.item_groups || []).filter((group: any) => group.status === "active"));
    } catch (error: any) {
      setMessage(error.message || "Failed to load items.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);
  useEffect(() => { const timer = window.setTimeout(loadData, 350); return () => window.clearTimeout(timer); }, [search, typeId, groupId, status]);

  const formGroups = useMemo(() => itemGroups.filter((group) => !form.item_type_id || group.item_type_id === form.item_type_id), [form.item_type_id, itemGroups]);
  const filterGroups = useMemo(() => itemGroups.filter((group) => typeId === "all" || group.item_type_id === typeId), [itemGroups, typeId]);

  function startEdit(item: any) {
    setEditing(item);
    setForm({ item_name: item.item_name || "", item_type_id: item.item_type_id || "", item_group_id: item.item_group_id || "", default_uom_id: item.default_uom_id || "", description: item.description || "", hsn_sac: item.hsn_sac || "", status: item.status || "active" });
    setMessage("");
    setSuccess("");
  }

  function resetForm() { setEditing(null); setForm(emptyForm); }

  async function saveItem(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setMessage(""); setSuccess("");
    try {
      await apiFetch(editing ? `/api/procurement/items/${editing.id}` : "/api/procurement/items", { method: editing ? "PUT" : "POST", body: JSON.stringify(form) });
      setSuccess(editing ? "Item updated." : "Item added.");
      resetForm();
      await loadData();
    } catch (error: any) { setMessage(error.message || "Failed to save item."); } finally { setSaving(false); }
  }

  async function deleteItem(item: any) {
    if (!window.confirm(`Delete item "${item.item_name}"?`)) return;
    try { await apiFetch(`/api/procurement/items/${item.id}`, { method: "DELETE" }); setSuccess("Item deleted."); await loadData(); } catch (error: any) { setMessage(error.message || "Failed to delete item."); }
  }

  const totalCount = items.length;
  const countText = `Showing ${totalCount} ${totalCount === 1 ? "Item" : "Items"}`;

  return <section className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"><Boxes className="h-3.5 w-3.5" />Master Setup</div><h1 className="text-3xl font-bold text-slate-950">Item / Material Master</h1><p className="text-sm text-slate-500">Maintain stable procurement item codes, types, groups and default UOMs.</p></div>
      <Link href="/modules/settings" className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"><ArrowLeft className="h-4 w-4" />Back to Settings</Link>
    </header>
    <AlertMessage type="error" message={message} onClose={() => setMessage("")} /><AlertMessage type="success" message={success} onClose={() => setSuccess("")} />
    {(canAdd || editing) && <form onSubmit={saveItem} className="rounded-2xl border bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold text-slate-950">{editing ? "Edit Item" : "Add Item"}</h2>{editing && <button type="button" onClick={resetForm} className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-slate-50">Cancel</button>}</div><div className="grid gap-4 md:grid-cols-3"><Field label="Item Name *"><input value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400" /></Field><Field label="Item Type *"><select value={form.item_type_id} onChange={(e) => setForm({ ...form, item_type_id: e.target.value, item_group_id: "" })} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400"><option value="">Select Type</option>{itemTypes.map((item) => <option key={item.id} value={item.id}>{item.type_name}</option>)}</select></Field><Field label="Item Group *"><select value={form.item_group_id} onChange={(e) => setForm({ ...form, item_group_id: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400"><option value="">Select Group</option>{formGroups.map((item) => <option key={item.id} value={item.id}>{item.group_name}</option>)}</select></Field><Field label="Default UOM *"><select value={form.default_uom_id} onChange={(e) => setForm({ ...form, default_uom_id: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400"><option value="">Select UOM</option>{uoms.map((uom) => <option key={uom.id} value={uom.id}>{uom.uom_code} - {uom.uom_name}</option>)}</select></Field><Field label="HSN/SAC"><input value={form.hsn_sac} onChange={(e) => setForm({ ...form, hsn_sac: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400" /></Field><Field label="Status"><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400"><option value="active">Active</option><option value="inactive">Inactive</option></select></Field><Field label="Specification"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400" /></Field></div><div className="mt-4 flex justify-end"><button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"><Plus className="h-4 w-4" />{saving ? "Saving..." : editing ? "Update Item" : "Add Item"}</button></div></form>}
    <section className="rounded-2xl border bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div><h2 className="font-semibold text-slate-950">Item Register</h2><p className="text-xs text-slate-500">{countText}</p></div><div className="flex flex-wrap gap-2"><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code or item" className="h-10 rounded-xl border pl-9 pr-3 text-sm outline-none focus:border-slate-400" /></div><select value={typeId} onChange={(e) => { setTypeId(e.target.value); setGroupId("all"); }} className="h-10 rounded-xl border px-3 text-sm"><option value="all">All Types</option>{itemTypes.map((item) => <option key={item.id} value={item.id}>{item.type_name}</option>)}</select><select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="h-10 rounded-xl border px-3 text-sm"><option value="all">All Groups</option>{filterGroups.map((item) => <option key={item.id} value={item.id}>{item.group_name}</option>)}</select><select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-xl border px-3 text-sm"><option value="all">All Status</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3 text-right">S. No.</th><th className="px-4 py-3">Item Code</th><th className="px-4 py-3">Item</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Group</th><th className="px-4 py-3">UOM</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y">{loading ? <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">Loading items...</td></tr> : items.length === 0 ? <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No items found.</td></tr> : items.map((item, index) => <tr key={item.id}><td className="px-4 py-3 text-right text-slate-500">{index + 1}</td><td className="px-4 py-3 font-mono text-xs">{item.item_code}</td><td className="px-4 py-3"><p className="font-semibold text-slate-950">{item.item_name}</p><p className="text-xs text-slate-500">{item.description || "-"}</p></td><td className="px-4 py-3">{item.item_type?.type_name || "-"}</td><td className="px-4 py-3">{item.item_group?.group_name || item.item_category || "-"}</td><td className="px-4 py-3">{item.default_uom?.uom_code || "-"}</td><td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold capitalize text-slate-700">{item.status}</span></td><td className="px-4 py-3"><div className="flex justify-end gap-2">{canEdit && <button onClick={() => startEdit(item)} className="rounded-lg border p-2 hover:bg-slate-50" aria-label="Edit item"><Pencil className="h-4 w-4" /></button>}{canDelete && <button onClick={() => deleteItem(item)} className="rounded-lg border p-2 text-red-600 hover:bg-red-50" aria-label="Delete item"><Trash2 className="h-4 w-4" /></button>}</div></td></tr>)}</tbody></table></div></section>
  </section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="space-y-1 text-sm font-semibold text-slate-700"><span>{label}</span>{children}</label>; }
