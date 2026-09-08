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
  const [allItemTypes, setAllItemTypes] = useState<any[]>([]);
  const [allItemGroups, setAllItemGroups] = useState<any[]>([]);
  const [allUoms, setAllUoms] = useState<any[]>([]);
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
  const [quickCreate, setQuickCreate] = useState<"type" | "group" | "uom" | null>(null);
  const [quickName, setQuickName] = useState("");
  const [quickCode, setQuickCode] = useState("");
  const [quickSaving, setQuickSaving] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageTab, setManageTab] = useState<"type" | "group" | "uom">("type");

  async function loadData() {
    setLoading(true);
    setMessage("");
    try {
      const [itemResult, lookupResult] = await Promise.all([
        apiFetch(`/api/procurement/items?search=${encodeURIComponent(search)}&item_type_id=${encodeURIComponent(typeId)}&item_group_id=${encodeURIComponent(groupId)}&status=${encodeURIComponent(status)}`),
        apiFetch("/api/procurement/lookups"),
      ]);
      setItems(itemResult.items || []);
      setAllUoms(lookupResult.uoms || []);
      setAllItemTypes(lookupResult.item_types || []);
      setAllItemGroups(lookupResult.item_groups || []);
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

  async function createQuickMaster(event: FormEvent) {
    event.preventDefault(); setQuickSaving(true); setMessage("");
    try {
      const result = await apiFetch("/api/procurement/item-masters", { method: "POST", body: JSON.stringify({ kind: quickCreate, name: quickName, code: quickCode, item_type_id: form.item_type_id }) });
      await loadData();
      setForm((current) => quickCreate === "type" ? { ...current, item_type_id: result.id, item_group_id: "" } : quickCreate === "group" ? { ...current, item_group_id: result.id } : { ...current, default_uom_id: result.id });
      setQuickCreate(null); setQuickName(""); setQuickCode(""); setSuccess(`${quickCreate === "type" ? "Item Type" : quickCreate === "group" ? "Item Group" : "UOM"} added and selected.`);
    } catch (error: any) { setMessage(error.message || "Could not create item master."); } finally { setQuickSaving(false); }
  }

  async function deleteMaster(kind: "type" | "group" | "uom", record: any) {
    const label = kind === "type" ? record.type_name : kind === "group" ? record.group_name : `${record.uom_code} - ${record.uom_name}`;
    if (!window.confirm(`Delete ${kind === "type" ? "Item Type" : kind === "group" ? "Item Group" : "UOM"}?\n\n${label}\n\nThis permanently removes this unused master and cannot be undone.`)) return;
    try {
      await apiFetch("/api/procurement/item-masters", { method: "DELETE", body: JSON.stringify({ kind, id: record.id }) });
      if (kind === "type" && form.item_type_id === record.id) setForm((current) => ({ ...current, item_type_id: "", item_group_id: "" }));
      if (kind === "group" && form.item_group_id === record.id) setForm((current) => ({ ...current, item_group_id: "" }));
      if (kind === "uom" && form.default_uom_id === record.id) setForm((current) => ({ ...current, default_uom_id: "" }));
      setSuccess(`${kind === "type" ? "Item Type" : kind === "group" ? "Item Group" : "UOM"} deleted.`);
      await loadData();
    } catch (error: any) {
      const detail = String(error?.message || "");
      const known = ["has Item Groups assigned", "Item Type is in use", "Item Group is in use", "UOM is in use", "Item master was not found"];
      setMessage(known.some((text) => detail.includes(text)) ? detail : "Unable to delete this Item Master.");
    }
  }

  const totalCount = items.length;
  const countText = `Showing ${totalCount} ${totalCount === 1 ? "Item" : "Items"}`;

  return <section className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"><Boxes className="h-3.5 w-3.5" />Master Setup</div><h1 className="text-3xl font-bold text-slate-950">Item / Material Master</h1><p className="text-sm text-slate-500">Maintain stable procurement item codes, types, groups and default UOMs.</p></div>
      <Link href="/modules/settings" className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"><ArrowLeft className="h-4 w-4" />Back to Settings</Link>
    </header>
    {(message || success) && <div className="fixed right-4 top-4 z-[100] w-[min(24rem,calc(100vw-2rem))] space-y-2" aria-live={message ? "assertive" : "polite"}><AlertMessage type="error" message={message} onClose={() => setMessage("")} /><AlertMessage type="success" message={success} onClose={() => setSuccess("")} /></div>}
    {(canAdd || editing) && <form onSubmit={saveItem} className="rounded-2xl border bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold text-slate-950">{editing ? "Edit Item" : "Add Item"}</h2>{editing && <button type="button" onClick={resetForm} className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-slate-50">Cancel</button>}</div><div className="grid gap-4 md:grid-cols-3"><Field label="Item Name *"><input value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400" /></Field><Field label="Item Type *"><div className="flex gap-2"><select value={form.item_type_id} onChange={(e) => setForm({ ...form, item_type_id: e.target.value, item_group_id: "" })} className="h-11 min-w-0 flex-1 rounded-xl border px-3 text-sm outline-none focus:border-slate-400"><option value="">Select Type</option>{itemTypes.map((item) => <option key={item.id} value={item.id}>{item.type_name}</option>)}</select>{canAdd && <button type="button" onClick={() => { setQuickCreate("type"); setQuickName(""); }} className="whitespace-nowrap rounded-xl border px-3 text-xs font-semibold hover:bg-slate-50">+ Add Type</button>}</div></Field><Field label="Item Group *"><div className="flex gap-2"><select value={form.item_group_id} onChange={(e) => setForm({ ...form, item_group_id: e.target.value })} className="h-11 min-w-0 flex-1 rounded-xl border px-3 text-sm outline-none focus:border-slate-400"><option value="">Select Group</option>{formGroups.map((item) => <option key={item.id} value={item.id}>{item.group_name}</option>)}</select>{canAdd && <button type="button" disabled={!form.item_type_id} onClick={() => { setQuickCreate("group"); setQuickName(""); }} className="whitespace-nowrap rounded-xl border px-3 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">+ Add Group</button>}</div></Field><Field label="Default UOM *"><div className="flex gap-2"><select value={form.default_uom_id} onChange={(e) => setForm({ ...form, default_uom_id: e.target.value })} className="h-11 min-w-0 flex-1 rounded-xl border px-3 text-sm outline-none focus:border-slate-400"><option value="">Select UOM</option>{uoms.map((uom) => <option key={uom.id} value={uom.id}>{uom.uom_code} - {uom.uom_name}</option>)}</select>{canAdd && <button type="button" onClick={() => { setQuickCreate("uom"); setQuickName(""); setQuickCode(""); }} className="whitespace-nowrap rounded-xl border px-3 text-xs font-semibold hover:bg-slate-50">+ Add UOM</button>}</div></Field><Field label="HSN/SAC"><input value={form.hsn_sac} onChange={(e) => setForm({ ...form, hsn_sac: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400" /></Field><Field label="Status"><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400"><option value="active">Active</option><option value="inactive">Inactive</option></select></Field><Field label="Specification"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400" /></Field></div><div className="mt-4 flex justify-end"><button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"><Plus className="h-4 w-4" />{saving ? "Saving..." : editing ? "Update Item" : "Add Item"}</button></div></form>}
    {canDelete && <button type="button" onClick={() => setManageOpen(true)} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"><Boxes className="h-4 w-4" />Manage Item Masters</button>}
    {quickCreate && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><form onSubmit={createQuickMaster} className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"><h2 className="text-lg font-semibold">Add {quickCreate === "uom" ? "Unit of Measure" : `Item ${quickCreate === "type" ? "Type" : "Group"}`}</h2><label className="mt-4 block text-sm font-semibold">{quickCreate === "uom" ? "UOM Name" : `${quickCreate === "type" ? "Type" : "Group"} Name`} *<input autoFocus required value={quickName} onChange={(e) => setQuickName(e.target.value)} className="mt-1 h-11 w-full rounded-xl border px-3" /></label>{quickCreate === "uom" && <label className="mt-4 block text-sm font-semibold">UOM Code / Symbol *<input required value={quickCode} onChange={(e) => setQuickCode(e.target.value.toUpperCase())} className="mt-1 h-11 w-full rounded-xl border px-3 font-mono" /></label>}<div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setQuickCreate(null)} className="rounded-xl border px-4 py-2 text-sm font-semibold">Cancel</button><button disabled={quickSaving} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{quickSaving ? "Adding..." : quickCreate === "uom" ? "Add UOM" : quickCreate === "type" ? "Add Type" : "Add Group"}</button></div></form></div>}
    {manageOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><section className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-xl"><div className="flex items-center justify-between border-b p-5"><div><h2 className="text-lg font-semibold text-slate-950">Manage Item Masters</h2><p className="text-xs text-slate-500">Delete only unused master values.</p></div><button type="button" onClick={() => setManageOpen(false)} className="rounded-xl border px-3 py-2 text-sm font-semibold">Close</button></div><div className="flex gap-2 border-b px-5 pt-4"><button type="button" onClick={() => setManageTab("type")} className="rounded-t-lg px-3 py-2 text-sm font-semibold">Item Types</button><button type="button" onClick={() => setManageTab("group")} className="rounded-t-lg px-3 py-2 text-sm font-semibold">Item Groups</button><button type="button" onClick={() => setManageTab("uom")} className="rounded-t-lg px-3 py-2 text-sm font-semibold">UOMs</button></div><div className="max-h-[60vh] overflow-y-auto p-5">{manageTab === "type" && allItemTypes.map((item) => <MasterRow key={item.id} label={item.type_name} meta={`${item.type_code} · ${item.status}`} onDelete={() => deleteMaster("type", item)} />)}{manageTab === "group" && allItemGroups.map((item) => <MasterRow key={item.id} label={item.group_name} meta={`${item.group_code} · ${item.status}`} onDelete={() => deleteMaster("group", item)} />)}{manageTab === "uom" && allUoms.map((item) => <MasterRow key={item.id} label={item.uom_name} meta={`${item.uom_code} · ${item.status}`} onDelete={() => deleteMaster("uom", item)} />)}</div></section></div>}
    <section className="rounded-2xl border bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div><h2 className="font-semibold text-slate-950">Item Register</h2><p className="text-xs text-slate-500">{countText}</p></div><div className="flex flex-wrap gap-2"><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code or item" className="h-10 rounded-xl border pl-9 pr-3 text-sm outline-none focus:border-slate-400" /></div><select value={typeId} onChange={(e) => { setTypeId(e.target.value); setGroupId("all"); }} className="h-10 rounded-xl border px-3 text-sm"><option value="all">All Types</option>{itemTypes.map((item) => <option key={item.id} value={item.id}>{item.type_name}</option>)}</select><select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="h-10 rounded-xl border px-3 text-sm"><option value="all">All Groups</option>{filterGroups.map((item) => <option key={item.id} value={item.id}>{item.group_name}</option>)}</select><select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-xl border px-3 text-sm"><option value="all">All Status</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3 text-right">S. No.</th><th className="px-4 py-3">Item Code</th><th className="px-4 py-3">Item</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Group</th><th className="px-4 py-3">UOM</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y">{loading ? <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">Loading items...</td></tr> : items.length === 0 ? <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No items found.</td></tr> : items.map((item, index) => <tr key={item.id}><td className="px-4 py-3 text-right text-slate-500">{index + 1}</td><td className="px-4 py-3 font-mono text-xs">{item.item_code}</td><td className="px-4 py-3"><p className="font-semibold text-slate-950">{item.item_name}</p><p className="text-xs text-slate-500">{item.description || "-"}</p></td><td className="px-4 py-3">{item.item_type?.type_name || "-"}</td><td className="px-4 py-3">{item.item_group?.group_name || item.item_category || "-"}</td><td className="px-4 py-3">{item.default_uom?.uom_code || "-"}</td><td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold capitalize text-slate-700">{item.status}</span></td><td className="px-4 py-3"><div className="flex justify-end gap-2">{canEdit && <button onClick={() => startEdit(item)} className="rounded-lg border p-2 hover:bg-slate-50" aria-label="Edit item"><Pencil className="h-4 w-4" /></button>}{canDelete && <button onClick={() => deleteItem(item)} className="rounded-lg border p-2 text-red-600 hover:bg-red-50" aria-label="Delete item"><Trash2 className="h-4 w-4" /></button>}</div></td></tr>)}</tbody></table></div></section>
  </section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="space-y-1 text-sm font-semibold text-slate-700"><span>{label}</span>{children}</label>; }

function MasterRow({ label, meta, onDelete }: { label: string; meta: string; onDelete: () => void }) { return <div className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0"><div><p className="text-sm font-semibold text-slate-950">{label}</p><p className="text-xs text-slate-500">{meta}</p></div><button type="button" onClick={onDelete} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" />Delete</button></div>; }
