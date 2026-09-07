"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AlertMessage from "@/components/AlertMessage";
import { apiFetch } from "@/components/hr/hrClient";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";

const empty = { site_id: "", contact_name: "", designation: "", mobile: "", email: "", contact_type: "other", is_default: false, status: "active" };

export default function SiteContacts() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const readable = access?.roleCodes?.includes("platform_owner") || can(permissions, "procurement_site_contact_master", "view");
  const writable = access?.roleCodes?.includes("platform_owner") || can(permissions, "procurement_site_contact_master", "add") || can(permissions, "procurement_site_contact_master", "edit");
  const [rows, setRows] = useState<any[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [form, setForm] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const [contacts, masters] = await Promise.all([
      apiFetch("/api/procurement/purchase-orders/site-contacts"),
      apiFetch("/api/procurement/purchase-orders/master-data"),
    ]);
    setRows(contacts.contacts || []);
    setSites(masters.sites || []);
  };

  useEffect(() => { void load().catch((nextError) => setError(nextError.message || "Failed to load site contacts.")); }, []);
  if (!readable) return <main className="space-y-4"><Link href="/modules/settings" className="text-sm font-semibold text-slate-600">Back to Masters</Link><p className="rounded border bg-white p-5 text-sm text-slate-600">You do not have permission to view Site Contact Master.</p></main>;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await apiFetch("/api/procurement/purchase-orders/site-contacts", { method: form.id ? "PUT" : "POST", body: JSON.stringify(form) });
      setForm(null);
      setMessage("Site contact saved successfully.");
      await load();
    } catch (nextError: any) {
      setError(nextError.message || "Failed to save site contact.");
    }
  };

  const lifecycle = async (row: any, active: boolean, makeDefault = false) => {
    try {
      await apiFetch("/api/procurement/purchase-orders/site-contacts", { method: "PUT", body: JSON.stringify({ ...row, status: active ? "active" : "inactive", is_default: makeDefault || (active && row.is_default) }) });
      setMessage(active ? (makeDefault ? "Site contact made default." : "Site contact activated.") : "Site contact deactivated.");
      await load();
    } catch (nextError: any) {
      setError(nextError.message || "Could not update site contact.");
    }
  };

  const grouped = sites
    .map((site) => ({ site, contacts: rows.filter((row) => row.site_id === site.id) }))
    .filter((group) => group.contacts.length > 0);
  const unlisted = rows.filter((row) => !sites.some((site) => site.id === row.site_id));
  const groups = [...grouped, ...(unlisted.length ? [{ site: { id: "unlisted", site_name: "Other Sites" }, contacts: unlisted }] : [])];

  return <main className="space-y-6">
    <Link href="/modules/settings" className="text-sm font-semibold text-slate-600">Back to Masters</Link>
    <header><h1 className="mt-2 text-3xl font-bold">Site Contact Master</h1><p className="mt-1 text-sm text-slate-500">Manage multiple operational contacts for each site.</p></header>
    <AlertMessage type="success" message={message} onClose={() => setMessage("")} />
    <AlertMessage type="error" message={error} onClose={() => setError("")} />
    {!form && writable && <button type="button" onClick={() => setForm({ ...empty })} className="rounded bg-slate-950 px-4 py-2 text-sm font-semibold text-white">+ Add Site Contact</button>}
    {form && writable && <form onSubmit={save} className="max-w-3xl space-y-4 rounded border bg-white p-5">
      <h2 className="font-semibold">{form.id ? "Edit" : "Add"} Site Contact</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-semibold">Site<select required value={form.site_id} onChange={(event) => setForm({ ...form, site_id: event.target.value })} className="mt-1 h-10 w-full rounded border px-3"><option value="">Select site</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.site_name}</option>)}</select></label>
        <label className="text-sm font-semibold">Contact Name<input required value={form.contact_name || ""} onChange={(event) => setForm({ ...form, contact_name: event.target.value })} className="mt-1 h-10 w-full rounded border px-3" /></label>
        <label className="text-sm font-semibold">Designation<input required value={form.designation || ""} onChange={(event) => setForm({ ...form, designation: event.target.value })} className="mt-1 h-10 w-full rounded border px-3" /></label>
        <label className="text-sm font-semibold">Mobile<input required value={form.mobile || ""} onChange={(event) => setForm({ ...form, mobile: event.target.value })} className="mt-1 h-10 w-full rounded border px-3" /></label>
        <label className="text-sm font-semibold">Email<input required type="email" value={form.email || ""} onChange={(event) => setForm({ ...form, email: event.target.value })} className="mt-1 h-10 w-full rounded border px-3" /></label>
      </div>
      <div className="flex gap-2"><button className="rounded bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Save</button><button type="button" onClick={() => setForm(null)} className="rounded border px-4 py-2 text-sm">Cancel</button></div>
    </form>}
    {!form && <div className="space-y-4">
      {groups.length === 0 && <div className="rounded border bg-white p-5 text-sm text-slate-500">No site contacts configured.</div>}
      {groups.map((group) => <section key={group.site.id} className="rounded border bg-white">
        <div className="border-b bg-slate-50 px-4 py-3"><h2 className="font-semibold">{group.site.site_name}</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr>{["Contact", "Designation", "Mobile", "Email", "Default", "Status", "Actions"].map((heading) => <th key={heading} className="p-3">{heading}</th>)}</tr></thead>
            <tbody>{group.contacts.map((row) => <tr key={row.id} className="border-t">
              <td className="p-3 font-semibold">{row.contact_name}</td>
              <td className="p-3">{row.designation || "—"}</td>
              <td className="p-3">{row.mobile || "—"}</td>
              <td className="p-3">{row.email || "—"}</td>
              <td className="p-3">{row.is_default ? "Default" : "—"}</td>
              <td className="p-3">{row.status}</td>
              <td className="p-3"><div className="flex flex-wrap gap-3"><button type="button" onClick={() => setForm({ ...empty, ...row })} className="underline">Edit</button>{row.status === "active" && !row.is_default && <button type="button" onClick={() => void lifecycle(row, true, true)} className="underline">Make Default</button>}{row.status === "active" ? <button type="button" onClick={() => void lifecycle(row, false)} className="text-red-700 underline">Deactivate</button> : <button type="button" onClick={() => void lifecycle(row, true)} className="underline">Activate</button>}</div></td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>)}
    </div>}
  </main>;
}
