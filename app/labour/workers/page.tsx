"use client";

import Link from "next/link";
import { BadgeIndianRupee, ChevronDown, Download, Eye, FileUp, Plus, Search, Trash2, UserX, X } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { useAccessContext } from "@/components/AccessContext";
import { formatLabourCode, LABOUR_STATUSES, labelFromCode, normalizeLabourCode } from "@/lib/labour/constants";
import { recordClientAuditEvent } from "@/lib/clientAudit";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function initials(name: string | null | undefined) {
  return String(name || "L")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "L";
}

export default function LabourWorkersPage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const global = hasGlobalAccess(access);
  const [workers, setWorkers] = useState<any[]>([]);
  const [lookups, setLookups] = useState<any>({ contractors: [], trades: [], sites: [] });
  const [filters, setFilters] = useState({ search: "", contractor_profile_id: "", labour_trade_id: "", site_id: "", status: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const canAdd = global || can(permissions, "labour_workers", "add");
  const canEdit = global || can(permissions, "labour_workers", "edit");
  const canDelete = global || can(permissions, "labour_workers", "delete");
  const canImport = global || can(permissions, "labour_workers", "import");
  const canExport = global || can(permissions, "labour_workers", "export");
  const canChangeRate = global || can(permissions, "labour_workers", "change_rate");
  const hasSecondaryActions = canImport || canExport || canChangeRate || canEdit;
  const [selectionMode, setSelectionMode] = useState<"rate" | "status" | null>(null);
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<Record<string, boolean>>({});
  const [rateModalOpen, setRateModalOpen] = useState(false);
  const [rateForm, setRateForm] = useState({ base_rate: "", effective_from: "", reason: "" });
  const [ratePreview, setRatePreview] = useState<any>(null);
  const [rateError, setRateError] = useState("");
  const [rateSaving, setRateSaving] = useState(false);
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [statusForm, setStatusForm] = useState({ status: "inactive", effective_date: "", reason: "" });
  const [statusPreview, setStatusPreview] = useState<any>(null);
  const [statusError, setStatusError] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);
  const duplicateCodes = workers.reduce<Record<string, number>>((acc, worker) => {
    const code = normalizeLabourCode(worker.labour_code);
    if (code) acc[code] = (acc[code] || 0) + 1;
    return acc;
  }, {});

  async function token() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  }

  async function loadLookups() {
    const accessToken = await token();
    const response = await fetch("/api/labour/lookups", { headers: { Authorization: `Bearer ${accessToken}` } });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) setLookups(payload);
  }

  async function loadWorkers(nextFilters = filters) {
    setLoading(true);
    setError("");
    setSuccess("");
    const params = new URLSearchParams({ limit: "100" });
    if (nextFilters.search.trim()) params.set("search", nextFilters.search.trim());
    if (nextFilters.contractor_profile_id) params.set("contractor_profile_id", nextFilters.contractor_profile_id);
    if (nextFilters.labour_trade_id) params.set("labour_trade_id", nextFilters.labour_trade_id);
    if (nextFilters.site_id) params.set("site_id", nextFilters.site_id);
    if (nextFilters.status) params.set("status", nextFilters.status);
    try {
      const response = await fetch(`/api/labour/workers?${params}`, { headers: { Authorization: `Bearer ${await token()}` } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error || "Failed to load labourers.");
        return;
      }
      setWorkers(payload.workers || []);
    } catch (fetchError: any) {
      setError(fetchError.message || "Failed to load labourers.");
    } finally {
      setLoading(false);
    }
  }

  function applyFilter(patch: Partial<typeof filters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    loadWorkers(next);
  }

  function isDailyWageWorker(worker: any) {
    return worker.status === "active" && worker.current_payment_model === "daily_wage";
  }

  function isSelectableWorker(worker: any) {
    if (selectionMode === "rate") return isDailyWageWorker(worker);
    if (selectionMode === "status") return worker.status === "active";
    return false;
  }

  function selectedIds() {
    return Object.keys(selectedWorkerIds).filter((id) => selectedWorkerIds[id]);
  }

  function selectedWorkers() {
    const ids = new Set(selectedIds());
    return workers.filter((worker) => ids.has(worker.id));
  }

  function enterRateSelection() {
    setError("");
    setSuccess("");
    setRateError("");
    setRatePreview(null);
    setStatusError("");
    setStatusPreview(null);
    setSelectedWorkerIds({});
    setSelectionMode("rate");
  }

  function enterStatusSelection() {
    setError("");
    setSuccess("");
    setRateError("");
    setRatePreview(null);
    setStatusError("");
    setStatusPreview(null);
    setSelectedWorkerIds({});
    setSelectionMode("status");
  }

  function cancelSelection() {
    setSelectionMode(null);
    setSelectedWorkerIds({});
    setRateModalOpen(false);
    setStatusModalOpen(false);
    setRatePreview(null);
    setRateError("");
    setStatusPreview(null);
    setStatusError("");
  }

  function toggleWorkerSelection(worker: any) {
    if (!isSelectableWorker(worker)) return;
    setSelectedWorkerIds((current) => ({ ...current, [worker.id]: !current[worker.id] }));
  }

  function selectAllVisible() {
    const eligible = workers.filter(isSelectableWorker);
    setSelectedWorkerIds((current) => {
      const allSelected = eligible.length > 0 && eligible.every((worker) => current[worker.id]);
      const next = { ...current };
      for (const worker of eligible) next[worker.id] = !allSelected;
      return next;
    });
  }

  function updateRateForm(patch: Partial<typeof rateForm>) {
    setRateForm((current) => ({ ...current, ...patch }));
    setRatePreview(null);
    setRateError("");
  }

  function updateStatusForm(patch: Partial<typeof statusForm>) {
    setStatusForm((current) => ({ ...current, ...patch }));
    setStatusPreview(null);
    setStatusError("");
  }

  function continueBulkSelection() {
    if (!selectedIds().length) return;
    if (selectionMode === "rate") setRateModalOpen(true);
    if (selectionMode === "status") setStatusModalOpen(true);
  }

  async function exportLabourRegister() {
    recordClientAuditEvent({ eventType: "export", entityType: "labour_worker", source: "labour_workers_register", context: { filters } });
    setError("");
    try {
      const response = await fetch("/api/labour/export", { headers: { Authorization: `Bearer ${await token()}` } });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error || "Could not export Labour Register.");
        return;
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const filename = disposition.match(/filename="?([^"]+)"?/i)?.[1] || `labour-register-${new Date().toISOString().slice(0, 10)}.xlsx`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (exportError: any) {
      setError(exportError.message || "Could not export Labour Register.");
    }
  }

  async function previewBulkRate() {
    setRateSaving(true);
    setRateError("");
    setRatePreview(null);
    try {
      const response = await fetch("/api/labour/workers/bulk-wage-rates", {
        method: "POST",
        headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "preview", labour_worker_ids: selectedIds(), ...rateForm }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setRatePreview(payload);
        setRateError(payload.error || payload.errors?.[0]?.error || "Could not preview Daily Rate update.");
        return;
      }
      setRatePreview(payload);
    } catch (previewError: any) {
      setRateError(previewError.message || "Could not preview Daily Rate update.");
    } finally {
      setRateSaving(false);
    }
  }

  async function saveBulkRate() {
    setRateSaving(true);
    setRateError("");
    try {
      const response = await fetch("/api/labour/workers/bulk-wage-rates", {
        method: "POST",
        headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "commit", labour_worker_ids: selectedIds(), ...rateForm }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setRatePreview(payload);
        setRateError(payload.error || payload.errors?.[0]?.error || "Could not update Daily Rates.");
        return;
      }
      setSuccess(`${payload.updated || 0} Daily Rates updated.`);
      cancelSelection();
      loadWorkers();
    } catch (saveError: any) {
      setRateError(saveError.message || "Could not update Daily Rates.");
    } finally {
      setRateSaving(false);
    }
  }

  async function previewBulkStatus() {
    setStatusSaving(true);
    setStatusError("");
    setStatusPreview(null);
    try {
      const response = await fetch("/api/labour/workers/bulk-status", {
        method: "POST",
        headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "preview", labour_worker_ids: selectedIds(), ...statusForm }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatusPreview(payload);
        setStatusError(payload.error || payload.errors?.[0]?.error || "Could not preview status update.");
        return;
      }
      setStatusPreview(payload);
    } catch (previewError: any) {
      setStatusError(previewError.message || "Could not preview status update.");
    } finally {
      setStatusSaving(false);
    }
  }

  async function saveBulkStatus() {
    setStatusSaving(true);
    setStatusError("");
    try {
      const response = await fetch("/api/labour/workers/bulk-status", {
        method: "POST",
        headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "commit", labour_worker_ids: selectedIds(), ...statusForm }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatusPreview(payload);
        setStatusError(payload.error || payload.errors?.[0]?.error || "Could not update labourer statuses.");
        return;
      }
      setSuccess(`${payload.updated || 0} labourers marked Inactive.`);
      cancelSelection();
      loadWorkers();
    } catch (saveError: any) {
      setStatusError(saveError.message || "Could not update labourer statuses.");
    } finally {
      setStatusSaving(false);
    }
  }

  async function deleteWorker(worker: any) {
    if (!window.confirm(`Delete labourer ${worker.worker_name}?`)) return;
    setError("");
    try {
      const response = await fetch(`/api/labour/workers/${worker.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${await token()}` } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error || "Could not delete labourer.");
        return;
      }
      setWorkers((current) => current.filter((row) => row.id !== worker.id));
      setSuccess("Labourer deleted successfully.");
    } catch (deleteError: any) {
      setError(deleteError.message || "Could not delete labourer.");
    }
  }

  async function changeWorkerStatus(worker: any, status: string) {
    if (!status || status === worker.status) return;
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`/api/labour/workers/${worker.id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status_only: true, status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error || "Could not update labourer status.");
        return;
      }
      setWorkers((current) => current.map((row) => row.id === worker.id ? { ...row, status } : row));
      setSuccess("Labourer status updated.");
    } catch (statusError: any) {
      setError(statusError.message || "Could not update labourer status.");
    }
  }

  useEffect(() => {
    loadLookups();
    loadWorkers();
  }, []);

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-slate-950 md:px-10">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Labour Registration</p>
            <h1 className="text-3xl font-semibold">Labour Registration</h1>
            <p className="mt-1 text-sm text-slate-600">Register new labour or transfer an existing labourer to the current site.</p>
          </div>
          <div className="flex gap-2">
            {canAdd && <Link href="/labour/workers/new" className="inline-flex h-11 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> Register Labour</Link>}
            {hasSecondaryActions && (
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex h-11 items-center gap-2 rounded-lg border bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm">
                  Actions <ChevronDown className="h-4 w-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {canImport && (
                    <DropdownMenuItem asChild>
                      <Link href="/labour/workers/import" className="flex w-full items-center gap-2">
                        <FileUp className="h-4 w-4" /> Import Labour
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {canChangeRate && (
                    <>
                      {canImport && <DropdownMenuSeparator />}
                      <DropdownMenuItem onClick={enterRateSelection} className="flex items-center gap-2">
                        <BadgeIndianRupee className="h-4 w-4" /> Bulk Update Daily Rates
                      </DropdownMenuItem>
                    </>
                  )}
                  {canEdit && (
                    <DropdownMenuItem onClick={enterStatusSelection} className="flex items-center gap-2">
                      <UserX className="h-4 w-4" /> Bulk Update Status
                    </DropdownMenuItem>
                  )}
                  {canExport && (
                    <>
                      {(canImport || canChangeRate || canEdit) && <DropdownMenuSeparator />}
                      <DropdownMenuItem onClick={exportLabourRegister} className="flex items-center gap-2">
                        <Download className="h-4 w-4" /> Export Labour Register
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </header>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
        {success && <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-700">{success}</div>}
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="mb-4 grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_1fr_0.8fr]">
            <label className="flex h-11 items-center gap-2 rounded-lg border px-3 text-sm">
              <Search className="h-4 w-4 text-slate-400" />
              <input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} onKeyDown={(event) => event.key === "Enter" && loadWorkers()} placeholder="Search code, name, father/husband, mobile or Aadhaar" className="flex-1 outline-none" />
            </label>
            <select value={filters.contractor_profile_id} onChange={(event) => applyFilter({ contractor_profile_id: event.target.value })} className="h-11 rounded-lg border px-3 text-sm">
              <option value="">All Contractors</option>
              {lookups.contractors.map((contractor: any) => <option key={contractor.id} value={contractor.id}>{contractor.vendors?.vendor_name || contractor.contractor_code}</option>)}
            </select>
            <select value={filters.labour_trade_id} onChange={(event) => applyFilter({ labour_trade_id: event.target.value })} className="h-11 rounded-lg border px-3 text-sm">
              <option value="">All Categories</option>
              {lookups.trades.map((trade: any) => <option key={trade.id} value={trade.id}>{trade.trade_name}</option>)}
            </select>
            <select value={filters.site_id} onChange={(event) => applyFilter({ site_id: event.target.value })} className="h-11 rounded-lg border px-3 text-sm">
              <option value="">All Sites</option>
              {lookups.sites.map((site: any) => <option key={site.id} value={site.id}>{site.site_name}</option>)}
            </select>
            <select value={filters.status} onChange={(event) => applyFilter({ status: event.target.value })} className="h-11 rounded-lg border px-3 text-sm">
              <option value="">All Status</option>
              {LABOUR_STATUSES.filter((status) => status !== "deleted").map((status) => <option key={status} value={status}>{labelFromCode(status)}</option>)}
            </select>
          </div>
          {selectionMode && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-200 bg-sky-50 p-3">
              <div>
                <p className="text-sm font-bold text-slate-900">{selectionMode === "rate" ? "Bulk Update Daily Rates" : "Bulk Update Status"}</p>
                <p className="text-xs font-semibold text-slate-600">{selectionMode === "rate" ? "Select active Daily Wage labourers whose rates you want to update." : "Select active labourers whose status you want to update."}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-700">Selected: {selectedIds().length}</span>
                <button type="button" onClick={selectAllVisible} className="h-9 rounded-lg border bg-white px-3 text-xs font-bold text-slate-700">Select All Visible</button>
                <button type="button" disabled={!selectedIds().length} onClick={continueBulkSelection} className="h-9 rounded-lg bg-slate-950 px-3 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300">Continue</button>
                <button type="button" onClick={cancelSelection} className="inline-flex h-9 items-center gap-1 rounded-lg border bg-white px-3 text-xs font-bold text-slate-700"><X className="h-3.5 w-3.5" /> Cancel</button>
              </div>
            </div>
          )}
          <p className="mb-3 text-sm text-slate-500">
            Showing {workers.length} Labourers
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="w-16 px-3 py-3">S. No.</th>
                  {selectionMode && <th className="px-3 py-3">Select</th>}
                  {["Labour Code", "Labour Name", "Father/Husband", "Contractor", "Category", "Current Company", "Current Site", "Mobile", "Status", "Actions"].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y">
                {workers.map((worker, index) => (
                  <tr key={worker.id}>
                    <td className="w-16 px-3 py-3 text-slate-500">{index + 1}</td>
                    {selectionMode && (
                      <td className="px-3 py-3">
                        <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600">
                          <input
                            type="checkbox"
                            checked={Boolean(selectedWorkerIds[worker.id])}
                            disabled={!isSelectableWorker(worker)}
                            onChange={() => toggleWorkerSelection(worker)}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          {!isSelectableWorker(worker) && <span>Not Applicable</span>}
                        </label>
                      </td>
                    )}
                    <td className="px-3 py-3 font-semibold">
                      <div className="flex flex-col gap-1">
                        <span>{formatLabourCode(worker.labour_code)}</span>
                        {duplicateCodes[normalizeLabourCode(worker.labour_code) || ""] > 1 && <span className="w-fit rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">Duplicate code</span>}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-slate-100 text-xs font-bold text-slate-600">
                          {worker.photo_url ? <img src={worker.photo_url} alt={worker.worker_name} className="h-full w-full object-cover" /> : initials(worker.worker_name)}
                        </div>
                        <span>{worker.worker_name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">{worker.father_or_husband_name || "-"}</td>
                    <td className="px-3 py-3">{worker.contractor_name || worker.labour_contractor_profiles?.vendors?.vendor_name || "-"}</td>
                    <td className="px-3 py-3">{worker.labour_category_name || worker.labour_trades?.trade_name || worker.trade || "-"}</td>
                    <td className="px-3 py-3">{worker.current_company_name || "Not Deployed"}</td>
                    <td className="px-3 py-3">{worker.current_site_name || "Not Deployed"}</td>
                    <td className="px-3 py-3">{worker.mobile_number || "-"}</td>
                    <td className="px-3 py-3">
                      {canEdit ? (
                        <select value={worker.status} onChange={(event) => changeWorkerStatus(worker, event.target.value)} className="h-9 rounded-lg border bg-white px-2 text-xs font-semibold">
                          {LABOUR_STATUSES.filter((status) => status === "active" || status === "inactive").map((status) => <option key={status} value={status}>{labelFromCode(status)}</option>)}
                        </select>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">{labelFromCode(worker.status)}</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Link href={`/labour/workers/${worker.id}`} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5" onClick={() => recordClientAuditEvent({ eventType: "view_record", entityType: "labour_worker", recordId: worker.id, source: "labour_workers_register" })}><Eye className="h-4 w-4" /> View</Link>
                        {canDelete && <button type="button" onClick={() => deleteWorker(worker)} className="inline-flex items-center gap-1 rounded-md border border-red-200 px-3 py-1.5 text-red-600"><Trash2 className="h-4 w-4" /> Delete</button>}
                      </div>
                    </td>
                  </tr>
                ))}
                {!workers.length && !error && <tr><td colSpan={selectionMode ? 12 : 11} className="px-3 py-8 text-center text-slate-500">{loading ? "Loading..." : "No registered labour found."}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        {rateModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
            <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-sky-600">Bulk Update Daily Rates</p>
                  <h2 className="text-xl font-semibold">Update Daily Rate</h2>
                  <p className="mt-1 text-sm text-slate-600">Selected Labourers: {selectedIds().length}</p>
                </div>
                <button type="button" onClick={() => setRateModalOpen(false)} className="rounded-full border p-2 text-slate-500"><X className="h-4 w-4" /></button>
              </div>
              <div className="mt-4 rounded-lg border bg-slate-50 p-3 text-sm">
                <p className="font-bold text-slate-800">Current Rate Summary</p>
                <p className="mt-1 text-slate-600">
                  {selectedWorkers().length
                    ? Array.from(new Set(selectedWorkers().map((worker) => worker.current_deployment?.wage_rate || "Not Set"))).join(", ")
                    : "No labourers selected."}
                </p>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="text-sm font-semibold text-slate-700">
                  Change Method
                  <input value="Set one rate for all" readOnly className="mt-1 h-11 w-full rounded-lg border bg-slate-50 px-3 text-sm text-slate-700" />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  New Rate
                  <input value={rateForm.base_rate} onChange={(event) => updateRateForm({ base_rate: event.target.value })} inputMode="numeric" className="mt-1 h-11 w-full rounded-lg border px-3 text-sm" placeholder="Whole rupee amount" />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Effective From
                  <input type="date" value={rateForm.effective_from} onChange={(event) => updateRateForm({ effective_from: event.target.value })} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm" />
                </label>
                <label className="text-sm font-semibold text-slate-700 md:col-span-2">
                  Reason
                  <textarea value={rateForm.reason} onChange={(event) => updateRateForm({ reason: event.target.value })} className="mt-1 min-h-24 w-full rounded-lg border px-3 py-2 text-sm" placeholder="Reason for changing the Daily Rate" />
                </label>
              </div>
              {rateError && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{rateError}</div>}
              {ratePreview && (
                <div className="mt-4 rounded-lg border">
                  <div className="flex flex-wrap gap-2 border-b bg-slate-50 p-3 text-xs font-bold text-slate-700">
                    <span>Selected: {ratePreview.selected ?? selectedIds().length}</span>
                    <span>Will Update: {ratePreview.will_update ?? ratePreview.updated ?? 0}</span>
                    <span>Unchanged: {ratePreview.unchanged ?? 0}</span>
                    <span>Errors: {ratePreview.errors?.length || 0}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-white text-left text-xs uppercase text-slate-500">
                        <tr>
                          {["Labour", "Current Rate", "New Rate", "Effective From"].map((heading) => <th key={heading} className="px-3 py-2">{heading}</th>)}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {(ratePreview.rows || []).map((row: any) => (
                          <tr key={row.labour_worker_id}>
                            <td className="px-3 py-2 font-semibold">{formatLabourCode(row.labour_code)} — {row.worker_name}</td>
                            <td className="px-3 py-2">{row.current_rate ?? "Not Set"}</td>
                            <td className="px-3 py-2">{row.new_rate}</td>
                            <td className="px-3 py-2">{row.effective_from}</td>
                          </tr>
                        ))}
                        {(ratePreview.errors || []).map((row: any) => (
                          <tr key={row.labour_worker_id}>
                            <td className="px-3 py-2 font-semibold text-red-700" colSpan={4}>{row.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => setRateModalOpen(false)} className="h-10 rounded-lg border px-4 text-sm font-semibold">Cancel</button>
                <button type="button" onClick={previewBulkRate} disabled={rateSaving} className="h-10 rounded-lg border bg-white px-4 text-sm font-semibold disabled:opacity-60">Preview</button>
                <button type="button" onClick={saveBulkRate} disabled={rateSaving || !ratePreview?.ok} className="h-10 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300">Confirm Update</button>
              </div>
            </div>
          </div>
        )}
        {statusModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
            <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-sky-600">Bulk Update Status</p>
                  <h2 className="text-xl font-semibold">Bulk Update Status</h2>
                  <p className="mt-1 text-sm text-slate-600">Selected Labourers: {selectedIds().length}</p>
                </div>
                <button type="button" onClick={() => setStatusModalOpen(false)} className="rounded-full border p-2 text-slate-500"><X className="h-4 w-4" /></button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="text-sm font-semibold text-slate-700">
                  New Status *
                  <select value={statusForm.status} onChange={(event) => updateStatusForm({ status: event.target.value })} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm">
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Effective Date *
                  <input type="date" value={statusForm.effective_date} onChange={(event) => updateStatusForm({ effective_date: event.target.value })} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm" />
                </label>
                <label className="text-sm font-semibold text-slate-700 md:col-span-2">
                  Reason *
                  <textarea value={statusForm.reason} onChange={(event) => updateStatusForm({ reason: event.target.value })} className="mt-1 min-h-24 w-full rounded-lg border px-3 py-2 text-sm" placeholder="Reason for marking selected labourers inactive" />
                </label>
              </div>
              {statusError && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{statusError}</div>}
              {statusPreview && (
                <div className="mt-4 rounded-lg border">
                  <div className="flex flex-wrap gap-2 border-b bg-slate-50 p-3 text-xs font-bold text-slate-700">
                    <span>Selected: {statusPreview.selected ?? selectedIds().length}</span>
                    <span>Will Update: {statusPreview.will_update ?? statusPreview.updated ?? 0}</span>
                    <span>Unchanged: {statusPreview.unchanged ?? 0}</span>
                    <span>Errors: {statusPreview.errors?.length || 0}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-white text-left text-xs uppercase text-slate-500">
                        <tr>
                          {["Labour", "Current Status", "New Status"].map((heading) => <th key={heading} className="px-3 py-2">{heading}</th>)}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {(statusPreview.rows || []).map((row: any) => (
                          <tr key={row.labour_worker_id}>
                            <td className="px-3 py-2 font-semibold">{formatLabourCode(row.labour_code)} — {row.worker_name}</td>
                            <td className="px-3 py-2">{labelFromCode(row.current_status)}</td>
                            <td className="px-3 py-2">{labelFromCode(row.new_status)}</td>
                          </tr>
                        ))}
                        {(statusPreview.errors || []).map((row: any) => (
                          <tr key={row.labour_worker_id}>
                            <td className="px-3 py-2 font-semibold text-red-700" colSpan={3}>{row.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => setStatusModalOpen(false)} className="h-10 rounded-lg border px-4 text-sm font-semibold">Cancel</button>
                <button type="button" onClick={previewBulkStatus} disabled={statusSaving} className="h-10 rounded-lg border bg-white px-4 text-sm font-semibold disabled:opacity-60">Preview</button>
                <button type="button" onClick={saveBulkStatus} disabled={statusSaving || !statusPreview?.ok} className="h-10 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300">Confirm Update</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
