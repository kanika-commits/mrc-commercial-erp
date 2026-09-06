"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, Pencil, Plus, Search, XCircle } from "lucide-react";
import AlertMessage from "@/components/AlertMessage";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import { apiFetch } from "@/components/hr/hrClient";

const emptyForm = { site_id: "", item_id: "", make_name: "", status: "active", sort_order: "0", remarks: "" };

export default function ApprovedMakesPage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const canEdit = can(permissions, "procurement_items", "edit");
  const [lookups, setLookups] = useState<any>({ sites: [], items: [] });
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<any | null>(null);
  const [filters, setFilters] = useState({ search: "", site_id: "all", item_id: "all", status: "all" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");

  async function loadData() {
    setLoading(true);
    setMessage("");
    try {
      const query = new URLSearchParams(filters).toString();
      const [lookupResult, makesResult] = await Promise.all([
        apiFetch("/api/procurement/lookups"),
        apiFetch(`/api/procurement/approved-makes?${query}`),
      ]);
      setLookups(lookupResult);
      setRows(makesResult.approved_makes || []);
    } catch (error: any) {
      setMessage(error.message || "Failed to load approved makes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);
  useEffect(() => { const timer = window.setTimeout(loadData, 350); return () => window.clearTimeout(timer); }, [filters]);

  const activeSites = useMemo(() => (lookups.sites || []).filter((site: any) => site.status === "active"), [lookups]);
  const activeItems = useMemo(() => (lookups.items || []).filter((item: any) => item.status === "active"), [lookups]);
  const countText = `Showing ${rows.length} ${rows.length === 1 ? "Approved Make" : "Approved Makes"}`;

  function startEdit(row: any) {
    setEditing(row);
    setForm({ site_id: row.site_id || "", item_id: row.item_id || "", make_name: row.make_name || "", status: row.status || "active", sort_order: String(row.sort_order || 0), remarks: row.remarks || "" });
    setMessage("");
    setSuccess("");
  }

  function resetForm() {
    setEditing(null);
    setForm(emptyForm);
  }

  async function saveMake(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setSuccess("");
    try {
      await apiFetch(editing ? `/api/procurement/approved-makes/${editing.id}` : "/api/procurement/approved-makes", { method: editing ? "PUT" : "POST", body: JSON.stringify(form) });
      setSuccess(editing ? "Approved make updated." : "Approved make added.");
      resetForm();
      await loadData();
    } catch (error: any) {
      setMessage(error.message || "Failed to save approved make.");
    } finally {
      setSaving(false);
    }
  }

  async function inactivate(row: any) {
    if (!window.confirm(`Inactivate approved make "${row.make_name}"?`)) return;
    try {
      await apiFetch(`/api/procurement/approved-makes/${row.id}`, { method: "DELETE" });
      setSuccess("Approved make inactivated.");
      await loadData();
    } catch (error: any) {
      setMessage(error.message || "Failed to inactivate approved make.");
    }
  }

  return <section className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"><BadgeCheck className="h-3.5 w-3.5" />Master Setup</div><h1 className="text-3xl font-bold text-slate-950">Site Approved Makes</h1><p className="text-sm text-slate-500">Maintain site-wise approved makes for procurement items.</p></div>
      <Link href="/modules/settings" className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"><ArrowLeft className="h-4 w-4" />Back to Settings</Link>
    </header>
    <AlertMessage type="error" message={message} onClose={() => setMessage("")} /><AlertMessage type="success" message={success} onClose={() => setSuccess("")} />
    {canEdit && <form onSubmit={saveMake} className="rounded-2xl border bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold text-slate-950">{editing ? "Edit Approved Make" : "Add Approved Make"}</h2>{editing && <button type="button" onClick={resetForm} className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-slate-50">Cancel</button>}</div><div className="grid gap-4 md:grid-cols-3"><Field label="Site *"><select disabled={Boolean(editing)} value={form.site_id} onChange={(e) => setForm({ ...form, site_id: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm"><option value="">Select Site</option>{activeSites.map((site: any) => <option key={site.id} value={site.id}>{site.site_name}</option>)}</select></Field><Field label="Item *"><select disabled={Boolean(editing)} value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm"><option value="">Select Item</option>{activeItems.map((item: any) => <option key={item.id} value={item.id}>{item.item_code} - {item.item_name}</option>)}</select></Field><Field label="Make Name *"><input value={form.make_name} onChange={(e) => setForm({ ...form, make_name: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field><Field label="Status"><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm"><option value="active">Active</option><option value="inactive">Inactive</option></select></Field><Field label="Sort Order"><input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field><Field label="Remarks"><input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field></div><div className="mt-4 flex justify-end"><button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"><Plus className="h-4 w-4" />{saving ? "Saving..." : editing ? "Update Make" : "Add Make"}</button></div></form>}
    <section className="rounded-2xl border bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div><h2 className="font-semibold text-slate-950">Approved Makes Register</h2><p className="text-xs text-slate-500">{countText}</p></div><div className="flex flex-wrap gap-2"><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Search make, site or item" className="h-10 rounded-xl border pl-9 pr-3 text-sm" /></div><select value={filters.site_id} onChange={(e) => setFilters({ ...filters, site_id: e.target.value })} className="h-10 rounded-xl border px-3 text-sm"><option value="all">All Sites</option>{activeSites.map((site: any) => <option key={site.id} value={site.id}>{site.site_name}</option>)}</select><select value={filters.item_id} onChange={(e) => setFilters({ ...filters, item_id: e.target.value })} className="h-10 rounded-xl border px-3 text-sm"><option value="all">All Items</option>{activeItems.map((item: any) => <option key={item.id} value={item.id}>{item.item_code} - {item.item_name}</option>)}</select><select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="h-10 rounded-xl border px-3 text-sm"><option value="all">All Status</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3 text-right">S. No.</th><th className="px-4 py-3">Site</th><th className="px-4 py-3">Item</th><th className="px-4 py-3">Make</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Remarks</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y">{loading ? <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Loading approved makes...</td></tr> : rows.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No approved makes found.</td></tr> : rows.map((row, index) => <tr key={row.id}><td className="px-4 py-3 text-right text-slate-500">{index + 1}</td><td className="px-4 py-3">{row.site?.site_name || "-"}</td><td className="px-4 py-3"><p className="font-semibold text-slate-950">{row.item?.item_name || "-"}</p><p className="font-mono text-xs text-slate-500">{row.item?.item_code || "-"}</p></td><td className="px-4 py-3 font-semibold">{row.make_name}</td><td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold capitalize text-slate-700">{row.status}</span></td><td className="px-4 py-3">{row.remarks || "-"}</td><td className="px-4 py-3"><div className="flex justify-end gap-2">{canEdit && <button onClick={() => startEdit(row)} className="rounded-lg border p-2 hover:bg-slate-50" aria-label="Edit approved make"><Pencil className="h-4 w-4" /></button>}{canEdit && row.status !== "inactive" && <button onClick={() => inactivate(row)} className="rounded-lg border p-2 text-red-600 hover:bg-red-50" aria-label="Inactivate approved make"><XCircle className="h-4 w-4" /></button>}</div></td></tr>)}</tbody></table></div></section>
  </section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="space-y-1 text-sm font-semibold text-slate-700"><span>{label}</span>{children}</label>; }
