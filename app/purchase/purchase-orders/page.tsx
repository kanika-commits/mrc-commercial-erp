"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Eye, ExternalLink, Plus, RotateCcw, Search, Trash2, TriangleAlert, Upload } from "lucide-react";
import { apiFetch } from "@/components/hr/hrClient";

function sourceLabel(value: string) {
  return value === "indent" ? "Material Indent" : "Direct Purchase";
}

function statusLabel(value: unknown) {
  return String(value || "unknown").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClass(value: unknown) {
  switch (String(value || "").toLowerCase()) {
    case "draft": return "border-slate-200 bg-slate-50 text-slate-700";
    case "pending_approval": return "border-amber-200 bg-amber-50 text-amber-800";
    case "approved": return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "sent_back": return "border-blue-200 bg-blue-50 text-blue-800";
    case "rejected": return "border-rose-200 bg-rose-50 text-rose-800";
    case "issued": return "border-indigo-200 bg-indigo-50 text-indigo-800";
    default: return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("error");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ company: "", site: "", vendor: "", status: "", source: "", from: "", to: "" });
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch = !needle || [row.po_number, row.vendor_name_snapshot, row.source_requisition_number_snapshot, row.company?.company_name, row.site?.site_name, sourceLabel(row.source_type), ...(row.items || []).map((item: any) => `${item.item_code_snapshot || ""} ${item.item_name_snapshot || ""}`)].join(" ").toLowerCase().includes(needle);
      const vendorKey = row.vendor_id || row.vendor_name_snapshot || "";
      return matchesSearch && (!filters.company || row.company_id === filters.company) && (!filters.site || row.site_id === filters.site) && (!filters.vendor || vendorKey === filters.vendor) && (!filters.status || row.status === filters.status) && (!filters.source || row.source_type === filters.source) && (!filters.from || String(row.po_date || "") >= filters.from) && (!filters.to || String(row.po_date || "") <= filters.to);
    });
  }, [rows, search, filters]);

  const companies = useMemo(() => [...new Map(rows.filter((row) => row.company_id && row.company?.company_name).map((row) => [row.company_id, row.company.company_name])).entries()], [rows]);
  const sites = useMemo(() => [...new Map(rows.filter((row) => row.site_id && row.site?.site_name).map((row) => [row.site_id, row.site.site_name])).entries()], [rows]);
  const vendors = useMemo(() => [...new Map<string, string>(rows.map((row) => [String(row.vendor_id || row.vendor_name_snapshot || ""), String(row.vendor_name_snapshot || "")] as [string, string]).filter(([key, value]) => key && value)).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const statuses = ["draft", "pending_approval", "approved", "issued", "sent_back", "rejected"];
  const sources = ["direct", "indent"];
  const hasFilters = Object.values(filters).some(Boolean);
  function setFilter(name: keyof typeof filters, value: string) { setFilters((current) => ({ ...current, [name]: value })); }
  function controlClass(active: boolean) { return "h-10 w-full rounded-lg border px-3 text-sm outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-100 " + (active ? "border-amber-300 bg-amber-50/70 text-slate-950" : "border-slate-200 bg-white text-slate-700"); }

  async function refreshRows() { const result = await apiFetch("/api/procurement/purchase-orders"); setRows(result.purchase_orders || []); }
  useEffect(() => { refreshRows().catch((error) => setMessage(error.message || "Failed to load Purchase Orders.")); }, []);
  async function uploadSignedPo(row: any, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    setMessage("");
    try { const form = new FormData(); form.set("file", file); form.set("document_type", "signed_po"); await apiFetch(`/api/procurement/purchase-orders/${row.id}/documents`, { method: "POST", body: form }); await refreshRows(); setMessageKind("success"); setMessage(`${row.signed_po_document ? "Vendor Acceptance replaced" : "Vendor Acceptance received"} for ${row.po_number}.`); }
    catch (error: any) { setMessageKind("error"); setMessage(error.message || "Failed to upload signed PO."); }
  }
  useEffect(() => { if (searchParams.get("message") !== "submitted") return; setMessageKind("success"); setMessage("Purchase Order submitted for approval successfully."); router.replace(pathname, { scroll: false }); }, [pathname, router, searchParams]);
  async function deleteDraft() { if (!deleteTarget) return; setDeleting(true); setMessage(""); try { await apiFetch(`/api/procurement/purchase-orders/${deleteTarget.id}`, { method: "DELETE" }); setRows((current) => current.filter((row) => row.id !== deleteTarget.id)); setDeleteTarget(null); setMessageKind("success"); setMessage("Draft Purchase Order deleted."); } catch (error: any) { setMessageKind("error"); setMessage(error.message || "Failed to delete draft Purchase Order."); } finally { setDeleting(false); } }

  return <section className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase text-amber-700">Purchase</p><h1 className="text-3xl font-bold text-slate-950">Purchase Orders</h1><p className="text-sm text-slate-500">Create and manage Purchase Orders from Direct Purchase or Material Indent.</p></div><Link href="/purchase/purchase-orders/new" className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" />New Purchase Order</Link></header>
    {message && <div className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-sm ${messageKind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}><span>{message}</span><button type="button" onClick={() => setMessage("")} aria-label="Dismiss notification" className="text-lg leading-none">×</button></div>}
    <section className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2"><Search className="h-4 w-4 text-amber-700" /><p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Search Purchase Orders</p></div>
        {hasFilters && <button type="button" onClick={() => { setSearch(""); setFilters({ company: "", site: "", vendor: "", status: "", source: "", from: "", to: "" }); }} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-amber-300 hover:bg-amber-50"><RotateCcw className="h-3.5 w-3.5" />Clear Filters</button>}
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(300px,1.6fr)_repeat(3,minmax(150px,1fr))]">
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Search<div className="relative mt-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search PO, vendor, indent, site or material" className={"h-10 w-full rounded-lg border bg-white pl-9 pr-3 text-sm outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-100 " + (search.trim() ? "border-amber-300 bg-amber-50/70" : "border-slate-200")} /></div></label>
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Company<select value={filters.company} onChange={(event) => setFilter("company", event.target.value)} aria-label="Filter by company" className={"mt-1 " + controlClass(Boolean(filters.company))}><option value="">All Companies</option>{companies.map(([id, name]) => <option key={String(id)} value={String(id)}>{String(name)}</option>)}</select></label>
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Site<select value={filters.site} onChange={(event) => setFilter("site", event.target.value)} aria-label="Filter by site" className={"mt-1 " + controlClass(Boolean(filters.site))}><option value="">All Sites</option>{sites.map(([id, name]) => <option key={String(id)} value={String(id)}>{String(name)}</option>)}</select></label>
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Vendor<select value={filters.vendor} onChange={(event) => setFilter("vendor", event.target.value)} aria-label="Filter by vendor" className={"mt-1 " + controlClass(Boolean(filters.vendor))}><option value="">All Vendors</option>{vendors.map(([id, name]) => <option key={String(id)} value={String(id)}>{String(name)}</option>)}</select></label>
      </div>
      <div className="mt-4 border-t border-slate-200 pt-3">
        <div className="mb-2 flex items-center gap-2"><span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Filters</span><span className="text-slate-300">/</span><CalendarDays className="h-3.5 w-3.5 text-slate-400" /><span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Date Range</span></div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-[minmax(150px,1fr)_minmax(150px,1fr)_minmax(260px,1.5fr)_auto]">
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">PO Status<select value={filters.status} onChange={(event) => setFilter("status", event.target.value)} aria-label="Filter by PO status" className={"mt-1 " + controlClass(Boolean(filters.status))}><option value="">All PO Statuses</option>{statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Source<select value={filters.source} onChange={(event) => setFilter("source", event.target.value)} aria-label="Filter by source" className={"mt-1 " + controlClass(Boolean(filters.source))}><option value="">All Sources</option>{sources.map((source) => <option key={source} value={source}>{sourceLabel(source)}</option>)}</select></label>
          <fieldset className="min-w-0"><legend className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Date Range</legend><div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2"><input type="date" value={filters.from} onChange={(event) => setFilter("from", event.target.value)} aria-label="From date" title="From date" className={controlClass(Boolean(filters.from))} /><span className="text-sm font-semibold text-slate-400">→</span><input type="date" value={filters.to} onChange={(event) => setFilter("to", event.target.value)} aria-label="To date" title="To date" className={controlClass(Boolean(filters.to))} /></div></fieldset>
          {hasFilters && <button type="button" onClick={() => { setSearch(""); setFilters({ company: "", site: "", vendor: "", status: "", source: "", from: "", to: "" }); }} className="h-10 self-end rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-amber-300 hover:bg-amber-50 lg:mb-0">Clear</button>}
        </div>
      </div>
    </section>
    <section className="overflow-x-auto rounded-2xl border bg-white shadow-sm"><table className="w-full min-w-[1350px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-4">S.No.</th><th className="p-4">PO Number</th><th className="p-4">PO Date</th><th className="p-4">Company</th><th className="p-4">Site</th><th className="p-4">Vendor</th><th className="p-4">Source</th><th className="p-4">Amount</th><th className="p-4">Status</th><th className="p-4">Action</th><th className="p-4">SIGNED PO</th></tr></thead><tbody className="divide-y">{filtered.length === 0 ? <tr><td colSpan={11} className="p-8 text-center text-slate-500">No Purchase Orders found.</td></tr> : filtered.map((row, index) => <tr key={row.id}><td className="p-4">{index + 1}</td><td className="p-4 font-semibold">{row.po_number}</td><td className="p-4">{row.po_date}</td><td className="p-4">{row.company?.company_name || "—"}</td><td className="p-4">{row.site?.site_name || "—"}</td><td className="p-4">{row.vendor_name_snapshot}</td><td className="p-4">{sourceLabel(row.source_type)}</td><td className="p-4 font-semibold">₹ {Number(row.total_amount || 0).toLocaleString("en-IN")}</td><td className="p-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(row.status)}`}>{statusLabel(row.status)}</span></td><td className="p-4"><div className="flex items-center gap-2 whitespace-nowrap"><Link href={`/purchase/purchase-orders/${row.id}`} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border p-2" title="Open Purchase Order"><Eye className="h-4 w-4" /></Link>{row.status === "draft" && <button type="button" onClick={() => setDeleteTarget(row)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 p-2 text-red-700" title="Delete Draft Purchase Order"><Trash2 className="h-4 w-4" /></button>}</div></td><td className="p-4">{!["approved", "issued"].includes(row.status) ? <span className="text-slate-400">—</span> : <div className="flex items-center gap-2 whitespace-nowrap">{row.signed_po_document ? <><span className="font-semibold text-emerald-700">Vendor Acceptance Received</span><a href={row.signed_po_document.signed_url || "#"} target="_blank" rel="noreferrer" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border p-2" title="View Vendor Acceptance"><ExternalLink className="h-4 w-4" /></a><label className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border p-2" title="Replace Vendor Acceptance"><Upload className="h-4 w-4" /><input type="file" className="hidden" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => void uploadSignedPo(row, event)} /></label></> : <div className="flex flex-col items-start gap-1.5"><span className="inline-flex items-center gap-1 font-semibold text-amber-700"><TriangleAlert className="h-3.5 w-3.5" />Vendor Acceptance Pending</span><label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800" title="Upload Vendor Acceptance"><Upload className="h-3.5 w-3.5" />Upload<input type="file" className="hidden" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => void uploadSignedPo(row, event)} /></label></div>}</div>}</td></tr>)}</tbody></table></section>
    {deleteTarget && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 className="text-lg font-bold">Delete this draft Purchase Order?</h2><p className="mt-3 text-sm text-slate-600">This will permanently remove the draft. Any Material Indent quantities reserved by this draft will become available again.</p><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setDeleteTarget(null)} disabled={deleting} className="rounded-lg border px-4 py-2 text-sm font-semibold">Cancel</button><button type="button" onClick={() => void deleteDraft()} disabled={deleting} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white">{deleting ? "Deleting..." : "Delete Draft"}</button></div></div></div>}
  </section>;
}
