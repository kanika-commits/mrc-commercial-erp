"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Save, Trash2, Upload, X } from "lucide-react";
import AlertMessage from "@/components/AlertMessage";
import { apiFetch } from "@/components/hr/hrClient";

type EditLine = {
  line_key: string;
  item_id: string;
  specification: string;
  purpose: string;
  approved_makes: string[];
  make_brand: string;
  uom_id: string;
  quantity: string;
  requested_by_employee_id: string;
  required_by_date: string;
  remarks: string;
  attachments: any[];
  pendingFiles: File[];
  pendingRemovalIds: string[];
};

type LookupState = {
  items: any[];
  uoms: any[];
  item_types: any[];
  item_groups: any[];
  employees: any[];
};

const emptyLookups: LookupState = { items: [], uoms: [], item_types: [], item_groups: [], employees: [] };

function text(value: unknown) {
  return String(value ?? "").trim();
}

function makesFromLine(line: any) {
  return (line.approved_makes || [])
    .slice()
    .sort((a: any, b: any) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((make: any) => text(make.make_name_snapshot || make.make_name || make))
    .filter(Boolean);
}

function uniqueMakes(value: string) {
  const seen = new Set<string>();
  return value
    .split(/[,\n]/)
    .map((make) => make.trim())
    .filter((make) => {
      const key = make.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function lineFromItem(item: any): EditLine {
  const approvedMakes = makesFromLine(item);
  return {
    line_key: text(item.line_key),
    item_id: text(item.item_id),
    specification: text(item.specification),
    purpose: text(item.purpose),
    approved_makes: approvedMakes,
    make_brand: text(item.make_brand) || approvedMakes.join(", "),
    uom_id: text(item.uom_id),
    quantity: text(item.quantity),
    requested_by_employee_id: text(item.requested_by_employee_id),
    required_by_date: text(item.required_by_date),
    remarks: text(item.remarks),
    attachments: (item.line_attachments || []).filter((document: any) => document.status === "active"),
    pendingFiles: [],
    pendingRemovalIds: [],
  };
}

function fileSize(size: number) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ApprovalLineEditDialog({
  open,
  requisition,
  selectedLineKeys,
  onClose,
  onSaved,
}: {
  open: boolean;
  requisition: any;
  selectedLineKeys: string[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [lines, setLines] = useState<EditLine[]>([]);
  const [lookups, setLookups] = useState<LookupState>(emptyLookups);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const selectedKeySet = useMemo(() => new Set(selectedLineKeys), [selectedLineKeys]);
  const editableItems = useMemo(
    () => (requisition?.items || []).filter((item: any) => selectedKeySet.has(item.line_key) && item.line_actionable),
    [requisition, selectedKeySet],
  );

  useEffect(() => {
    if (!open || !requisition) return;
    let cancelled = false;
    setMessage("");
    setLoading(true);
    setLines(editableItems.map(lineFromItem));
    Promise.all([
      apiFetch("/api/procurement/lookups"),
      apiFetch(`/api/procurement/requisitions/requested-by-options?company_id=${encodeURIComponent(requisition.company_id || "")}&site_id=${encodeURIComponent(requisition.site_id || "")}`),
    ])
      .then(([lookupResult, employeeResult]) => {
        if (cancelled) return;
        setLookups({
          items: lookupResult.items || [],
          uoms: lookupResult.uoms || [],
          item_types: lookupResult.item_types || [],
          item_groups: lookupResult.item_groups || [],
          employees: employeeResult.employees || [],
        });
      })
      .catch((error: any) => {
        if (!cancelled) setMessage(error.message || "Failed to load edit options.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, requisition, editableItems]);

  if (!open || !requisition) return null;

  const activeItems = lookups.items.filter((item: any) => item.status === "active");
  const itemById = new Map(activeItems.map((item: any) => [item.id, item]));
  const uomById = new Map(lookups.uoms.map((uom: any) => [uom.id, uom]));

  function updateLine(index: number, patch: Partial<EditLine>) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  }

  function addPendingFiles(index: number, files: FileList | null) {
    if (!files?.length) return;
    updateLine(index, { pendingFiles: [...lines[index].pendingFiles, ...Array.from(files)] });
  }

  function removePendingFile(lineIndex: number, fileIndex: number) {
    updateLine(lineIndex, { pendingFiles: lines[lineIndex].pendingFiles.filter((_, index) => index !== fileIndex) });
  }

  function toggleAttachmentRemoval(lineIndex: number, documentId: string) {
    const line = lines[lineIndex];
    updateLine(lineIndex, {
      pendingRemovalIds: line.pendingRemovalIds.includes(documentId)
        ? line.pendingRemovalIds.filter((id) => id !== documentId)
        : [...line.pendingRemovalIds, documentId],
    });
  }

  async function viewAttachment(documentId: string) {
    const result = await apiFetch(`/api/procurement/requisitions/${requisition.id}/documents?document_id=${encodeURIComponent(documentId)}`);
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  async function uploadAttachment(lineKey: string, file: File) {
    const form = new FormData();
    form.append("line_key", lineKey);
    form.append("file", file);
    await apiFetch(`/api/procurement/requisitions/${requisition.id}/documents`, { method: "POST", body: form });
  }

  async function removeAttachment(documentId: string) {
    await apiFetch(`/api/procurement/requisitions/${requisition.id}/documents?document_id=${encodeURIComponent(documentId)}`, { method: "DELETE" });
  }

  function onItemChange(index: number, itemId: string) {
    const item = itemById.get(itemId);
    updateLine(index, {
      item_id: itemId,
      uom_id: text(item?.default_uom_id),
      specification: lines[index]?.specification || text(item?.description),
    });
  }

  async function save() {
    setMessage("");
    const invalidIndex = lines.findIndex((line) => !line.line_key || !line.item_id || !line.purpose.trim() || !line.requested_by_employee_id || !line.required_by_date || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0);
    if (invalidIndex >= 0) {
      setMessage(`Complete required fields on selected line ${invalidIndex + 1}.`);
      return;
    }
    try {
      setSaving(true);
      await apiFetch(`/api/procurement/requisitions/${requisition.id}/approval-edit`, {
        method: "PUT",
        body: JSON.stringify({
          line_keys: lines.map((line) => line.line_key),
          items: lines.map((line) => ({
            line_key: line.line_key,
            item_id: line.item_id,
            specification: text(line.specification) || null,
            purpose: text(line.purpose),
            approved_makes: line.approved_makes,
            make_brand: text(line.make_brand) || line.approved_makes.join(", ") || null,
            uom_id: line.uom_id,
            quantity: Number(line.quantity),
            requested_by_employee_id: line.requested_by_employee_id,
            required_by_date: line.required_by_date,
            remarks: text(line.remarks) || null,
          })),
        }),
      });
      for (const line of lines) {
        for (const documentId of line.pendingRemovalIds) {
          await removeAttachment(documentId);
        }
        for (const file of line.pendingFiles) {
          await uploadAttachment(line.line_key, file);
        }
      }
      await onSaved();
    } catch (error: any) {
      setMessage(error.message || "Failed to save selected material lines.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-label="Edit selected material lines">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Indent Approval</p>
            <h2 className="text-xl font-bold text-slate-950">Edit Selected Material Lines</h2>
            <p className="mt-1 text-sm text-slate-500">{requisition.requisition_number} · {lines.length} selected</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-2 hover:bg-slate-100 disabled:opacity-50" title="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 p-6">
          <AlertMessage type="error" message={message} onClose={() => setMessage("")} />
          {loading ? <p className="rounded-xl border border-dashed p-4 text-sm text-slate-500">Loading editable material details...</p> : null}
          {lines.map((line, index) => {
            const selectedItem = itemById.get(line.item_id) || editableItems.find((item: any) => item.line_key === line.line_key);
            const uom = uomById.get(line.uom_id);
            return (
              <div key={line.line_key} className="rounded-xl border p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-950">Line {index + 1}</p>
                    <p className="text-xs text-slate-500">{selectedItem?.item_name || selectedItem?.item_name_snapshot || "Selected material"} {selectedItem?.item_code || selectedItem?.item_code_snapshot ? `— ${selectedItem?.item_code || selectedItem?.item_code_snapshot}` : ""}</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Line key preserved</span>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Material *">
                    <select value={line.item_id} onChange={(event) => onItemChange(index, event.target.value)} disabled={saving} className="h-11 w-full rounded-xl border px-3 text-sm">
                      <option value="">Select material</option>
                      {selectedItem && !itemById.has(line.item_id) ? <option value={line.item_id}>{selectedItem.item_name_snapshot || selectedItem.item_name} — {selectedItem.item_code_snapshot || selectedItem.item_code}</option> : null}
                      {activeItems.map((item: any) => <option key={item.id} value={item.id}>{item.item_name} — {item.item_code}</option>)}
                    </select>
                  </Field>
                  <Field label="Quantity *">
                    <input type="number" step="0.001" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} disabled={saving} className="h-11 w-full rounded-xl border px-3 text-sm" />
                  </Field>
                  <Field label="UOM">
                    <input readOnly value={uom?.uom_code || selectedItem?.uom_snapshot || ""} className="h-11 w-full rounded-xl border bg-slate-50 px-3 text-sm" />
                  </Field>
                  <Field label="Requested By *">
                    <select value={line.requested_by_employee_id} onChange={(event) => updateLine(index, { requested_by_employee_id: event.target.value })} disabled={saving} className="h-11 w-full rounded-xl border px-3 text-sm">
                      <option value="">Select employee</option>
                      {lookups.employees.map((employee: any) => <option key={employee.id} value={employee.id}>{employee.employee_name} — {employee.site_name || "Unknown Site"}</option>)}
                    </select>
                  </Field>
                  <Field label="Required By *">
                    <input type="date" value={line.required_by_date} onChange={(event) => updateLine(index, { required_by_date: event.target.value })} disabled={saving} className="h-11 w-full rounded-xl border px-3 text-sm" />
                  </Field>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <Field label="Specification">
                    <textarea value={line.specification} onChange={(event) => updateLine(index, { specification: event.target.value })} disabled={saving} rows={3} className="w-full rounded-xl border px-3 py-2 text-sm" />
                  </Field>
                  <Field label="Purpose / Requirement *">
                    <textarea value={line.purpose} onChange={(event) => updateLine(index, { purpose: event.target.value })} disabled={saving} rows={3} className="w-full rounded-xl border px-3 py-2 text-sm" />
                  </Field>
                  <Field label="Approved Makes">
                    <textarea value={line.approved_makes.join(", ")} onChange={(event) => updateLine(index, { approved_makes: uniqueMakes(event.target.value), make_brand: event.target.value })} disabled={saving} rows={3} className="w-full rounded-xl border px-3 py-2 text-sm" placeholder="One or more makes, separated by commas" />
                  </Field>
                  <Field label="Line Remarks">
                    <textarea value={line.remarks} onChange={(event) => updateLine(index, { remarks: event.target.value })} disabled={saving} rows={3} className="w-full rounded-xl border px-3 py-2 text-sm" />
                  </Field>
                </div>
                <div className="mt-4 rounded-xl border bg-slate-50 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-bold text-slate-800">Attachments</h3>
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border bg-white px-3 py-2 text-xs font-semibold hover:bg-slate-100">
                      <Upload className="h-4 w-4" />Add Attachment
                      <input type="file" multiple disabled={saving} onChange={(event) => { addPendingFiles(index, event.target.files); event.currentTarget.value = ""; }} className="hidden" />
                    </label>
                  </div>
                  {line.attachments.length === 0 && line.pendingFiles.length === 0 ? <p className="rounded-lg border border-dashed bg-white p-3 text-sm text-slate-500">No attachments</p> : null}
                  <div className="space-y-2">
                    {line.attachments.map((document: any) => {
                      const marked = line.pendingRemovalIds.includes(document.id);
                      return <div key={document.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2 text-sm ${marked ? "opacity-60" : ""}`}><div className="min-w-0"><p className={`truncate font-semibold ${marked ? "line-through" : ""}`} title={document.original_file_name}><FileText className="mr-2 inline h-4 w-4 text-slate-500" />{document.original_file_name}</p>{marked && <p className="text-xs font-semibold text-amber-700">Pending removal</p>}</div><div className="flex gap-2"><button type="button" onClick={() => viewAttachment(document.id)} disabled={saving || marked} className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50">View</button><button type="button" onClick={() => toggleAttachmentRemoval(index, document.id)} disabled={saving} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />{marked ? "Undo" : "Remove"}</button></div></div>;
                    })}
                    {line.pendingFiles.map((file, fileIndex) => <div key={`${file.name}-${fileIndex}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm"><div className="min-w-0"><p className="truncate font-semibold text-amber-900" title={file.name}><FileText className="mr-2 inline h-4 w-4" />{file.name}{fileSize(file.size) ? ` · ${fileSize(file.size)}` : ""}</p><p className="text-xs font-semibold text-amber-700">Will upload when saved</p></div><button type="button" onClick={() => removePendingFile(index, fileIndex)} disabled={saving} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Remove</button></div>)}
                  </div>
                </div>
              </div>
            );
          })}
          {!loading && lines.length === 0 ? <p className="rounded-xl border border-dashed p-4 text-sm text-slate-500">No current actionable selected lines were found.</p> : null}
        </div>
        <div className="flex justify-end gap-3 border-t bg-slate-50 px-6 py-4">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-100 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={save} disabled={saving || loading || lines.length === 0} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"><Save className="h-4 w-4" />Save Changes</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="space-y-1 text-sm font-semibold text-slate-700"><span>{label}</span>{children}</label>;
}
