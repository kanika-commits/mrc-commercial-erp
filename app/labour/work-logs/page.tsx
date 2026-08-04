"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAccessContext } from "@/components/AccessContext";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { supabase } from "@/lib/supabase";

type WorkRow = {
  client_id: string;
  id?: string;
  contractor_profile_id: string;
  labour_count: string;
  work_type: "productive" | "non_productive" | "";
  work_description: string;
  quantity: string;
  unit: string;
  photo_file: File | null;
  photo_capture_source?: "upload" | "constructiq_camera_v1";
  photo_captured_at?: string;
  photo_count?: number;
  photo_ids?: string[];
  remarks: string;
  status?: string;
  error?: string;
  saved?: boolean;
  saving?: boolean;
  dirty?: boolean;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function newRow(): WorkRow {
  return {
    client_id: crypto.randomUUID(),
    contractor_profile_id: "",
    labour_count: "",
    work_type: "productive",
    work_description: "",
    quantity: "",
    unit: "",
    photo_file: null,
    remarks: "",
    status: "draft",
  };
}

function newRowForContractor(contractorProfileId: string): WorkRow {
  return { ...newRow(), contractor_profile_id: contractorProfileId };
}

function contractorName(contractor: any) {
  return contractor?.vendors?.vendor_name || contractor?.contractor_code || "Contractor";
}

async function readPayload(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || "Request failed." };
  }
}

function previewPhotoLabel(row: WorkRow) {
  if (row.photo_file && row.photo_capture_source === "constructiq_camera_v1") return "Photo Captured";
  if (row.photo_file) return "Photo Selected";
  if (row.photo_count) return `${row.photo_count} Saved Photo`;
  return "No photo";
}

