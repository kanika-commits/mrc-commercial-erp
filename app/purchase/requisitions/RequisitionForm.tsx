"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Plus, Trash2, X } from "lucide-react";
import AlertMessage from "@/components/AlertMessage";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import { apiFetch } from "@/components/hr/hrClient";

type Line = { line_key: string; item_id: string; specification: string; purpose: string; approved_makes: string[]; uom_id: string; quantity: string; requested_by_employee_id: string; requested_by_name_snapshot: string; required_by_date: string; remarks: string; pending_files: File[] };
const blankLine: Line = { line_key: "", item_id: "", specification: "", purpose: "", approved_makes: [], uom_id: "", quantity: "", requested_by_employee_id: "", requested_by_name_snapshot: "", required_by_date: "", remarks: "", pending_files: [] };
const emptyForm = { requisition_date: new Date().toISOString().slice(0, 10), company_id: "", site_id: "" };

export default function RequisitionForm({ requisitionId, approvalEdit = false, approvalOrigin = false, selectedLineKeys = [] }: { requisitionId?: string; approvalEdit?: boolean; approvalOrigin?: boolean; selectedLineKeys?: string[] }) {
  const { access } = useAccessContext();
  const router = useRouter();
  const [form, setForm] = useState(emptyForm);
  const [lines, setLines] = useState<Line[]>([]);
  const [lookups, setLookups] = useState<any>({ companies: [], sites: [], items: [], uoms: [], item_types: [], item_groups: [] });
  const [approvedMakesByKey, setApprovedMakesByKey] = useState<Record<string, string[]>>({});
  const [makeSourceByKey, setMakeSourceByKey] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(Boolean(requisitionId));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [modalIndex, setModalIndex] = useState<number | null>(null);
  const [draftLine, setDraftLine] = useState<Line>({ ...blankLine });
  const [makeInput, setMakeInput] = useState("");
  const [draftTypeId, setDraftTypeId] = useState("");
  const [draftGroupId, setDraftGroupId] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [itemMenuOpen, setItemMenuOpen] = useState(false);
  const [itemHighlight, setItemHighlight] = useState(0);
  const [lastTypeGroup, setLastTypeGroup] = useState({ typeId: "", groupId: "" });
  const [documents, setDocuments] = useState<any[]>([]);
  const [requestedByOptions, setRequestedByOptions] = useState<any[]>([]);
  const canSubmit = can(access?.permissions || [], "purchase_requisitions", "submit");

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const lookupResult = await apiFetch("/api/procurement/lookups");
      setLookups(lookupResult);
      if (requisitionId) {
        const result = await apiFetch(`/api/procurement/requisitions/${requisitionId}`);
        const req = result.requisition;
        setForm({ requisition_date: req.requisition_date || emptyForm.requisition_date, company_id: req.company_id || "", site_id: req.site_id || "" });
        setLines((req.items || []).filter((item: any) => !approvalEdit || selectedLineKeys.length === 0 || selectedLineKeys.includes(item.line_key)).map((item: any) => ({ line_key: item.line_key || crypto.randomUUID(), item_id: item.item_id || "", specification: item.specification || "", purpose: item.purpose || "", approved_makes: (item.approved_makes || []).sort((a: any, b: any) => Number(a.sort_order || 0) - Number(b.sort_order || 0)).map((make: any) => make.make_name_snapshot).filter(Boolean), uom_id: item.uom_id || "", quantity: String(item.quantity || ""), requested_by_employee_id: item.requested_by_employee_id || "", requested_by_name_snapshot: item.requested_by_name_snapshot || "", required_by_date: item.required_by_date || "", remarks: item.remarks || "", pending_files: [] })));
        const documentResult = await apiFetch(`/api/procurement/requisitions/${requisitionId}/documents`);
        setDocuments(documentResult.documents || []);
      }
    } catch (error: any) { setMessage(error.message || "Failed to load requisition form."); } finally { setLoading(false); }
  }

  async function loadRequestedBy(companyId = form.company_id, siteId = form.site_id) {
    if (!companyId || !siteId) { setRequestedByOptions([]); return; }
    try { const result = await apiFetch(`/api/procurement/requisitions/requested-by-options?company_id=${encodeURIComponent(companyId)}&site_id=${encodeURIComponent(siteId)}`); setRequestedByOptions(result.employees || []); }
    catch { setRequestedByOptions([]); }
  }

  const sites = useMemo(() => (lookups.sites || []).filter((site: any) => !form.company_id || (site.organization_id === (lookups.companies || []).find((c: any) => c.id === form.company_id)?.organization_id && (site.company_id === form.company_id || site.company_id == null))), [form.company_id, lookups]);
  const activeItems = useMemo(() => (lookups.items || []).filter((item: any) => item.status === "active"), [lookups]);
  const activeUoms = useMemo(() => (lookups.uoms || []).filter((uom: any) => uom.status === "active"), [lookups]);
  const selectedItem = activeItems.find((item: any) => item.id === draftLine.item_id);
  const activeTypes = useMemo(() => (lookups.item_types || []).filter((row: any) => row.status === "active"), [lookups]);
  const filteredGroups = useMemo(() => (lookups.item_groups || []).filter((row: any) => row.status === "active" && row.item_type_id === draftTypeId), [lookups, draftTypeId]);
  const filteredItems = useMemo(() => {
    if (!draftTypeId || !draftGroupId) return selectedItem ? [selectedItem] : [];
    const query = itemSearch.trim().toLowerCase();
    const selectedItemLabel = selectedItem ? `${selectedItem.item_name} — ${selectedItem.item_code}`.toLowerCase() : "";
    if (selectedItem && query === selectedItemLabel) return [selectedItem];
    const matching = activeItems.filter((item: any) => item.item_type_id === draftTypeId && item.item_group_id === draftGroupId && (!query || `${item.item_name} ${item.item_code}`.toLowerCase().includes(query)));
    return query || !selectedItem ? matching : [selectedItem];
  }, [activeItems, draftGroupId, draftTypeId, itemSearch]);

  async function loadApprovedMakes(siteId: string, itemId: string) {
    const key = `${siteId}:${itemId}`;
    const result = await apiFetch(`/api/procurement/effective-makes?site_id=${encodeURIComponent(siteId)}&item_id=${encodeURIComponent(itemId)}`);
    const makes = result.makes || [];
    setMakeSourceByKey((current) => ({ ...current, [key]: result.source || "preferred" }));
    setApprovedMakesByKey((current) => ({ ...current, [key]: makes }));
    return makes;
  }

  function updateLine(index: number, patch: Partial<Line>) { setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line)); }

  async function openLine(index: number | null) {
    const line = index === null ? { ...blankLine, line_key: crypto.randomUUID() } : { ...lines[index], approved_makes: [...lines[index].approved_makes], pending_files: [...lines[index].pending_files] };
    const item = activeItems.find((row: any) => row.id === line.item_id);
    setModalIndex(index === null ? -1 : index); setDraftLine(line); setMakeInput(""); setItemSearch(item ? `${item.item_name} — ${item.item_code}` : ""); setItemMenuOpen(Boolean(item)); setItemHighlight(0);
    setDraftTypeId(item?.item_type_id || (index === null ? lastTypeGroup.typeId : ""));
    setDraftGroupId(item?.item_group_id || (index === null ? lastTypeGroup.groupId : ""));
    if (form.site_id && line.item_id && !approvedMakesByKey[`${form.site_id}:${line.item_id}`]) await loadApprovedMakes(form.site_id, line.item_id).catch(() => undefined);
    await loadRequestedBy(form.company_id, form.site_id);
  }

  async function onItemChange(itemId: string) {
    const item = activeItems.find((row: any) => row.id === itemId);
    setDraftLine((current) => ({ ...current, item_id: itemId, approved_makes: [], uom_id: item?.default_uom_id || "", specification: current.specification || item?.description || "" }));
    if (item) { setDraftTypeId(item.item_type_id || ""); setDraftGroupId(item.item_group_id || ""); }
    setItemSearch(item ? `${item.item_name} — ${item.item_code}` : ""); setItemMenuOpen(false);
    if (form.site_id && itemId) {
      const makes = await loadApprovedMakes(form.site_id, itemId).catch(() => []);
      setDraftLine((current) => ({ ...current, approved_makes: makes }));
    }
  }

  function commitLine() {
    if (!draftLine.item_id) { setMessage("Select an item before adding the material."); return; }
    if (!draftLine.purpose.trim()) { setMessage("Enter Purpose / Requirement before adding the material."); return; }
    if (!draftLine.quantity || Number(draftLine.quantity) <= 0) { setMessage("Enter a quantity before adding the material."); return; }
    if (!draftLine.requested_by_employee_id) { setMessage("Select Requested By before adding the material."); return; }
    if (!draftLine.required_by_date) { setMessage("Select Required By before adding the material."); return; }
    setLastTypeGroup({ typeId: draftTypeId, groupId: draftGroupId });
    if (modalIndex === -1) setLines((current) => [...current, draftLine]);
    else if (modalIndex !== null) updateLine(modalIndex, draftLine);
    setModalIndex(null);
  }

  function addMake() {
    const value = makeInput.trim();
    if (!value || draftLine.approved_makes.some((make) => make.toLowerCase() === value.toLowerCase())) return;
    setDraftLine((current) => ({ ...current, approved_makes: [...current.approved_makes, value] })); setMakeInput("");
  }

  function onSiteChange(siteId: string) { setForm({ ...form, site_id: siteId }); setLines((current) => current.map((line) => ({ ...line, requested_by_employee_id: "", requested_by_name_snapshot: "" }))); setApprovedMakesByKey({}); setMakeSourceByKey({}); setRequestedByOptions([]); loadRequestedBy(form.company_id, siteId); }
  function onCompanyChange(companyId: string) { setForm({ ...form, company_id: companyId, site_id: "" }); setApprovedMakesByKey({}); setMakeSourceByKey({}); setRequestedByOptions([]); }

  async function save(submit: boolean) {
    setSaving(true); setMessage("");
    try {
      const savedLineKeys = new Set(lines.map((line) => line.line_key));
      const selectedKeySet = new Set(selectedLineKeys);
      const removedDocuments = documents.filter((document) => document.requisition_item_line_key && (!approvalEdit || selectedLineKeys.length === 0 || selectedKeySet.has(document.requisition_item_line_key)) && !savedLineKeys.has(document.requisition_item_line_key));
      const body = JSON.stringify({ ...form, line_keys: lines.map((line) => line.line_key), items: lines.map(({ pending_files, requested_by_name_snapshot, ...line }) => line), submit: false });
      if (approvalEdit && requisitionId) {
        await apiFetch(`/api/procurement/requisitions/${requisitionId}/approval-edit`, { method: "PUT", body });
        await uploadPendingFiles(requisitionId, lines);
        await cleanupRemovedDocuments(requisitionId, removedDocuments);
        router.push(approvalOrigin && requisitionId ? `/purchase/requisitions/${requisitionId}?from=approval` : "/purchase/requisitions/approvals");
        return;
      }
      const result = await apiFetch(requisitionId ? `/api/procurement/requisitions/${requisitionId}` : "/api/procurement/requisitions", { method: requisitionId ? "PUT" : "POST", body });
      const id = requisitionId || result.requisition_id;
      await uploadPendingFiles(id, lines);
      await cleanupRemovedDocuments(id, removedDocuments);
      if (submit) await apiFetch(`/api/procurement/requisitions/${id}/submit`, { method: "POST" });
      router.push(`/purchase/requisitions/${id}`);
    } catch (error: any) { setMessage(error.message || "Failed to save requisition."); } finally { setSaving(false); }
  }

  async function uploadPendingFiles(id: string, sourceLines: Line[]) {
    for (const line of sourceLines) for (const file of line.pending_files) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("line_key", line.line_key);
      await apiFetch(`/api/procurement/requisitions/${id}/documents`, { method: "POST", body: formData });
    }
  }

  async function cleanupRemovedDocuments(id: string, removedDocuments: any[]) {
    for (const document of removedDocuments) {
      try { await apiFetch(`/api/procurement/requisitions/${id}/documents?document_id=${encodeURIComponent(document.id)}&cleanup=1`, { method: "DELETE" }); }
      catch (error: any) { setMessage(`Saved, but storage cleanup failed for ${document.original_file_name}: ${error.message || "retry required"}`); }
    }
  }

  async function removeDocument(documentId: string) {
    if (!requisitionId) return;
    await apiFetch(`/api/procurement/requisitions/${requisitionId}/documents?document_id=${encodeURIComponent(documentId)}`, { method: "DELETE" });
    setDocuments((current) => current.filter((document) => document.id !== documentId));
  }

  async function openDocument(documentId: string) {
    if (!requisitionId) return;
    const result = await apiFetch(`/api/procurement/requisitions/${requisitionId}/documents?document_id=${encodeURIComponent(documentId)}`);
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  if (loading) return <p className="text-sm text-slate-500">Loading requisition...</p>;
  const editing = modalIndex !== null && modalIndex >= 0;
  const rememberedMakes = form.site_id && draftLine.item_id ? approvedMakesByKey[`${form.site_id}:${draftLine.item_id}`] || [] : [];

  return <section className="space-y-6"><header className="flex flex-wrap items-center justify-between gap-4"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Purchase Requisition</p><h1 className="text-3xl font-bold text-slate-950">{approvalEdit ? "Edit Indent During Approval" : requisitionId ? "Edit Requisition" : "New Requisition"}</h1><p className="text-sm text-slate-500">{approvalEdit ? "Correct the Indent before approving it." : "Capture what is required, where it is required, and why."}</p></div><Link href={approvalEdit ? (approvalOrigin ? `/purchase/requisitions/${requisitionId}?from=approval` : "/purchase/requisitions/approvals") : "/purchase/requisitions"} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"><ArrowLeft className="h-4 w-4" />Cancel</Link></header><AlertMessage type="error" message={message} onClose={() => setMessage("")} />
    <div className="rounded-2xl border bg-white p-5 shadow-sm"><div className="grid gap-4 md:grid-cols-3"><Field label="Company *"><select value={form.company_id} onChange={(e) => onCompanyChange(e.target.value)} disabled={approvalEdit} className={`h-11 w-full rounded-xl border px-3 text-sm ${approvalEdit ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500" : ""}`}><option value="">Select Company</option>{(lookups.companies || []).map((company: any) => <option key={company.id} value={company.id}>{company.company_name}</option>)}</select></Field><Field label="Site *"><select value={form.site_id} onChange={(e) => onSiteChange(e.target.value)} disabled={approvalEdit} className={`h-11 w-full rounded-xl border px-3 text-sm ${approvalEdit ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500" : ""}`}><option value="">Select Site</option>{sites.map((site: any) => <option key={site.id} value={site.id}>{site.site_name}</option>)}</select></Field><Field label="Requisition Date *"><input type="date" value={form.requisition_date} onChange={(e) => setForm({ ...form, requisition_date: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field></div></div>    <div className="rounded-2xl border bg-white shadow-sm"><div className="flex items-center justify-between border-b p-4"><div><h2 className="font-semibold text-slate-950">Materials Required</h2><p className="mt-1 text-xs text-slate-500">Each line represents one material requirement; approved makes are alternatives.</p></div><button type="button" onClick={() => openLine(null)} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-slate-50"><Plus className="h-4 w-4" />Add Material</button></div><div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3 text-right">S. No.</th><th className="px-3 py-3">Material</th><th className="px-3 py-3">Specification</th><th className="px-3 py-3">Purpose / Requirement</th><th className="px-3 py-3">Approved Makes</th><th className="px-3 py-3 text-right">Quantity</th><th className="px-3 py-3">UOM</th><th className="px-3 py-3">Requested By</th><th className="px-3 py-3">Required By</th><th className="px-3 py-3">Attachments</th><th className="px-3 py-3">Actions</th></tr></thead><tbody className="divide-y">{lines.length === 0 ? <tr><td colSpan={11} className="px-3 py-10 text-center text-sm text-slate-500">No materials added yet.</td></tr> : lines.map((line, index) => { const item = activeItems.find((row: any) => row.id === line.item_id); return <tr key={`${line.item_id}-${index}`}><td className="px-3 py-3 text-right text-slate-500">{index + 1}</td><td className="px-3 py-3"><p className="font-semibold text-slate-950">{item?.item_name || line.item_id}</p><p className="text-xs text-slate-500">{item?.item_code || ""}</p></td><td className="max-w-[210px] px-3 py-3"><span className="line-clamp-2 text-slate-700" title={line.specification}>{line.specification || "—"}</span></td><td className="max-w-[210px] px-3 py-3"><span className="line-clamp-2 text-slate-700" title={line.purpose}>{line.purpose || "—"}</span></td><td className="max-w-[200px] px-3 py-3 text-slate-700"><span className="line-clamp-2" title={line.approved_makes.join(", ")}>{line.approved_makes.length ? line.approved_makes.join(", ") : "—"}</span></td><td className="px-3 py-3 text-right font-semibold">{line.quantity || "—"}</td><td className="px-3 py-3">{activeUoms.find((uom: any) => uom.id === line.uom_id)?.uom_code || "—"}</td><td className="px-3 py-3">{line.requested_by_name_snapshot || requestedByOptions.find((employee: any) => employee.id === line.requested_by_employee_id)?.employee_name || "Not recorded"}</td><td className="px-3 py-3">{line.required_by_date || "—"}</td><td className="px-3 py-3 text-xs text-slate-500">{documents.filter((document) => document.requisition_item_line_key === line.line_key).length + line.pending_files.length ? `${documents.filter((document) => document.requisition_item_line_key === line.line_key).length + line.pending_files.length} file${documents.filter((document) => document.requisition_item_line_key === line.line_key).length + line.pending_files.length === 1 ? "" : "s"}` : "—"}</td><td className="px-3 py-3"><div className="flex gap-2"><button type="button" onClick={() => openLine(index)} className="rounded-lg border p-2 hover:bg-slate-50" title="Edit material"><Pencil className="h-4 w-4" /></button><button type="button" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))} className="rounded-lg border p-2 text-red-600 hover:bg-red-50" title="Remove material"><Trash2 className="h-4 w-4" /></button></div></td></tr>; })}</tbody></table></div></div>
    <div className="flex justify-end gap-3"><button disabled={saving} onClick={() => save(false)} className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60">{approvalEdit ? "Save Changes" : "Save Draft"}</button>{!approvalEdit && canSubmit && <button disabled={saving} onClick={() => save(true)} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">Submit Requisition</button>}</div>
    {modalIndex !== null && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-label={editing ? "Edit Material" : "Add Material"}><div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b px-6 py-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Purchase Requisition</p><h2 className="text-xl font-bold text-slate-950">{editing ? "Edit Material" : "Add Material"}</h2></div><button type="button" onClick={() => setModalIndex(null)} className="rounded-lg p-2 hover:bg-slate-100" title="Close"><X className="h-5 w-5" /></button></div><div className="space-y-5 p-6"><div className="grid gap-4 md:grid-cols-2"><Field label="Item Type *"><select value={draftTypeId} onChange={(e) => { setDraftTypeId(e.target.value); setDraftGroupId(""); setItemSearch(""); setDraftLine({ ...draftLine, item_id: "", uom_id: "", approved_makes: [] }); }} className="h-11 w-full rounded-xl border px-3 text-sm"><option value="">Select item type</option>{activeTypes.map((row: any) => <option key={row.id} value={row.id}>{row.type_name}</option>)}</select></Field><Field label="Item Group *"><select value={draftGroupId} disabled={!draftTypeId} onChange={(e) => { setDraftGroupId(e.target.value); setItemSearch(""); setDraftLine({ ...draftLine, item_id: "", uom_id: "", approved_makes: [] }); }} className="h-11 w-full rounded-xl border px-3 text-sm"><option value="">Select item group</option>{filteredGroups.map((row: any) => <option key={row.id} value={row.id}>{row.group_name}</option>)}</select></Field></div><Field label="Item / Material *"><div className="relative"><input role="combobox" aria-autocomplete="list" aria-expanded={itemMenuOpen && Boolean(draftGroupId)} value={itemSearch} onFocus={() => setItemMenuOpen(Boolean(draftGroupId))} onChange={(e) => { const value = e.target.value; setItemSearch(value); setItemMenuOpen(true); setItemHighlight(0); if (selectedItem && value !== `${selectedItem.item_name} — ${selectedItem.item_code}`) setDraftLine((current) => ({ ...current, item_id: "", uom_id: "", approved_makes: [] })); }} onKeyDown={(e) => { if (!draftGroupId) return; if (e.key === "ArrowDown") { e.preventDefault(); setItemMenuOpen(true); setItemHighlight((current) => Math.min(current + 1, Math.max(filteredItems.length - 1, 0))); } else if (e.key === "ArrowUp") { e.preventDefault(); setItemHighlight((current) => Math.max(current - 1, 0)); } else if (e.key === "Enter" && itemMenuOpen && filteredItems[itemHighlight]) { e.preventDefault(); onItemChange(filteredItems[itemHighlight].id); } else if (e.key === "Escape") setItemMenuOpen(false); }} disabled={!draftGroupId} placeholder={draftGroupId ? "Search item name or code" : "Select type and group first"} className="h-11 w-full rounded-xl border px-3 text-sm" />{itemMenuOpen && draftGroupId && <div role="listbox" className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border bg-white py-1 shadow-lg">{filteredItems.length === 0 ? <p className="px-3 py-2 text-sm text-slate-500">No matching items.</p> : filteredItems.map((item: any, index: number) => <button type="button" role="option" aria-selected={item.id === draftLine.item_id} key={item.id} onMouseDown={(e) => e.preventDefault()} onClick={() => onItemChange(item.id)} className={`block w-full px-3 py-2 text-left text-sm ${index === itemHighlight ? "bg-slate-100" : "hover:bg-slate-50"}`}><span className="font-semibold text-slate-900">{item.item_name}</span><span className="ml-2 text-xs text-slate-500">{item.item_code}</span></button>)}</div>}</div>{selectedItem && <p className="mt-1 text-xs text-slate-500">{selectedItem.item_code} • {selectedItem.item_category || "Material"}</p>}</Field><label className="space-y-1 text-sm font-semibold text-slate-700"><span>Specification</span><textarea value={draftLine.specification} onChange={(e) => setDraftLine({ ...draftLine, specification: e.target.value })} rows={4} className="w-full rounded-xl border px-3 py-2 text-sm" placeholder="Technical specification or standard" /></label><label className="space-y-1 text-sm font-semibold text-slate-700"><span>Purpose / Requirement *</span><textarea value={draftLine.purpose} onChange={(e) => setDraftLine({ ...draftLine, purpose: e.target.value })} rows={4} className="w-full rounded-xl border px-3 py-2 text-sm" placeholder="Describe the purpose or requirement for this material" /></label><div><p className="mb-2 text-sm font-semibold text-slate-700">Approved Makes</p><div className="flex flex-wrap gap-2">{draftLine.approved_makes.map((make) => <button key={make} type="button" onClick={() => setDraftLine({ ...draftLine, approved_makes: draftLine.approved_makes.filter((current) => current !== make) })} className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white">{make} ×</button>)}{draftLine.approved_makes.length === 0 && <span className="text-xs text-slate-400">No makes selected</span>}</div>{rememberedMakes.filter((make) => !draftLine.approved_makes.some((selected) => selected.toLowerCase() === make.toLowerCase())).length > 0 && <p className="mt-2 text-xs text-slate-500">Remembered for this site and material: {rememberedMakes.filter((make) => !draftLine.approved_makes.includes(make)).join(", ")}</p>}<div className="mt-3 flex gap-2"><input value={makeInput} onChange={(e) => setMakeInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMake(); } }} placeholder="Add make" className="h-10 flex-1 rounded-xl border px-3 text-sm" /><button type="button" onClick={addMake} className="rounded-xl border px-3 text-sm font-semibold hover:bg-slate-50">Add</button></div></div><div className="grid gap-4 md:grid-cols-2"><Field label="Quantity *"><input type="number" step="0.001" value={draftLine.quantity} onChange={(e) => setDraftLine({ ...draftLine, quantity: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field><Field label="UOM"><input readOnly value={activeUoms.find((uom: any) => uom.id === draftLine.uom_id)?.uom_code || ""} className="h-11 w-full rounded-xl border bg-slate-50 px-3 text-sm" /></Field></div><div className="grid gap-4 md:grid-cols-2"><Field label="Requested By *"><select value={draftLine.requested_by_employee_id} onChange={(e) => { const employee = requestedByOptions.find((row: any) => row.id === e.target.value); setDraftLine({ ...draftLine, requested_by_employee_id: e.target.value, requested_by_name_snapshot: employee?.employee_name || "" }); }} className="h-11 w-full rounded-xl border px-3 text-sm"><option value="">Select employee</option>{requestedByOptions.map((employee: any) => <option key={employee.id} value={employee.id}>{employee.employee_name} — {employee.site_name || "Unknown Site"}</option>)}</select></Field><Field label="Required By *"><input type="date" value={draftLine.required_by_date} onChange={(e) => setDraftLine({ ...draftLine, required_by_date: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field></div><div><div className="mb-2 flex items-center justify-between"><p className="text-sm font-semibold text-slate-700">Attachments</p><label className="cursor-pointer rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-slate-50">+ Add Files<input type="file" multiple className="hidden" onChange={(e) => setDraftLine((current) => ({ ...current, pending_files: [...current.pending_files, ...Array.from(e.target.files || [])] }))} /></label></div>{documents.filter((document) => document.requisition_item_line_key === draftLine.line_key).map((document: any) => <div key={document.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs"><span className="truncate font-semibold text-slate-700">{document.original_file_name} · {document.size_bytes ? `${Math.ceil(document.size_bytes / 1024)} KB` : "Size unavailable"}</span><span className="flex gap-2"><button type="button" onClick={() => openDocument(document.id)} className="font-semibold underline">View</button><button type="button" onClick={() => removeDocument(document.id)} className="font-semibold text-red-700">Remove</button></span></div>)}{draftLine.pending_files.map((file, index) => <div key={`${file.name}-${index}`} className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2 text-xs"><span className="truncate text-slate-700">{file.name} · {Math.ceil(file.size / 1024)} KB</span><button type="button" onClick={() => setDraftLine((current) => ({ ...current, pending_files: current.pending_files.filter((_, fileIndex) => fileIndex !== index) }))} className="font-semibold text-red-700">Remove</button></div>)}</div><label className="space-y-1 text-sm font-semibold text-slate-700"><span>Line Remarks</span><textarea value={draftLine.remarks} onChange={(e) => setDraftLine({ ...draftLine, remarks: e.target.value })} rows={3} className="w-full rounded-xl border px-3 py-2 text-sm" /></label></div><div className="flex justify-end gap-3 border-t bg-slate-50 px-6 py-4"><button type="button" onClick={() => setModalIndex(null)} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-100">Cancel</button><button type="button" onClick={commitLine} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">{editing ? "Update Material" : "Add Material"}</button></div></div></div>}</section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="space-y-1 text-sm font-semibold text-slate-700"><span>{label}</span>{children}</label>; }
