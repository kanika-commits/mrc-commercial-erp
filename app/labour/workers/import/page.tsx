"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, FileSpreadsheet, Play } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { maskAadhaar, normalizeLookup } from "@/lib/labour/constants";
import { labourImportMasterLookupKeys } from "@/lib/labour/import";

const MASTER_MAPPING_KEY = "__master_mappings";
const WORK_ORDER_MAPPING_KEY = "__work_order_mappings";
const DOCUMENT_FOLDER_SOURCE_KEY = "__document_folder_source";
const MASTER_GROUPS = [
  { key: "companies", title: "Companies", sourceField: "company_text" },
  { key: "sites", title: "Sites", sourceField: "site_text" },
  { key: "contractors", title: "Contractors", sourceField: "contractor_text" },
  { key: "trades", title: "Labour Categories / Trades", sourceField: "trade" },
] as const;
type ImportStep = "upload" | "mapping" | "preview" | "permission" | "checking" | "review" | "importing" | "completed";
const DOCUMENT_FIELDS = [
  { field: "photo_drive_url", filenameField: "photo_filename", shortLabel: "Photo" },
  { field: "aadhaar_front_drive_url", filenameField: "aadhaar_front_filename", shortLabel: "Aadhaar Front" },
  { field: "aadhaar_back_drive_url", filenameField: "aadhaar_back_filename", shortLabel: "Aadhaar Back" },
  { field: "aadhaar_combined_drive_url", filenameField: "aadhaar_combined_filename", shortLabel: "Combined Aadhaar" },
  { field: "pan_drive_url", filenameField: "pan_filename", shortLabel: "PAN" },
  { field: "bank_proof_drive_url", filenameField: "bank_proof_filename", shortLabel: "Bank Proof" },
  { field: "other_document_drive_url", filenameField: "other_document_filename", shortLabel: "Other" },
] as const;

function documentReferenceValue(...values: unknown[]) {
  for (const value of values) {
    const text = String(value || "").trim();
    const key = normalizeLookup(text);
    if (!text) continue;
    if (["-", "--", "NA", "N A", "N/A", "NOT AVAILABLE", "NOT APPLICABLE"].includes(key)) continue;
    return text;
  }
  return "";
}

function hasPlaceholderDocumentReference(...values: unknown[]) {
  return values.some((value) => {
    const text = String(value || "").trim();
    const key = normalizeLookup(text);
    return Boolean(text) && ["-", "--", "NA", "N A", "N/A", "NOT AVAILABLE", "NOT APPLICABLE"].includes(key);
  });
}

function documentRows(normalized: any, row: any, documentAccessChecked = false, preAccess = false) {
  const manifest = normalized?.document_manifest || {};
  const warnings = normalized?.document_import_warnings || [];
  const rowMessages = [...(row?.validation_errors || []), ...(row?.validation_warnings || [])];
  return DOCUMENT_FIELDS
    .filter(({ field, filenameField }) => documentReferenceValue(normalized?.[filenameField], normalized?.[field]) || hasPlaceholderDocumentReference(normalized?.[filenameField], normalized?.[field]))
    .map(({ field, filenameField, shortLabel }) => {
      const entry = manifest[field];
      const warning = warnings.find((item: string) => item.toLowerCase().startsWith(shortLabel.toLowerCase()));
      const rowMessage = rowMessages.find((item: string) => item.toLowerCase().startsWith(shortLabel.toLowerCase()));
      const notProvided = !documentReferenceValue(normalized?.[filenameField], normalized?.[field]) && hasPlaceholderDocumentReference(normalized?.[filenameField], normalized?.[field]);
      const sourceName = documentReferenceValue(normalized?.[`${field}_display_name`], normalized?.[filenameField], normalized?.[field]) || entry?.original_file_name || "";
      if (preAccess) {
        return {
          field,
          shortLabel,
          status: notProvided ? "not_provided" : "pending",
          fileName: null,
          message: notProvided ? "Not Provided" : sourceName || "Pending access",
        };
      }
      const issueMessage = rowMessage ? rowMessage.replace(new RegExp(`^${shortLabel}:\\s*`, "i"), "") : "";
      const issueStatus = issueMessage.toLowerCase().includes("valid google drive file link") || issueMessage.toLowerCase().includes("not a google drive file link") ? "invalid_link" : issueMessage.toLowerCase().includes("pdf or image") ? "unsupported" : issueMessage ? "access_failed" : "missing";
      return {
        field,
        shortLabel,
        status: notProvided ? "not_provided" : Boolean(entry) && !warning && !rowMessage ? "accessible" : issueStatus,
        fileName: sourceName || entry?.original_file_name || null,
        message: notProvided ? "Not Provided" : warning ? "Download Failed" : issueMessage || sourceName || entry?.original_file_name || "Matched",
      };
    });
}

