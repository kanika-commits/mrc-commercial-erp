"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Eye, Pencil } from "lucide-react";
import AlertMessage from "@/components/AlertMessage";
import ApprovalLineEditDialog from "@/components/procurement/ApprovalLineEditDialog";
import RequisitionActivityPanel from "@/components/procurement/RequisitionActivityPanel";
import { apiFetch, formatDate, labelize } from "@/components/hr/hrClient";
import { useAccessContext } from "@/components/AccessContext";
import { hasGlobalAccess } from "@/lib/accessControl";

export default function RequisitionApprovalsPage() {
  const { access } = useAccessContext();
  const canViewAll = Boolean(access && (hasGlobalAccess(access) || access.roleCodes.includes("super_admin")));
  const [rows, setRows] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedLines, setSelectedLines] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [editingSelected, setEditingSelected] = useState(false);
  async function load() {
    setLoading(true); setMessage("");
    try {
      const result = await apiFetch(`/api/procurement/requisitions?status=pending_approval&queue=${canViewAll ? "all" : "my_current"}`);
      const nextRows = result.requisitions || [];
      setRows(nextRows);
      setSelectedId((current) => nextRows.some((row: any) => row.id === current) ? current : "");
      setSelectedLines([]);
      setEditingSelected(false);
    } catch (error: any) { setMessage(error.message || "Failed to load approvals."); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [canViewAll]);
  const selected = useMemo(() => rows.find((row) => row.id === selectedId), [rows, selectedId]);
  const actionable = selected?.line_workflow_initialized ? (selected?.items || []).filter((item: any) => item.line_actionable) : (selected?.items || []).filter((item: any) => item.line_actionable);
  const selectedSet = new Set(selectedLines);
  const selectedActionableLines = selectedLines.filter((key) => actionable.some((item: any) => item.line_key === key));
  const allSelected = actionable.length > 0 && actionable.every((item: any) => selectedSet.has(item.line_key));
  async function approve() {
    if (!selected || !selectedActionableLines.length) return;
    try { setMessage(""); setSuccess(""); await apiFetch(`/api/procurement/requisitions/${selected.id}/approve`, { method: "POST", body: JSON.stringify({ line_keys: selectedActionableLines }) }); setSuccess("Selected material lines approved."); await load(); }
    catch (error: any) { setMessage(error.message || "Failed to update approval."); }
  }
  function toggleAll() { setSelectedLines(allSelected ? [] : actionable.map((item: any) => item.line_key)); }
  function toggleLine(lineKey: string) {
    if (!actionable.some((item: any) => item.line_key === lineKey)) return;
    setSelectedLines((current) => current.includes(lineKey) ? current.filter((key) => key !== lineKey) : [...current, lineKey]);
  }
  function editSelected() {
    if (!selected || !selectedLines.length) return;
    const actionableKeys = new Set(actionable.map((item: any) => item.line_key));
    const editableKeys = selectedLines.filter((key) => actionableKeys.has(key));
    if (editableKeys.length !== selectedLines.length) {
      setMessage("Only material lines currently pending with you can be edited.");
      setSelectedLines(editableKeys);
      return;
    }
    setEditingSelected(true);
  }
  const selectedHasNextLayer = selectedActionableLines.some((key) => Boolean((selected?.items || []).find((item: any) => item.line_key === key)?.line_has_next_layer));
  return <section className="space-y-6"><header className="flex flex-wrap items-center justify-between gap-4"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Purchase</p><h1 className="text-3xl font-bold text-slate-950">Indent Approval</h1><p className="text-sm text-slate-500">Review submitted material requirements.</p></div><Link href="/purchase/requisitions" className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">Requisition Register</Link></header><AlertMessage type="error" message={message} onClose={() => setMessage("")} /><AlertMessage type="success" message={success} onClose={() => setSuccess("")} /><ApprovalLineEditDialog open={editingSelected} requisition={selected} selectedLineKeys={selectedLines} onClose={() => setEditingSelected(false)} onSaved={async () => { setEditingSelected(false); setSuccess("Selected material lines updated."); await load(); }} /><div className="grid min-w-0 gap-5 xl:grid-cols-[380px_minmax(0,1fr)]"><section className="min-w-0 rounded-2xl border bg-white shadow-sm"><div className="border-b p-4"><h2 className="font-semibold text-slate-950">Approval Queue</h2><p className="mt-1 text-sm font-semibold text-slate-700">My Current Indents</p><p className="mt-2 text-xs text-slate-500">Showing {rows.length} Indents</p></div><div className="divide-y">{loading ? <p className="p-4 text-sm text-slate-500">Loading...</p> : rows.length === 0 ? <p className="p-4 text-sm text-slate-500">No requisitions found.</p> : rows.map((row, index) => <button key={row.id} onClick={() => { setSelectedId(row.id); setSelectedLines([]); }} className={`block w-full p-4 text-left hover:bg-slate-50 ${selectedId === row.id ? "bg-sky-50" : ""}`}><div className="flex justify-between gap-3"><p className="font-semibold text-slate-950">{index + 1}. {row.requisition_number}</p><span className="text-xs font-semibold text-slate-500">{row.line_workflow_initialized ? `${row.actionable_line_count || 0} lines pending with you` : `${row.items?.length || 0} materials`}</span></div><p className="mt-1 text-xs text-slate-500">{row.site?.site_name || "-"} / {formatDate(row.requisition_date)}</p><p className="mt-2 text-xs text-slate-500">{requiredWindow(row.items, row.required_by_date)}</p></button>)}</div></section><section className="min-w-0 rounded-2xl border bg-white shadow-sm">{!selected ? <p className="p-6 text-sm text-slate-500">Select an Indent to review its material lines.</p> : <div className="min-w-0"><div className="border-b p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-bold text-slate-950">{selected.requisition_number}</h2><p className="text-sm text-slate-500">{selected.company?.company_name || "-"} / {selected.site?.site_name || "-"}</p></div><div className="flex gap-2"><Link href={`/purchase/requisitions/${selected.id}?from=approval`} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-slate-50"><Eye className="h-4 w-4" />Open Detail</Link></div></div></div><div className="grid gap-4 p-5 md:grid-cols-4"><Info label="Status" value={selected.line_workflow_initialized ? "Line-level approval" : labelize(selected.status)} /><Info label="Entered By" value={selected.requested_by_name || "-"} /><Info label="Requisition Date" value={formatDate(selected.requisition_date)} /><Info label="Items" value={String(selected.total_item_count || selected.items?.length || 0)} /></div><div className="min-w-0 px-5 pb-5"><div className="mt-5 overflow-x-auto rounded-xl border"><table className="min-w-[1120px] w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2"><input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={!actionable.length} aria-label="Select all actionable lines" /></th><th className="px-3 py-2 text-right">S. No.</th><th className="px-3 py-2">Item</th><th className="px-3 py-2">Specification</th><th className="px-3 py-2">Approved Makes</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2">UOM</th><th className="px-3 py-2">Requested By</th><th className="px-3 py-2">Required By</th><th className="px-3 py-2">Attachments</th><th className="px-3 py-2">Line Status</th></tr></thead><tbody className="divide-y">{(selected.items || []).map((item: any, index: number) => { const makes = (item.approved_makes || []).slice().sort((a: any, b: any) => Number(a.sort_order || 0) - Number(b.sort_order || 0)).map((make: any) => make.make_name_snapshot).filter(Boolean); const state = item.line_approval_state; const step = item.current_line_approval_step; const status = !state ? "Legacy workflow" : state.approval_status === "approved" ? "Approved" : `Pending — ${step?.stage_name || `Level ${state.current_approval_layer}`}`; return <tr key={item.line_key || item.id}><td className="px-3 py-2"><input type="checkbox" checked={selectedSet.has(item.line_key)} onChange={() => toggleLine(item.line_key)} disabled={!item.line_actionable} aria-label={`Select ${item.item_name_snapshot}`} /></td><td className="px-3 py-2 text-right text-slate-500">{index + 1}</td><td className="px-3 py-2"><p className="font-semibold text-slate-950">{item.item_name_snapshot}</p><p className="font-mono text-xs text-slate-500">{item.item_code_snapshot}</p></td><td className="px-3 py-2">{item.specification || "-"}</td><td className="px-3 py-2">{makes.length ? makes.join(", ") : item.make_brand || "-"}</td><td className="px-3 py-2 text-right">{item.quantity}</td><td className="px-3 py-2">{item.uom_snapshot || "-"}</td><td className="px-3 py-2">{item.requested_by_name_snapshot || "Not recorded"}</td><td className="px-3 py-2">{formatDate(item.required_by_date)}</td><td className="px-3 py-2"><LineAttachments requisitionId={selected.id} documents={item.line_attachments || []} onError={setMessage} /></td><td className="px-3 py-2 text-xs font-semibold text-slate-600">{status}</td></tr>; })}</tbody></table></div><div className="mt-5 flex justify-end gap-2">{selected.line_workflow_initialized ? <><button onClick={editSelected} disabled={!selectedLines.length} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50"><Pencil className="h-4 w-4" />Edit Selected</button><button onClick={approve} disabled={!selectedLines.length} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><CheckCircle2 className="h-4 w-4" />{selectedLines.some((key) => (selected.items || []).find((item: any) => item.line_key === key)?.line_has_next_layer) ? "Approve & Forward Selected" : "Approve Selected"}</button></> : selected.can_act && <button onClick={approve} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white"><CheckCircle2 className="h-4 w-4" />Approve</button>}</div><div className="mt-5"><RequisitionActivityPanel requisitionId={selected.id} /></div></div></div>}</section></div></section>;
}
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-slate-950">{value}</p></div>; }
function requiredWindow(items: any[] = [], fallback?: string) { const dates = items.map((item) => item.required_by_date).filter(Boolean).sort(); if (!dates.length) return fallback ? formatDate(fallback) : "—"; return dates[0] === dates[dates.length - 1] ? formatDate(dates[0]) : `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}`; }

function LineAttachments({ requisitionId, documents, onError }: { requisitionId: string; documents: any[]; onError: (message: string) => void }) {
  if (!documents.length) return <span className="text-slate-400">—</span>;
  async function openDocument(documentId: string) {
    try {
      const result = await apiFetch(`/api/procurement/requisitions/${requisitionId}/documents?document_id=${encodeURIComponent(documentId)}`);
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (error: any) {
      onError(error.message || "Failed to open attachment.");
    }
  }
  return <div className="max-w-[220px] space-y-1">{documents.map((document: any) => <button type="button" key={document.id} onClick={() => openDocument(document.id)} className="block max-w-full truncate text-left text-xs font-semibold text-slate-700 underline decoration-slate-300 underline-offset-2 hover:text-slate-950" title={document.original_file_name}>{document.original_file_name}</button>)}</div>;
}