export default function LabourWorkLogsPage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const global = hasGlobalAccess(access);
  const canAdd = global || can(permissions, "labour_work_logs", "add");
  const canEdit = global || can(permissions, "labour_work_logs", "edit");
  const canDelete = global || can(permissions, "labour_work_logs", "delete");
  const canSubmit = global || can(permissions, "labour_daily_submission", "submit");

  const [context, setContext] = useState({ company_id: "", site_id: "", work_date: today() });
  const [companies, setCompanies] = useState<any[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [contractors, setContractors] = useState<any[]>([]);
  const [rows, setRows] = useState<WorkRow[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);

  const siteOptions = useMemo(() => sites || [], [sites]);
  const contractorById = useMemo(() => new Map(contractors.map((contractor) => [contractor.id, contractor])), [contractors]);

  async function token() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  }

  async function loadContext(nextContext = context, options: { preserveRows?: boolean } = {}) {
    abortRef.current?.abort();
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      params.set("work_date", nextContext.work_date);
      if (nextContext.company_id) params.set("company_id", nextContext.company_id);
      if (nextContext.site_id) params.set("site_id", nextContext.site_id);
      const response = await fetch(`/api/labour/work-logs?${params.toString()}`, {
        headers: { Authorization: `Bearer ${await token()}` },
        signal: controller.signal,
      });
      const payload = await readPayload(response);
      if (requestId !== requestRef.current) return;
      if (!response.ok) {
        setMessage(payload.error || "Could not load Daily Work.");
        return;
      }
      setCompanies(payload.companies || []);
      setSites(payload.sites || []);
      setContractors(payload.contractors || []);
      if (!options.preserveRows) {
        setRows((payload.work_logs || []).map((log: any) => ({
          client_id: log.id,
          id: log.id,
          contractor_profile_id: log.contractor_profile_id || "",
          labour_count: log.labour_count === null || log.labour_count === undefined ? "" : String(log.labour_count),
          work_type: log.work_type || "productive",
          work_description: log.work_description || log.activity || "",
          quantity: log.quantity === null || log.quantity === undefined ? "" : String(log.quantity),
          unit: log.unit || "",
          photo_file: null,
          photo_capture_source: "upload",
          photo_captured_at: "",
          photo_count: log.photo_count || 0,
          photo_ids: log.photo_ids || [],
          remarks: log.remarks || "",
          status: log.status || "draft",
          saved: true,
          dirty: false,
        })));
        setDirty(false);
      }
      if (payload.message) setMessage(payload.message);
    } catch (error: any) {
      if (error?.name !== "AbortError") setMessage(error.message || "Could not load Daily Work.");
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    loadContext();
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!context.site_id && context.company_id && siteOptions.length === 1) {
      setContext((current) => ({ ...current, site_id: siteOptions[0].id }));
    }
  }, [context.company_id, context.site_id, siteOptions]);

  async function updateContext(patch: Partial<typeof context>) {
    const next = { ...context, ...patch };
    if (dirty && !window.confirm("Changing context will clear unsaved rows. Continue?")) return;
    setContext(next);
    setDirty(false);
    setRows([]);
    await loadContext(next);
  }

  function addRow(contractorProfileId?: string) {
    setRows((current) => [...current, contractorProfileId ? newRowForContractor(contractorProfileId) : newRow()]);
    setDirty(true);
  }

  function patchRow(clientId: string, patch: Partial<WorkRow>) {
    setRows((current) => current.map((row) => row.client_id === clientId ? { ...row, ...patch, dirty: true, error: "" } : row));
    setDirty(true);
  }

  function removeLocalRow(clientId: string) {
    setRows((current) => current.filter((row) => row.client_id !== clientId));
    setDirty(true);
  }

  function siteInCount(row: WorkRow) {
    return Number(contractorById.get(row.contractor_profile_id)?.site_in_count || 0);
  }

  function validateClient(row: WorkRow) {
    const available = siteInCount(row);
    const count = Number(row.labour_count);
    if (!row.contractor_profile_id) return "Contractor is required.";
    if (!Number.isInteger(count) || count <= 0) return "Labour Count is required and must be a whole number.";
    if (count > available) return `Labour Count cannot exceed Site-In Labour: ${available}.`;
    if (!row.work_type) return "Work Type is required.";
    if (!row.work_description.trim()) return "Work Description is required.";
    if (row.work_type === "productive") {
      if (!row.quantity || Number(row.quantity) <= 0) return "Quantity is required for Productive work.";
      if (!row.unit.trim()) return "Unit is required for Productive work.";
    }
    if (row.quantity && Number.isNaN(Number(row.quantity))) return "Quantity must be numeric.";
    return "";
  }

  async function uploadPhoto(workLogId: string, row: WorkRow, accessToken: string) {
    const formData = new FormData();
    if (!row.photo_file) throw new Error("Photo file is required.");
    formData.set("file", row.photo_file);
    formData.set("reference_type", "work_log");
    formData.set("reference_id", workLogId);
    formData.set("photo_type", "normal_work");
    formData.set("capture_source", row.photo_capture_source || "upload");
    formData.set("captured_at", row.photo_captured_at || new Date().toISOString());
    const response = await fetch("/api/labour/photo-evidence", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    });
    const payload = await readPayload(response);
    if (!response.ok) throw new Error(payload.error || "Could not upload photo.");
    return payload;
  }

  async function saveDraftRows(options: { silent?: boolean } = {}) {
    if (!context.company_id || !context.site_id || !context.work_date) {
      setMessage("Company, site and work date are required.");
      return { ok: false, savedCount: 0, rows };
    }
    if (!rows.length) {
      setMessage("Add at least one Daily Work row.");
      return { ok: false, savedCount: 0, rows };
    }
    setSaving(true);
    if (!options.silent) setMessage("");
    let savedCount = 0;
    const accessToken = await token();
    const nextRows = [...rows];
    for (let index = 0; index < nextRows.length; index += 1) {
      const row = nextRows[index];
      if (row.saved && !row.dirty && !row.photo_file) continue;
      const clientError = validateClient(row);
      if (clientError) {
        nextRows[index] = { ...row, error: clientError };
        continue;
      }
      nextRows[index] = { ...row, saving: true, error: "" };
      setRows([...nextRows]);
      try {
        const response = await fetch("/api/labour/work-logs", {
          method: row.id ? "PUT" : "POST",
          headers: { "content-type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ ...row, ...context, photo_pending: Boolean(row.photo_file) }),
        });
        const payload = await readPayload(response);
        if (!response.ok) throw new Error(payload.error || "Could not save row.");
        const workLogId = row.id || payload.work_log_id;
        let photoId = "";
        if (row.photo_file) {
          const photoPayload = await uploadPhoto(workLogId, row, accessToken);
          photoId = photoPayload.photo_id || "";
        }
        savedCount += 1;
        nextRows[index] = {
          ...row,
          id: workLogId,
          photo_file: null,
          photo_capture_source: "upload",
          photo_captured_at: "",
          photo_count: row.photo_file ? 1 : row.photo_count || 0,
          photo_ids: photoId ? [photoId] : row.photo_ids || [],
          saved: true,
          saving: false,
          dirty: false,
          error: "",
        };
      } catch (error: any) {
        nextRows[index] = { ...row, saving: false, error: error.message || "Could not save row." };
      }
      setRows([...nextRows]);
    }
    setSaving(false);
    const hasFailedRows = nextRows.some((row) => row.error);
    const hasPendingChanges = nextRows.some((row) => !row.saved || row.dirty || row.photo_file);
    setDirty(hasFailedRows || hasPendingChanges);
    if (!options.silent) {
      setMessage(savedCount ? `Saved ${savedCount} Daily Work row${savedCount === 1 ? "" : "s"}.` : hasFailedRows ? "No rows were saved. Fix row errors and try again." : "No Daily Work changes to save.");
    }
    return { ok: !hasFailedRows && !hasPendingChanges, savedCount, rows: nextRows };
  }

  async function saveDraft() {
    await saveDraftRows();
  }

  async function submitDay() {
    if (saving || submitting) return;
    if (!rows.length) return setMessage("Add at least one Daily Work row before submitting.");
    setSubmitting(true);
    setMessage("");
    const saveResult = await saveDraftRows({ silent: true });
    if (!saveResult.ok) {
      setSubmitting(false);
      return setMessage("Fix Daily Work row errors before submitting.");
    }
    const savedRows = saveResult.rows || rows;
    const contractorIds = Array.from(new Set(savedRows.filter((row) => row.saved && row.contractor_profile_id).map((row) => row.contractor_profile_id)));
    if (!contractorIds.length) {
      setSubmitting(false);
      return setMessage("Save at least one Daily Work row before submitting.");
    }
    let submittedCount = 0;
    const accessToken = await token();
    try {
      for (const contractorProfileId of contractorIds) {
        const response = await fetch("/api/labour/approvals", {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ ...context, contractor_profile_id: contractorProfileId }),
        });
        const payload = await readPayload(response);
        if (!response.ok) throw new Error(payload.error || "Could not submit Daily Work package.");
        submittedCount += 1;
      }
      setMessage(`Submitted ${submittedCount} contractor package${submittedCount === 1 ? "" : "s"} for PM approval.`);
      await loadContext(context);
    } catch (error: any) {
      setMessage(error.message || "Could not submit Daily Work package.");
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteSavedRow(row: WorkRow) {
    if (!row.id || !canDelete) return;
    const response = await fetch(`/api/labour/work-logs?id=${encodeURIComponent(row.id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${await token()}` },
    });
    const payload = await readPayload(response);
    if (!response.ok) return setMessage(payload.error || "Could not remove row.");
    await loadContext(context);
  }

  const field = "h-10 w-full rounded-md border px-2 text-sm disabled:bg-slate-100";
  const compactField = "h-9 w-full rounded-md border px-2 text-sm disabled:bg-slate-100";
  const label = "text-xs font-bold uppercase tracking-wide text-slate-500";
  const canSave = canAdd || canEdit;
  const rowsByContractor = useMemo(() => {
    const grouped = new Map<string, WorkRow[]>();
    for (const contractor of contractors) grouped.set(contractor.id, []);
    for (const row of rows) {
      const key = row.contractor_profile_id || "__unassigned";
      grouped.set(key, [...(grouped.get(key) || []), row]);
    }
    return grouped;
  }, [contractors, rows]);

  async function openPhoto(row: WorkRow) {
    const photoId = row.photo_ids?.[0];
    if (!photoId) return;
    try {
      const response = await fetch(`/api/labour/photo-evidence/${encodeURIComponent(photoId)}`, { headers: { Authorization: `Bearer ${await token()}` } });
      const payload = await readPayload(response);
      if (!response.ok) throw new Error(payload.error || "Could not open photo.");
      if (payload.url) window.open(payload.url, "_blank", "noopener,noreferrer");
    } catch (error: any) {
      setMessage(error.message || "Could not open photo.");
    }
  }

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-slate-950 md:px-10">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Labour Management</p>
          <h1 className="text-3xl font-semibold">Daily Work Log</h1>
          <p className="mt-1 text-sm text-slate-600">Record site work from Site-In labour only. Attendance is not required for Daily Work.</p>
        </header>

        {message && <div className="rounded-lg border bg-white p-3 text-sm">{message}</div>}

        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-4">
            <label>
              <span className={label}>Company</span>
              <select className={field} value={context.company_id} disabled={loading || saving} onChange={(event) => updateContext({ company_id: event.target.value })}>
                <option value="">Select Company</option>
                {companies.map((company) => <option key={company.id} value={company.id}>{company.company_name}</option>)}
              </select>
            </label>
            <label>
              <span className={label}>Site</span>
              <select className={field} value={context.site_id} disabled={loading || saving || !context.company_id} onChange={(event) => updateContext({ site_id: event.target.value })}>
                <option value="">Select Site</option>
                {sites.map((site) => <option key={site.id} value={site.id}>{site.site_name}</option>)}
              </select>
            </label>
            <label>
              <span className={label}>Work Date</span>
              <input className={field} type="date" value={context.work_date} disabled={loading || saving} onChange={(event) => updateContext({ work_date: event.target.value })} />
            </label>
            <div className="flex items-end">
              <button type="button" onClick={() => loadContext(context)} disabled={loading || saving || !context.company_id || !context.site_id || !context.work_date} className="h-10 w-full rounded-md bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60">
                {loading ? "Loading..." : "Load Draft"}
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Work Entries</h2>
              <p className="text-sm text-slate-600">{contractors.length ? `${contractors.length} contractor${contractors.length === 1 ? "" : "s"} with Site-In labour available.` : "No Site-In contractors for this context."}</p>
            </div>
          </div>

          <div className="space-y-4">
            {!contractors.length && <div className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-slate-500">Load a Site/date with Site-In contractors to begin.</div>}
            {contractors.map((contractor) => {
              const contractorRows = rowsByContractor.get(contractor.id) || [];
              return (
                <div key={contractor.id} className="overflow-hidden rounded-lg border">
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-3 py-2">
                    <div>
                      <p className="font-semibold">{contractorName(contractor)}</p>
                      <p className="text-xs text-slate-500">
                        Assigned Engineer: {contractor.assigned_engineer_name || "Not assigned"} · Site-In Labour: {contractor.site_in_count || 0}
                      </p>
                    </div>
                    <button type="button" onClick={() => addRow(contractor.id)} disabled={saving || submitting || !canAdd} className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-xs font-semibold text-white disabled:opacity-60">
                      <Plus className="h-4 w-4" /> Add Row
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-[1050px] w-full text-sm">
                      <thead className="bg-white text-left text-xs uppercase text-slate-500">
                        <tr>
                          {["S.No.", "Labour Count", "Work Type", "Work Description", "Quantity + Unit", "Photo", "Remarks", "Action"].map((heading) => <th key={heading} className="px-2 py-2">{heading}</th>)}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {!contractorRows.length && <tr><td colSpan={8} className="px-3 py-5 text-center text-slate-500">No Daily Work rows for this contractor yet.</td></tr>}
                        {contractorRows.map((row, index) => {
                          const count = siteInCount(row);
                          const disabled = saving || submitting || row.saving || (row.saved && (!canEdit || row.status !== "draft"));
                          const globalIndex = rows.findIndex((item) => item.client_id === row.client_id) + 1;
                          return (
                            <tr key={row.client_id} className={row.error ? "bg-red-50/40" : ""}>
                              <td className="px-2 py-2 align-top font-semibold">{globalIndex || index + 1}</td>
                              <td className="px-2 py-2 align-top">
                                <input className={compactField} type="number" min="1" step="1" value={row.labour_count} disabled={disabled} onChange={(event) => patchRow(row.client_id, { labour_count: event.target.value })} />
                                <span className="mt-1 block text-[11px] text-slate-500">Site-In Labour : {count || "-"}</span>
                              </td>
                              <td className="px-2 py-2 align-top">
                                <select className={compactField} value={row.work_type} disabled={disabled} onChange={(event) => patchRow(row.client_id, { work_type: event.target.value as WorkRow["work_type"], quantity: "", unit: "" })}>
                                  <option value="productive">Productive</option>
                                  <option value="non_productive">Non Productive</option>
                                </select>
                              </td>
                              <td className="px-2 py-2 align-top">
                                <input className={compactField} value={row.work_description} disabled={disabled} onChange={(event) => patchRow(row.client_id, { work_description: event.target.value })} placeholder="Brick Work, Rain Delay..." />
                              </td>
                              <td className="px-2 py-2 align-top">
                                <div className="flex gap-1.5">
                                  <input className={compactField} type="number" min="0" step="0.001" value={row.quantity} disabled={disabled} onChange={(event) => patchRow(row.client_id, { quantity: event.target.value })} placeholder="25" />
                                  <input className={compactField} value={row.unit} disabled={disabled} onChange={(event) => patchRow(row.client_id, { unit: event.target.value })} placeholder="Sqm" />
                                </div>
                              </td>
                              <td className="px-2 py-2 align-top">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <label className={`inline-flex h-8 cursor-pointer items-center rounded-md border px-2 text-xs font-semibold ${disabled ? "pointer-events-none opacity-60" : ""}`}>
                                    {row.photo_file || row.photo_count ? "Replace" : "Upload"}
                                    <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={(event) => patchRow(row.client_id, { photo_file: event.target.files?.[0] || null, photo_capture_source: "upload", photo_captured_at: new Date().toISOString() })} />
                                  </label>
                                  <label className={`inline-flex h-8 cursor-pointer items-center rounded-md border px-2 text-xs font-semibold ${disabled ? "pointer-events-none opacity-60" : ""}`}>
                                    Open Camera
                                    <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={disabled} onChange={(event) => patchRow(row.client_id, { photo_file: event.target.files?.[0] || null, photo_capture_source: "constructiq_camera_v1", photo_captured_at: new Date().toISOString() })} />
                                  </label>
                                  {row.photo_ids?.length ? <button type="button" onClick={() => openPhoto(row)} className="h-8 rounded-md border px-2 text-xs font-semibold">View</button> : null}
                                  {row.photo_file ? <button type="button" onClick={() => patchRow(row.client_id, { photo_file: null })} className="h-8 rounded-md border px-2 text-xs font-semibold text-red-700">Remove</button> : null}
                                </div>
                                <span className="mt-1 block truncate text-[11px] text-slate-500" title={row.photo_file?.name || ""}>
                                  {previewPhotoLabel(row)}
                                </span>
                              </td>
                              <td className="px-2 py-2 align-top">
                                <input className={compactField} value={row.remarks} disabled={disabled} onChange={(event) => patchRow(row.client_id, { remarks: event.target.value })} />
                              </td>
                              <td className="px-2 py-2 align-top">
                                {!row.id ? (
                                  <button type="button" aria-label="Remove row" onClick={() => removeLocalRow(row.client_id)} disabled={saving} className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-200 text-red-700 disabled:opacity-60"><X className="h-4 w-4" /></button>
                                ) : (
                                  <button type="button" onClick={() => deleteSavedRow(row)} disabled={saving || !canDelete} className="rounded-md border px-2 py-1 text-xs font-semibold text-red-700 disabled:opacity-60">Remove</button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {contractorRows.some((row) => row.error) && (
                          <tr className="bg-red-50/60">
                            <td colSpan={8} className="px-3 py-2 text-xs font-semibold text-red-700">
                              {contractorRows.filter((row) => row.error).map((row) => row.error).join(" ")}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex justify-end">
            <button type="button" onClick={saveDraft} disabled={saving || submitting || !canSave || !rows.length} className="rounded-lg bg-slate-950 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {saving ? "Saving Draft..." : "Save Draft"}
            </button>
            <button type="button" onClick={submitDay} disabled={saving || submitting || !rows.length || !canSubmit} className="ml-2 rounded-lg bg-sky-700 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {submitting ? "Submitting..." : "Submit Day"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