function documentSummary(normalized: any, row: any, documentAccessChecked = false) {
  const docs = documentRows(normalized, row, documentAccessChecked);
  const failed = Number(normalized?.document_import_warnings?.length || 0) || docs.filter((doc) => ["missing", "duplicate", "unsupported", "invalid_link", "access_failed"].includes(doc.status)).length;
  const found = Number(normalized?.documents_found || 0);
  const imported = normalized?.document_import_status ? Math.max(0, found - failed) : found;
  if (!docs.length) return "—";
  if (normalized?.document_import_status) {
    return failed ? `${imported} Imported • ${failed} Failed` : `${imported} Imported`;
  }
  return `${found} Found`;
}

function finalStatus(row: any) {
  if (row.execution_status === "executed" && row.normalized_data?.document_import_warnings?.length) return "Imported With Document Warnings";
  if (row.execution_status === "executed") return "Imported Successfully";
  if (row.execution_status === "skipped" || row.selected_action === "skip" || row.matched_labour_worker_id) return "Already Exists";
  if (row.execution_status === "failed" || row.validation_status === "failed") return "Import Failed";
  if (row.validation_status === "blocked") return "Validation Failed";
  return row.validation_status || "Pending";
}

function statusClass(status: string) {
  if (status === "Imported Successfully") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "Imported With Document Warnings") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "Already Exists") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "Validation Failed" || status === "Import Failed") return "border-red-200 bg-red-50 text-red-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function rowRemarks(row: any, documentAccessChecked = false) {
  const issues = [...(row.validation_errors || []), ...(row.validation_warnings || [])];
  return issues.length ? issues.join("; ") : "—";
}

function labelizeStatus(value: string) {
  if (!value) return "-";
  if (value === "ready") return "Ready";
  if (value === "warning") return "Warning";
  if (value === "blocked") return "Blocked";
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function optionDisplay(option: any) {
  if (!option) return "";
  return `${option.name || option.label || option.wo_number || option.id}${option.code ? ` / ${option.code}` : ""}`;
}

function optionMatchesSource(option: any, sourceValue: string) {
  const sourceKey = normalizeLookup(sourceValue);
  if (!sourceKey) return false;
  const candidates = [
    option.name,
    option.code,
    option.label,
    option.wo_number,
    String(option.name || "").replace(/\([^)]*\)/g, ""),
    ...String(option.name || "").split("/"),
    ...String(sourceValue || "").split("/"),
  ];
  return candidates.some((candidate) => normalizeLookup(candidate) === sourceKey);
}

function masterMappingKey(groupKey: string, sourceValue: string) {
  return labourImportMasterLookupKeys(sourceValue, groupKey === "contractors" ? { splitCompound: true, stripParenthetical: true } : {})[0] || "";
}

function resolvedMasterOption(groupKey: string, sourceValue: string, options: any[], mapping: Record<string, Record<string, string>>) {
  const sourceKey = masterMappingKey(groupKey, sourceValue);
  const mappedId = mapping[groupKey]?.[sourceKey] || "";
  if (mappedId) return options.find((option: any) => option.id === mappedId) || null;
  const matches = options.filter((option: any) => optionMatchesSource(option, sourceValue));
  return matches.length === 1 ? matches[0] : null;
}

async function readPayload(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || "Request failed." };
  }
}

function filenameFromDisposition(disposition: string | null, fallback: string) {
  const value = disposition || "";
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1].replace(/^"|"$/g, ""));
  const match = value.match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}

