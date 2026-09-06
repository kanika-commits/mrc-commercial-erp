"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Eye, FileText, Pencil, Plus, Search, Trash2 } from "lucide-react";
import AlertMessage from "@/components/AlertMessage";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import { apiFetch, formatDate, labelize } from "@/components/hr/hrClient";

export default function RequisitionsPage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const canAdd = can(permissions, "purchase_requisitions", "add");
  const canEdit = can(permissions, "purchase_requisitions", "edit");
  const canDelete = can(permissions, "purchase_requisitions", "delete");
  const [rows, setRows] = useState<any[]>([]);
  const [lookups, setLookups] = useState<any>({ companies: [], sites: [] });
  const [filters, setFilters] = useState({ search: "", company_id: "", site_id: "", status: "all", approval_status: "all" });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true); setMessage("");
    try {
      const params = new URLSearchParams(filters as any);
      const [result, lookupResult] = await Promise.all([apiFetch(`/api/procurement/requisitions?${params.toString()}`), apiFetch("/api/procurement/lookups")]);
      setRows(result.requisitions || []);
      setLookups(lookupResult);
    } catch (error: any) { setMessage(error.message || "Failed to load requisitions."); } finally { setLoading(false); }
  }
  useEffect(() => { const timer = window.setTimeout(load, 250); return () => window.clearTimeout(timer); }, [filters]);

  async function deleteRow(row: any) {
    setDeleteTarget(row);
    setDeleteReason("");
  }
  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true); setMessage("");
    try { await apiFetch(`/api/procurement/requisitions/${deleteTarget.id}`, { method: "DELETE", body: JSON.stringify({ reason: deleteReason }) }); setDeleteTarget(null); setDeleteReason(""); await load(); } catch (error: any) { setMessage(error.message || "Failed to delete requisition."); } finally { setDeleting(false); }
  }

  const countText = `Showing ${rows.length} ${rows.length === 1 ? "Requisition" : "Requisitions"}`;
  const sites = useMemo(() => (lookups.sites || []).filter((site: any) => !filters.company_id || site.organization_id === (lookups.companies || []).find((c: any) => c.id === filters.company_id)?.organization_id), [filters.company_id, lookups]);

  return <section className="space-y-6"><header className="flex flex-wrap items-center justify-between gap-4"><div><div className="mb-2 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700"><FileText className="h-3.5 w-3.5" />Purchase</div><h1 className="text-3xl font-bold text-slate-950">Purchase Requisitions</h1><p className="text-sm text-slate-500">Register site and HQ material requirements before procurement starts.</p></div>{canAdd && <Link href="/purchase/requisitions/new" className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"><Plus className="h-4 w-4" />New Requisition</Link>}</header><AlertMessage type="error" message={message} onClose={() => setMessage("")} />
    <section className="rounded-2xl border bg-white shadow-sm"><div className="border-b p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-950">Requisition Register</h2><p className="text-xs text-slate-500">{countText}</p></div><div className="flex flex-wrap gap-2"><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Search PR No." className="h-10 rounded-xl border pl-9 pr-3 text-sm" /></div><select value={filters.company_id} onChange={(e) => setFilters({ ...filters, company_id: e.target.value, site_id: "" })} className="h-10 rounded-xl border px-3 text-sm"><option value="">All Companies</option>{(lookups.companies || []).map((company: any) => <option key={company.id} value={company.id}>{company.company_name}</option>)}</select><select value={filters.site_id} onChange={(e) => setFilters({ ...filters, site_id: e.target.value })} className="h-10 rounded-xl border px-3 text-sm"><option value="">All Sites</option>{sites.map((site: any) => <option key={site.id} value={site.id}>{site.site_name}</option>)}</select><select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="h-10 rounded-xl border px-3 text-sm"><option value="all">All Status</option><option value="draft">Draft</option><option value="pending_approval">Pending Approval</option><option value="sent_back">Sent Back</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></div></div></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3 text-right">S. No.</th><th className="px-4 py-3">PR No.</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Company</th><th className="px-4 py-3">Site</th><th className="px-4 py-3">Entered By</th><th className="px-4 py-3">Required Window</th><th className="px-4 py-3">Items</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y">{loading ? <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-500">Loading requisitions...</td></tr> : rows.length === 0 ? <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-500">No requisitions found.</td></tr> : rows.map((row, index) => <tr key={row.id}><td className="px-4 py-3 text-right text-slate-500">{index + 1}</td><td className="px-4 py-3 font-semibold text-slate-950">{row.requisition_number}</td><td className="px-4 py-3">{formatDate(row.requisition_date)}</td><td className="px-4 py-3">{row.company?.company_name || "-"}</td><td className="px-4 py-3">{row.site?.site_name || "-"}</td><td className="px-4 py-3">{row.requested_by_name || "-"}</td><td className="px-4 py-3">{requiredWindow(row.items, row.required_by_date)}</td><td className="px-4 py-3">{row.items?.length || 0}</td><td className="max-w-[360px] px-4 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{row.workflow_display_status || labelize(row.status)}</span>{row.workflow_display_detail && <p className="mt-1 text-xs text-slate-500">{row.workflow_display_detail}</p>}<LineWorkflowDetails lines={row.workflow_line_details || []} /></td><td className="px-4 py-3"><div className="flex justify-end gap-2"><Link href={`/purchase/requisitions/${row.id}`} className="rounded-lg border p-2 hover:bg-slate-50"><Eye className="h-4 w-4" /></Link>{canEdit && ["draft", "sent_back"].includes(row.status) && <Link href={`/purchase/requisitions/${row.id}/edit`} className="rounded-lg border p-2 hover:bg-slate-50"><Pencil className="h-4 w-4" /></Link>}{canDelete && <button onClick={() => deleteRow(row)} className="rounded-lg border p-2 text-red-600 hover:bg-red-50" title="Delete requisition"><Trash2 className="h-4 w-4" /></button>}</div></td></tr>)}</tbody></table></div></section>{deleteTarget && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-label="Delete requisition"><div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><h2 className="text-lg font-bold text-slate-950">Delete {deleteTarget.requisition_number}?</h2><p className="mt-2 text-sm text-slate-600">This action will remove the Indent from active Purchase workflows. It cannot be deleted if downstream procurement has already started.</p><label className="mt-4 block text-sm font-semibold text-slate-700">Reason for deletion *<textarea value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} rows={4} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" placeholder="Enter a meaningful reason" /></label><div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => { setDeleteTarget(null); setDeleteReason(""); }} disabled={deleting} className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60">Cancel</button><button type="button" onClick={confirmDelete} disabled={deleting || deleteReason.trim().length < 10} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">Delete Requisition</button></div></div></div>}</section>;
}

function requiredWindow(items: any[] = [], fallback?: string) { const dates = items.map((item) => item.required_by_date).filter(Boolean).sort(); if (!dates.length) return fallback ? formatDate(fallback) : "—"; return dates[0] === dates[dates.length - 1] ? formatDate(dates[0]) : `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}`; }
function LineWorkflowDetails({ lines }: { lines: any[] }) {
  if (!lines.length) return null;
  return <div className="mt-2 space-y-1">{lines.map((line) => <div key={line.line_key} className="text-xs leading-snug text-slate-600"><p className="flex min-w-0 items-center gap-2"><span className="min-w-0 truncate font-medium text-slate-700" title={line.item_name}>{line.item_name || "Material line"}</span><span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${lineStatusBadgeClass(line.status)}`}>{line.status}</span></p>{line.detail && <p className="truncate text-[11px] text-slate-500" title={line.detail}>{line.detail}</p>}</div>)}</div>;
}
function lineStatusBadgeClass(status: string) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "approved") return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  if (normalized.startsWith("level")) return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
  if (normalized === "sent back") return "bg-sky-50 text-sky-700 ring-1 ring-sky-200";
  if (normalized === "rejected") return "bg-red-50 text-red-700 ring-1 ring-red-200";
  return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
}