export default function LabourImportPage() {
  const [workbook, setWorkbook] = useState<File | null>(null);
  const [batchId, setBatchId] = useState("");
  const [preview, setPreview] = useState<any>({ rows: [], batch: null });
  const [message, setMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [masterMappingDraft, setMasterMappingDraft] = useState<Record<string, Record<string, string>>>({});
  const [workOrderMappingDraft, setWorkOrderMappingDraft] = useState<Record<string, string>>({});
  const [step, setStep] = useState<ImportStep>("upload");

  async function token() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  }

  async function uploadWorkbook() {
    if (!workbook || busy) return;
    setBusy("Uploading workbook...");
    setMessage(null);
    setBatchId("");
    setPreview({ rows: [], batch: null });
    setMasterMappingDraft({});
    setWorkOrderMappingDraft({});
    setStep("upload");
    try {
      const body = new FormData();
      body.set("file", workbook);
      const response = await fetch("/api/labour/import/upload", { method: "POST", headers: { Authorization: `Bearer ${await token()}` }, body });
      const payload = await readPayload(response);
      if (!response.ok) return setMessage({ type: "error", text: payload.error || "Upload failed." });
      const nextMapping = payload.mapping || (payload.document_folder_source ? { [DOCUMENT_FOLDER_SOURCE_KEY]: payload.document_folder_source } : {});
      setBatchId(payload.batch_id);
      setPreview({ rows: [], batch: { id: payload.batch_id, mapping: nextMapping, status: "uploaded" } });
      setMessage({ type: "success", text: `Uploaded ${payload.rows} row(s) from ${payload.sheet_name}.` });
      await loadPreview(payload.batch_id);
      setStep("mapping");
    } finally {
      setBusy("");
    }
  }

  async function validate() {
    if (!batchId || busy) return;
    setBusy("Validating...");
    setMessage(null);
    try {
      const response = await fetch("/api/labour/import/validate", { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ batch_id: batchId }) });
      const payload = await readPayload(response);
      if (!response.ok) return setMessage({ type: "error", text: payload.error || "Validation failed." });
      setMessage({ type: "success", text: `Ready ${payload.summary.ready_rows}, existing/warnings ${payload.summary.warnings}, invalid ${payload.summary.blocked_rows}.` });
      await loadPreview();
    } finally {
      setBusy("");
    }
  }

  async function validateBatch(batchToValidate = batchId) {
    if (!batchToValidate) return null;
    const response = await fetch("/api/labour/import/validate", { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ batch_id: batchToValidate }) });
    const payload = await readPayload(response);
    if (!response.ok) throw new Error(payload.error || "Validation failed.");
    return payload;
  }

  async function loadPreview(batchToLoad = batchId) {
    if (!batchToLoad) return;
    const response = await fetch(`/api/labour/import/preview?batch_id=${batchToLoad}`, { headers: { Authorization: `Bearer ${await token()}` } });
    const payload = await readPayload(response);
    if (response.ok) setPreview(payload);
    else setMessage({ type: "error", text: payload.error || "Preview failed." });
  }

  async function saveMasterMappings() {
    if (!batchId || busy) return;
    setBusy("Saving ERP master mappings...");
    setMessage(null);
    try {
      const response = await fetch("/api/labour/import/mapping", {
        method: "PATCH",
        headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ batch_id: batchId, mapping: { [MASTER_MAPPING_KEY]: masterMappingDraft, [WORK_ORDER_MAPPING_KEY]: sanitizedWorkOrderMappings } }),
      });
      const payload = await readPayload(response);
      if (!response.ok) return setMessage({ type: "error", text: payload.error || "Failed to save ERP master mappings." });
      await validateBatch(batchId);
      setMessage({ type: "success", text: "ERP master mappings saved. Review worker document links before document access." });
      await loadPreview();
      setStep("preview");
    } catch (error: any) {
      setMessage({ type: "error", text: error.message || "Failed to save ERP master mappings." });
    } finally {
      setBusy("");
    }
  }

  async function verifyFolder() {
    if (!batchId || busy) return;
    setStep("checking");
    setBusy("Checking worker documents...");
    setMessage(null);
    try {
      const validation = await validateBatch(batchId);
      setMessage({ type: "success", text: `Worker documents checked. Ready ${validation?.summary?.ready_rows || 0}, warning ${validation?.summary?.warnings || 0}, blocked ${validation?.summary?.blocked_rows || 0}.` });
      await loadPreview();
      setStep("review");
    } catch (error: any) {
      setStep("permission");
      setMessage({ type: "error", text: error.message || "ConstructIQ could not access the worker documents." });
    } finally {
      setBusy("");
    }
  }

  async function execute() {
    if (!batchId || busy) return;
    const importableRows = rows.filter((row: any) => ["ready", "warning"].includes(row.validation_status) && row.selected_action === "create").length;
    if (!window.confirm(`Confirm Labour Import? ${importableRows} ready/warning row(s) will be imported and blocked rows will be skipped.`)) return;
    setStep("importing");
    setBusy("Confirming import...");
    setMessage(null);
    try {
      const response = await fetch("/api/labour/import/execute", { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ batch_id: batchId }) });
      const payload = await readPayload(response);
      if (!response.ok) throw new Error(payload.error || "Confirm import failed.");
      setMessage({ type: "success", text: `Imported ${payload.executed}, skipped ${payload.skipped}, failed ${payload.failed}.` });
      await loadPreview();
      setStep("completed");
    } catch (error: any) {
      setStep("review");
      setMessage({ type: "error", text: error.message || "Confirm import failed." });
    } finally {
      setBusy("");
    }
  }

  async function downloadReport(label = "labour-import-report") {
    if (!batchId || busy) return;
    setBusy("Downloading report...");
    setMessage(null);
    try {
      const response = await fetch(`/api/labour/import/report?batch_id=${batchId}`, { headers: { Authorization: `Bearer ${await token()}` } });
      const payloadType = response.headers.get("content-type") || "";
      if (!response.ok) {
        const payload = payloadType.includes("application/json") ? await response.json().catch(() => ({})) : {};
        throw new Error(payload.error || "Failed to download report.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filenameFromDisposition(response.headers.get("content-disposition"), `${label}-${batchId}.xls`);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      setMessage({ type: "error", text: error.message || "Failed to download report." });
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    if (batchId) loadPreview();
  }, [batchId]);

  useEffect(() => {
    setMasterMappingDraft(preview.batch?.mapping?.[MASTER_MAPPING_KEY] || {});
    setWorkOrderMappingDraft(preview.batch?.mapping?.[WORK_ORDER_MAPPING_KEY] || {});
    if (preview.batch && ["executed", "failed"].includes(preview.batch.status)) setStep("completed");
  }, [preview.batch?.id, preview.batch?.mapping]);

  const rows = preview.rows || [];
  const batchLoaded = Boolean(preview.batch?.id === batchId);
  const importCompleted = ["executed", "failed"].includes(preview.batch?.status) || rows.some((row: any) => ["executed", "skipped", "failed"].includes(row.execution_status));
  const documentAccessChecked = ["review", "importing", "completed"].includes(step) || importCompleted;
  const preAccess = !documentAccessChecked && ["mapping", "preview", "permission"].includes(step);
  const masterValues = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const group of MASTER_GROUPS) {
      const values = new Map<string, string>();
      for (const row of rows) {
        const value = String(row.normalized_data?.[group.sourceField] || "").trim();
        const key = normalizeLookup(value);
        if (key && !values.has(key)) values.set(key, value);
      }
      result[group.key] = Array.from(values.values()).sort((a, b) => a.localeCompare(b));
    }
    return result;
  }, [rows]);
  const workOrderOptions = preview.master_options?.work_orders || [];
  const contractorSitePairs = useMemo(() => {
    const result: any[] = [];
    const seen = new Set<string>();
    const contractorOptions = preview.master_options?.contractors || [];
    const siteOptions = preview.master_options?.sites || [];
    for (const row of rows) {
      const contractorText = String(row.normalized_data?.contractor_text || "").trim();
      const siteText = String(row.normalized_data?.site_text || "").trim();
      const contractor = resolvedMasterOption("contractors", contractorText, contractorOptions, masterMappingDraft);
      const site = resolvedMasterOption("sites", siteText, siteOptions, masterMappingDraft);
      if (!contractor?.id || !site?.id) continue;
      const mappingKey = `${contractor.id}:${site.id}`;
      if (seen.has(mappingKey)) continue;
      seen.add(mappingKey);
      result.push({
        mappingKey,
        contractorId: contractor.id,
        siteId: site.id,
        contractorSourceKey: masterMappingKey("contractors", contractorText),
        contractorName: optionDisplay(contractor) || contractorText,
        siteName: optionDisplay(site) || siteText,
        options: workOrderOptions.filter((option: any) => option.vendor_id === contractor.id && option.site_id === site.id),
      });
    }
    return result.sort((a, b) => `${a.contractorName} ${a.siteName}`.localeCompare(`${b.contractorName} ${b.siteName}`));
  }, [rows, preview.master_options, masterMappingDraft, workOrderOptions]);
  const sanitizedWorkOrderMappings = useMemo(() => {
    const validSelections = new Map<string, Set<string>>();
    for (const option of workOrderOptions) {
      if (!option.vendor_id || !option.site_id || !option.id) continue;
      const key = `${option.vendor_id}:${option.site_id}`;
      const ids = validSelections.get(key) || new Set<string>();
      ids.add(option.id);
      validSelections.set(key, ids);
    }
    return Object.fromEntries(
      Object.entries(workOrderMappingDraft).filter(([key, value]) => value && validSelections.get(key)?.has(value)),
    );
  }, [workOrderMappingDraft, workOrderOptions]);
  useEffect(() => {
    if (!contractorSitePairs.length) return;
    setWorkOrderMappingDraft((current) => {
      let changed = false;
      const next = { ...current };
      for (const pair of contractorSitePairs) {
        const currentValue = next[pair.mappingKey] || "";
        const currentStillValid = pair.options.some((option: any) => option.id === currentValue);
        if (currentValue && !currentStillValid) {
          next[pair.mappingKey] = "";
          changed = true;
        }
        if (!next[pair.mappingKey] && pair.options.length === 1) {
          next[pair.mappingKey] = pair.options[0].id;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [contractorSitePairs]);
  const hasMasterValues = MASTER_GROUPS.some((group) => (masterValues[group.key] || []).length > 0);
  const importableRows = rows.filter((row: any) => ["ready", "warning"].includes(row.validation_status) && row.selected_action === "create").length;
  const summary = useMemo(() => ({
    total: rows.length,
    ready: rows.filter((row: any) => row.validation_status === "ready" || row.validation_status === "warning").length,
    existing: rows.filter((row: any) => row.selected_action === "skip" || row.matched_labour_worker_id).length,
    invalid: rows.filter((row: any) => row.validation_status === "blocked" || row.validation_status === "failed").length,
    warnings: rows.filter((row: any) => row.validation_status === "warning").length,
    imported: rows.filter((row: any) => row.execution_status === "executed" && !row.normalized_data?.document_import_warnings?.length).length,
    importedWithWarnings: rows.filter((row: any) => row.execution_status === "executed" && row.normalized_data?.document_import_warnings?.length).length,
    failed: rows.filter((row: any) => row.execution_status === "failed").length,
    skipped: rows.filter((row: any) => row.execution_status === "skipped" || row.selected_action === "skip" || row.matched_labour_worker_id).length,
    documentsFound: rows.reduce((sum: number, row: any) => sum + Number(row.normalized_data?.documents_found || 0), 0),
    documentsImported: rows.reduce((sum: number, row: any) => sum + Math.max(0, Number(row.normalized_data?.documents_found || 0) - Number(row.normalized_data?.document_import_warnings?.length || 0)), 0),
    documentsFailed: rows.reduce((sum: number, row: any) => sum + Number(row.normalized_data?.document_import_warnings?.length || 0), 0),
    documentsMissing: rows.reduce((sum: number, row: any) => sum + Math.max(0, Number(row.normalized_data?.documents_expected || 0) - Number(row.normalized_data?.documents_found || 0)), 0),
    documentLinks: rows.reduce((sum: number, row: any) => sum + Number(row.normalized_data?.documents_expected || 0), 0),
    matchedDocuments: Number(preview.batch?.summary?.matched_documents || 0),
  }), [rows, preview.batch]);

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-slate-950 md:px-10">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Labour Registration</p>
            <h1 className="text-3xl font-semibold">Labour Import</h1>
            <p className="mt-1 text-sm text-slate-600">Bulk create labour and initial deployment from the current registration rules. Attendance, Site-In, Daily Work and approvals are not imported.</p>
          </div>
          <div className="flex gap-2">
            <a href="/templates/ConstructIQ_Labour_Import_Template.xlsx" className="inline-flex h-10 items-center gap-2 rounded-md border bg-white px-4 text-sm font-semibold"><Download className="h-4 w-4" /> Download Template</a>
            <Link href="/labour/workers/new" className="inline-flex h-10 items-center rounded-md border bg-white px-4 text-sm font-semibold">Back to Registration</Link>
          </div>
        </header>

        {message && <div className={`rounded-lg border bg-white p-3 text-sm font-semibold ${message.type === "error" ? "text-red-700" : "text-slate-700"}`}>{message.text}</div>}
        {busy && <div className="rounded-lg border bg-white p-3 text-sm font-semibold text-slate-700">{busy}</div>}

        {importCompleted && (
          <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
            <h2 className="text-xl font-semibold text-emerald-900">Import Completed ✓</h2>
            <p className="mt-1 text-sm text-emerald-800">
              {summary.imported} labourers imported. {summary.skipped} already existed.
              {summary.importedWithWarnings ? ` ${summary.importedWithWarnings} imported with document warnings.` : ""}
            </p>
          </section>
        )}

        {!importCompleted && <section className="grid gap-3 rounded-lg border bg-white p-4 shadow-sm lg:grid-cols-[minmax(0,1fr)_auto]">
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
            Completed Excel
            <input type="file" accept=".xlsx,.xlsm" disabled={Boolean(busy)} onChange={(event) => setWorkbook(event.target.files?.[0] || null)} className="mt-1 h-11 w-full rounded-md border px-3 py-2 text-sm font-normal normal-case tracking-normal" />
          </label>
          <button type="button" disabled={!workbook || Boolean(busy)} onClick={uploadWorkbook} className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50"><FileSpreadsheet className="h-4 w-4" /> Upload & Preview</button>
        </section>}

        {batchId && !importCompleted && step === "permission" && (
          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Document Access</p>
            <h2 className="mt-1 text-lg font-semibold">Allow ConstructIQ to access and import the available worker documents from Google Drive?</h2>
            <p className="mt-1 text-sm text-slate-600">ConstructIQ will verify each document link shown in the worker rows and copy available files into private ERP storage during import.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={Boolean(busy)} onClick={() => setStep("preview")} className="inline-flex h-10 items-center justify-center rounded-md border bg-white px-4 text-sm font-semibold disabled:opacity-50">Back</button>
              <button type="button" disabled={!batchId || Boolean(busy)} onClick={verifyFolder} className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50">Continue</button>
            </div>
          </section>
        )}

        {batchId && !importCompleted && step === "checking" && (
          <section className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm font-semibold text-sky-800 shadow-sm">
            Checking worker documents...
          </section>
        )}

        <section className="grid gap-3 md:grid-cols-4 xl:grid-cols-6">
          {(importCompleted ? [
            ["Total Rows", summary.total],
            ["Imported Successfully", summary.imported],
            ["Already Exists", summary.skipped],
            ["Validation Failed", rows.filter((row: any) => row.validation_status === "blocked").length],
            ["Import Failed", summary.failed],
            ...(summary.importedWithWarnings ? [["Imported With Document Warnings", summary.importedWithWarnings]] : []),
          ] : [
            ["Total Workers", summary.total],
            ["Documents Matched", summary.matchedDocuments || summary.documentsFound],
            ["Ready", summary.ready],
            ["Warning", summary.warnings],
            ["Blocked", summary.invalid],
          ]).map(([label, value]) => <div key={label} className="rounded-lg border bg-white p-3 shadow-sm"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="text-2xl font-semibold">{value}</p></div>)}
        </section>

        {hasMasterValues && !importCompleted && step === "mapping" && (
          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-2 border-b pb-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold">ERP Master Value Mapping</h2>
                <p className="text-sm text-slate-600">Confirm workbook values against ERP masters. Saved mappings are used before automatic name/code matching.</p>
              </div>
              <button type="button" disabled={Boolean(busy)} onClick={saveMasterMappings} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> Save Mapping & Continue</button>
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              {MASTER_GROUPS.map((group) => {
                const options = preview.master_options?.[group.key] || [];
                const values = masterValues[group.key] || [];
                if (!values.length) return null;
                return (
                  <div key={group.key} className="rounded-md border">
                    <div className="border-b bg-slate-50 px-3 py-2 text-sm font-semibold">{group.title}</div>
                    <div className="divide-y">
                      {values.map((sourceValue) => {
                        const sourceKey = masterMappingKey(group.key, sourceValue);
                        const currentValue = masterMappingDraft[group.key]?.[sourceKey] || "";
                        const workOrderPairsForContractor = group.key === "contractors"
                          ? contractorSitePairs.filter((pair) => pair.contractorSourceKey === sourceKey)
                          : [];
                        return (
                          <div key={`${group.key}:${sourceKey}`} className="px-3 py-3">
                            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.9fr)] md:items-center">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-slate-800">{sourceValue}</p>
                              </div>
                              <select
                                value={currentValue}
                                disabled={Boolean(busy)}
                                onChange={(event) => setMasterMappingDraft((current) => ({
                                  ...current,
                                  [group.key]: {
                                    ...(current[group.key] || {}),
                                    [sourceKey]: event.target.value,
                                  },
                                }))}
                                className="h-10 rounded-md border px-3 text-sm"
                              >
                                <option value="">Auto match by name/code</option>
                                {options.map((option: any) => (
                                  <option key={option.id} value={option.id}>{option.name}{option.code ? ` / ${option.code}` : ""}</option>
                                ))}
                              </select>
                            </div>
                            {workOrderPairsForContractor.length ? (
                              <div className="mt-3 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                                {workOrderPairsForContractor.map((pair) => {
                                  const selectedValue = pair.options.some((option: any) => option.id === workOrderMappingDraft[pair.mappingKey])
                                    ? workOrderMappingDraft[pair.mappingKey]
                                    : "";
                                  return (
                                    <label key={pair.mappingKey} className="block text-xs font-bold uppercase tracking-wide text-slate-500">
                                      Work Order (Optional)
                                      <span className="mt-1 block text-[11px] font-medium normal-case tracking-normal text-slate-600">{pair.siteName}</span>
                                      <select
                                        value={selectedValue}
                                        disabled={Boolean(busy)}
                                        onChange={(event) => setWorkOrderMappingDraft((current) => ({
                                          ...current,
                                          [pair.mappingKey]: event.target.value,
                                        }))}
                                        className="mt-1 h-10 w-full rounded-md border bg-white px-3 text-sm font-normal normal-case tracking-normal text-slate-900"
                                      >
                                        <option value="">No Work Order</option>
                                        {pair.options.map((option: any) => (
                                          <option key={`${pair.mappingKey}:${option.id}`} value={option.id}>{option.label || `${option.wo_number || "WO"} — ${option.wo_type || "Work Order"}`}</option>
                                        ))}
                                      </select>
                                      {!pair.options.length && <span className="mt-1 block text-[11px] font-semibold normal-case tracking-normal text-amber-700">No Work Order found. Rows will import as Contractual Labour.</span>}
                                    </label>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {batchId && !importCompleted && step === "mapping" && !hasMasterValues && (
          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">ERP Master Value Mapping</h2>
            <p className="mt-1 text-sm text-slate-600">No workbook master values need manual mapping.</p>
            <button type="button" disabled={Boolean(busy)} onClick={() => setStep("preview")} className="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50">Continue to Worker Preview</button>
          </section>
        )}

        {batchId && !importCompleted && step === "preview" && (
          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">Worker Preview</h2>
            <p className="mt-1 text-sm text-slate-600">Review each worker and the document links from that same workbook row before document access.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={Boolean(busy)} onClick={() => setStep("mapping")} className="inline-flex h-10 items-center justify-center rounded-md border bg-white px-4 text-sm font-semibold disabled:opacity-50">Back to Mapping</button>
              <button type="button" disabled={Boolean(busy)} onClick={() => setStep("permission")} className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50">Continue</button>
            </div>
          </section>
        )}

        {batchId && !importCompleted && step === "review" && (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={Boolean(busy)} onClick={() => setStep("permission")} className="inline-flex h-10 items-center justify-center rounded-md border bg-white px-4 text-sm font-semibold disabled:opacity-50">Back</button>
            <button type="button" disabled={!batchId || Boolean(busy) || importableRows <= 0} onClick={execute} className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50"><Play className="h-4 w-4" /> Confirm Import</button>
            {batchId && <button type="button" disabled={Boolean(busy)} onClick={() => downloadReport("labour-import-error-report")} className="inline-flex h-10 items-center rounded-md border bg-white px-4 text-sm font-semibold disabled:opacity-50">Download Error Report</button>}
          </div>
        )}

        <section className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <div className="border-b px-4 py-3">
            <h2 className="text-lg font-semibold">{importCompleted ? "Import Results" : step === "review" ? "Final Review" : "Worker Preview"}</h2>
            <p className="text-sm text-slate-500">
              {importCompleted
                ? "Final result for every staged labour row."
                : step === "review"
                  ? "Review matched documents, warnings and blocked rows before confirming import."
                  : "Review worker details and document links before allowing document access."}
            </p>
          </div>
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>{(importCompleted ? ["Labour Code", "Labour Name", "Company", "Site", "Work Order", "Final Status", "Documents", "Remarks"] : ["Excel Row", "Worker", "Aadhaar", "Company", "Site", "Contractor", "Work Order", "Labour Category", "Trade", "Daily Rate", "Documents", "Status", "Errors / Warnings", "Import Action"]).map((header) => <th key={header} className="px-3 py-3">{header}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {!rows.length && <tr><td className="px-3 py-8 text-center text-slate-500" colSpan={importCompleted ? 8 : 14}>Upload and validate a workbook to review rows.</td></tr>}
              {rows.map((row: any) => {
                const n = row.normalized_data || {};
                const docs = documentRows(n, row, documentAccessChecked, preAccess);
                if (importCompleted) {
                  const status = finalStatus(row);
                  return (
                    <tr key={row.id}>
                      <td className="px-3 py-3 font-mono text-xs">{n.labour_code || row.labour_code || "-"}</td>
                      <td className="px-3 py-3 font-semibold">{row.worker_name || n.worker_name || "-"}</td>
                      <td className="px-3 py-3">{n.company_name || n.company_text || "-"}</td>
                      <td className="px-3 py-3">{n.site_name || n.site_text || "-"}</td>
                      <td className="px-3 py-3">{n.work_order_name || "No Work Order"}</td>
                      <td className="px-3 py-3"><span className={`rounded-full border px-2 py-1 text-xs font-semibold ${statusClass(status)}`}>{status}</span></td>
                      <td className="px-3 py-3">{documentSummary(n, row, documentAccessChecked)}</td>
                      <td className="max-w-md px-3 py-3 text-xs text-slate-600">{rowRemarks(row, documentAccessChecked)}</td>
                    </tr>
                  );
                }
                return (
                  <tr key={row.id}>
                    <td className="px-3 py-3">{row.source_row_number}</td>
                    <td className="px-3 py-3">{row.worker_name || n.worker_name || "-"}</td>
                    <td className="px-3 py-3">{n.masked_aadhaar || maskAadhaar(n.aadhaar_number || "") || "-"}</td>
                    <td className="px-3 py-3">{n.company_name || n.company_text || "-"}</td>
                    <td className="px-3 py-3">{n.site_name || n.site_text || "-"}</td>
                    <td className="px-3 py-3">{n.contractor_name || row.contractor_text || n.contractor_text || "-"}</td>
                    <td className="px-3 py-3">{n.work_order_name || "No Work Order"}</td>
                    <td className="px-3 py-3">{n.labour_category || n.employment_category || "-"}</td>
                    <td className="px-3 py-3">{n.trade_name || n.trade || "-"}</td>
                    <td className="px-3 py-3">{n.wage_rate || "-"}</td>
                    <td className="px-3 py-3">
                      {docs.length ? (
                        <div className="flex min-w-[190px] flex-wrap gap-1">
                          {docs.map((document) => (
                            <span key={document.field} className={`max-w-[180px] rounded-md border px-2 py-1 text-[11px] font-semibold ${document.status === "accessible" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : document.status === "not_provided" || document.status === "pending" ? "border-slate-200 bg-slate-50 text-slate-600" : "border-red-200 bg-red-50 text-red-700"}`}>
                              <span className="block">{document.shortLabel} {document.status === "accessible" ? "Accessible" : document.status === "not_provided" ? "Not Provided" : document.status === "pending" ? "Pending access" : labelizeStatus(document.status)}</span>
                              <span className="block truncate font-normal">{document.message}</span>
                            </span>
                          ))}
                        </div>
                      ) : "-"}
                    </td>
                    <td className="px-3 py-3"><span className={`rounded-full border px-2 py-1 text-xs font-semibold ${statusClass(labelizeStatus(row.validation_status))}`}>{labelizeStatus(row.validation_status)}</span></td>
                    <td className="max-w-md px-3 py-3 text-xs">
                      <span className="text-red-700">{(row.validation_errors || []).join("; ")}</span>
                      {row.validation_warnings?.length ? <span className="block text-amber-700">{row.validation_warnings.join("; ")}</span> : null}
                    </td>
                    <td className="px-3 py-3">{row.selected_action === "skip" ? "Skip Existing" : "Create New"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {importCompleted && (
          <div className="flex flex-wrap gap-2">
            {rows.some((row: any) => ["blocked", "failed"].includes(row.validation_status) || row.execution_status === "failed") && (
              <button type="button" disabled={Boolean(busy)} onClick={() => downloadReport("remaining-labour-workbook")} className="inline-flex h-10 items-center rounded-md border bg-white px-4 text-sm font-semibold disabled:opacity-50">Download Remaining Labour Workbook</button>
            )}
            <button type="button" onClick={() => { setWorkbook(null); setBatchId(""); setPreview({ rows: [], batch: null }); setMessage(null); }} className="inline-flex h-10 items-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white">Import Another Workbook</button>
            <Link href="/labour/workers/new" className="inline-flex h-10 items-center rounded-md border bg-white px-4 text-sm font-semibold">Back to Labour Registration</Link>
          </div>
        )}
      </div>
    </section>
  );
}
