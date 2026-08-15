"use client";

import { CheckCircle2, History, Search, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAccessContext } from "@/components/AccessContext";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { clearSelectedLabourContext, labourContextFromLookup, writeSelectedLabourContext } from "@/lib/labour/attendanceSystemContext";
import { supabase } from "@/lib/supabase";

const ATTENDANCE_SYSTEM_OPTIONS = [
  { value: "standard", label: "Standard Labour Attendance" },
  { value: "site_in_engineer", label: "Site-In & Engineer Workflow" },
];

function formatAttendanceSystem(value: unknown) {
  const option = ATTENDANCE_SYSTEM_OPTIONS.find((item) => item.value === value);
  return option?.label || "Not Configured";
}

async function readPayload(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || "Request failed." };
  }
}

function EmployeePicker({
  title,
  placeholder,
  value,
  candidates,
  disabled,
  eligibilityKey,
  onChange,
  onMessage,
}: {
  title: string;
  placeholder: string;
  value: string;
  candidates: any[];
  disabled?: boolean;
  eligibilityKey: "site_hr_eligible" | "pm_eligible" | "ho_hr_eligible";
  onChange: (userId: string) => void;
  onMessage: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [enabledOnly, setEnabledOnly] = useState(false);
  const selected = candidates.find((candidate) => candidate.linked_user_id === value);
  const departments = useMemo(() => Array.from(new Set(candidates.map((candidate) => candidate.department).filter(Boolean))).sort(), [candidates]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return candidates
      .filter((candidate) => !enabledOnly || candidate.erp_enabled)
      .filter((candidate) => !department || candidate.department === department)
      .filter((candidate) => !query ||
        String(candidate.employee_name || "").toLowerCase().includes(query) ||
        String(candidate.employee_code || "").toLowerCase().includes(query) ||
        String(candidate.profile_name || "").toLowerCase().includes(query) ||
        String(candidate.email || "").toLowerCase().includes(query))
      .sort((a, b) => Number(Boolean(b[eligibilityKey])) - Number(Boolean(a[eligibilityKey])) || String(a.employee_name || "").localeCompare(String(b.employee_name || "")));
  }, [candidates, department, eligibilityKey, enabledOnly, search]);

  function choose(candidate: any) {
    if (!candidate[eligibilityKey]) {
      onMessage(candidate.ineligibility_reason || "Create or link an ERP login for this employee before assignment.");
      return;
    }
    onChange(candidate.linked_user_id);
    setOpen(false);
  }

  return (
    <div className="relative">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p>
      <button type="button" disabled={disabled} onClick={() => setOpen(true)} className="mt-1 flex min-h-10 w-full items-center justify-between gap-2 rounded-md border bg-white px-3 py-2 text-left text-sm disabled:bg-slate-100 disabled:opacity-70">
        <span className="min-w-0">
          <span className="block truncate font-semibold">{selected?.employee_name || placeholder}</span>
          {selected && <span className="block truncate text-xs text-slate-500">{selected.employee_code || "-"} · {selected.department || "-"} · {selected.erp_status}</span>}
        </span>
        <Search className="h-4 w-4 shrink-0 text-slate-500" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-slate-950/25 p-4" onClick={() => setOpen(false)}>
          <div className="mx-auto mt-20 max-w-2xl rounded-lg bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="font-semibold">{title}</h3>
              <button type="button" aria-label="Close picker" onClick={() => setOpen(false)} className="rounded-full p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-3 border-b p-4 md:grid-cols-[1fr_180px_auto]">
              <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Search
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or code" className="mt-1 h-10 w-full rounded-md border px-2 text-sm font-normal normal-case tracking-normal" />
              </label>
              <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Department
                <select value={department} onChange={(event) => setDepartment(event.target.value)} className="mt-1 h-10 w-full rounded-md border px-2 text-sm font-normal normal-case tracking-normal">
                  <option value="">All</option>
                  {departments.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label className="mt-6 flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={enabledOnly} onChange={(event) => setEnabledOnly(event.target.checked)} />
                ERP Enabled only
              </label>
            </div>
            <div className="max-h-[420px] overflow-auto p-2">
              {!filtered.length && <p className="p-5 text-center text-sm text-slate-500">No ERP users or employees match this search.</p>}
              {filtered.map((candidate) => {
                const eligible = Boolean(candidate[eligibilityKey]);
                return (
                  <button key={candidate.candidate_id || candidate.employee_id} type="button" aria-disabled={!eligible} onClick={() => choose(candidate)} className={`mb-2 w-full rounded-md border p-3 text-left text-sm hover:bg-slate-50 ${eligible ? "" : "cursor-not-allowed bg-slate-50 opacity-75"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold uppercase">{candidate.employee_name}</p>
                        <p className="text-xs text-slate-600">{candidate.employee_code || "-"} · {candidate.department || "-"} · {candidate.designation || "-"}</p>
                        <p className="text-xs text-slate-500">{candidate.site_label || "Head Office"}</p>
                        {!eligible && <p className="mt-1 text-xs text-red-700">{candidate.ineligibility_reason || "Not eligible for this responsibility."}</p>}
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${candidate.erp_enabled ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                        {candidate.erp_status}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SiteHrMultiPicker({
  value,
  candidates,
  disabled,
  onChange,
}: {
  value: string[];
  candidates: any[];
  disabled?: boolean;
  onChange: (userIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = new Set(value);
  const eligibleCandidates = candidates.filter((candidate) => candidate.site_hr_eligible);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return eligibleCandidates.filter((candidate) => !query ||
      String(candidate.employee_name || "").toLowerCase().includes(query) ||
      String(candidate.employee_code || "").toLowerCase().includes(query) ||
      String(candidate.email || "").toLowerCase().includes(query));
  }, [eligibleCandidates, search]);
  const selectedCandidates = value.map((id) => candidates.find((candidate) => candidate.linked_user_id === id)).filter(Boolean);
  const summary = selectedCandidates.length
    ? `${selectedCandidates.slice(0, 2).map((candidate: any) => candidate.employee_name || candidate.profile_name || candidate.email).join(", ")}${selectedCandidates.length > 2 ? ` +${selectedCandidates.length - 2} more` : ""}`
    : "Select Site HR users";

  function toggle(userId: string) {
    const next = new Set(selected);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    onChange(Array.from(next));
  }

  return (
    <div className="relative">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Site HR</p>
      <button type="button" disabled={disabled} onClick={() => setOpen((current) => !current)} className="mt-1 flex min-h-10 w-full items-center justify-between gap-2 rounded-md border bg-white px-3 py-2 text-left text-sm disabled:bg-slate-100 disabled:opacity-70">
        <span className={`min-w-0 truncate ${selectedCandidates.length ? "font-semibold text-slate-900" : "text-slate-500"}`}>{summary}</span>
        <span className="shrink-0 text-slate-500">▾</span>
      </button>
      {open && (
        <>
          <button type="button" aria-label="Close Site HR selector" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-md border bg-white shadow-lg">
            <div className="border-b p-2">
              <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, code or email" className="h-9 w-full rounded-md border px-2 text-sm" />
            </div>
            <div className="max-h-60 overflow-auto p-1">
              {!filtered.length && <p className="p-3 text-sm text-slate-500">No active eligible users found.</p>}
              {filtered.map((candidate) => {
                const userId = candidate.linked_user_id;
                return (
                  <label key={userId} className="flex cursor-pointer items-start gap-2 rounded px-2 py-2 text-sm hover:bg-slate-50">
                    <input type="checkbox" checked={selected.has(userId)} onChange={() => toggle(userId)} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{candidate.employee_name || candidate.profile_name}</span>
                      <span className="block truncate text-xs text-slate-500">{candidate.employee_code || candidate.email || ""}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="flex justify-end border-t p-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-md border px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Done</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function LabourMusterConfigurationPage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const global = hasGlobalAccess(access);
  const canEditResponsibility = global || can(permissions, "labour_muster_configuration", "edit_site_responsibility");
  const canEditPolicy = global || can(permissions, "labour_muster_configuration", "edit_attendance_policy");
  const canAssignOverride = global || can(permissions, "labour_muster_configuration", "assign_override_authority");
  const canEdit = canEditResponsibility || canEditPolicy || canAssignOverride;

  const [companies, setCompanies] = useState<any[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [employeeCandidates, setEmployeeCandidates] = useState<any[]>([]);
  const [overrideAuthorities, setOverrideAuthorities] = useState<any[]>([]);
  const [configurationEvents, setConfigurationEvents] = useState<any[]>([]);
  const [attendancePolicies, setAttendancePolicies] = useState<any[]>([]);
  const [attendancePolicyConflicts, setAttendancePolicyConflicts] = useState<any[]>([]);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [filters, setFilters] = useState({ company_id: "", site_id: "" });
  const [form, setForm] = useState({
    site_hr_user_ids: [] as string[],
    attendance_system: "",
    attendance_lock_hours: "5",
    approval_layer_count: "2",
    approval_layers: [
      { layer_sequence: 1, stage_name: "Project Manager Approval", approver_user_id: "" },
      { layer_sequence: 2, stage_name: "HO Approval", approver_user_id: "" },
    ] as Array<{ layer_sequence: number; stage_name: string; approver_user_id: string }>,
    override_user_ids: [] as string[],
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  const siteOptions = useMemo(() => sites || [], [sites]);
  const singleSiteMode = siteOptions.length === 1;
  const approvalApprovers = employeeCandidates.filter((candidate) => candidate.erp_enabled);
  const overrideUsers = users.filter((user) => user.override_eligible);
  const lockPreview = useMemo(() => {
    const hours = Number(form.attendance_lock_hours || 0);
    if (!Number.isFinite(hours) || hours < 0) return null;
    const today = new Date();
    const dateText = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(today);
    const cutoff = new Date(`${dateText}T23:59:00+05:30`);
    cutoff.setHours(cutoff.getHours() + Math.round(hours));
    return {
      date: new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${dateText}T00:00:00+05:30`)),
      cutoff: new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(cutoff),
    };
  }, [form.attendance_lock_hours]);

  async function token() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  }

  async function loadConfiguration(nextFilters = filters, options: { preserveMessage?: boolean } = {}) {
    setLoading(true);
    if (!options.preserveMessage) setMessage(null);
    try {
      const params = new URLSearchParams();
      if (nextFilters.company_id) params.set("company_id", nextFilters.company_id);
      if (nextFilters.site_id) params.set("site_id", nextFilters.site_id);
      const response = await fetch(`/api/labour/configuration?${params.toString()}`, {
        headers: { Authorization: `Bearer ${await token()}` },
      });
      const payload = await readPayload(response);
      if (!response.ok) return setMessage({ type: "error", text: payload.error || "Could not load Muster Configuration." });
      setCompanies(payload.companies || []);
      setSites(payload.sites || []);
      setUsers(payload.users || []);
      setEmployeeCandidates(payload.employee_candidates || []);
      setDiagnostics(payload.diagnostics || null);
      setOverrideAuthorities(payload.override_authorities || []);
      setConfigurationEvents(payload.configuration_events || []);
      setAttendancePolicies(payload.attendance_policies || []);
      setAttendancePolicyConflicts(payload.attendance_policy_conflicts || []);
      if (nextFilters.company_id && nextFilters.site_id) {
        writeSelectedLabourContext(labourContextFromLookup({
          companyId: nextFilters.company_id,
          siteId: nextFilters.site_id,
          companies: payload.companies || [],
          attendanceSystem: { value: payload.configuration?.attendance_system || "unconfigured" },
        }));
      }
      if (payload.configuration) {
        const loadedLayers = (payload.approval_layers || []).length
          ? (payload.approval_layers || []).map((layer: any, index: number) => ({
              layer_sequence: Number(layer.layer_sequence || index + 1),
              stage_name: layer.stage_name || "",
              approver_user_id: layer.approver_user_id || "",
            }))
          : [
              { layer_sequence: 1, stage_name: "Project Manager Approval", approver_user_id: "" },
              { layer_sequence: 2, stage_name: "HO Approval", approver_user_id: "" },
            ];
        setForm({
          site_hr_user_ids: payload.configuration.site_hr_user_ids || (payload.configuration.site_hr_user_id ? [payload.configuration.site_hr_user_id] : []),
          attendance_system: payload.configuration.attendance_system || "",
          attendance_lock_hours: String(payload.configuration.attendance_lock_hours || 5),
          approval_layer_count: String(payload.configuration.approval_layer_count || loadedLayers.length || 2),
          approval_layers: loadedLayers.slice(0, Number(payload.configuration.approval_layer_count || loadedLayers.length || 2)),
          override_user_ids: (payload.override_authorities || []).map((row: any) => row.user_id).filter(Boolean),
        });
      } else if (nextFilters.company_id && nextFilters.site_id) {
        setForm({
          site_hr_user_ids: [],
          attendance_system: "",
          attendance_lock_hours: "5",
          approval_layer_count: "2",
          approval_layers: [
            { layer_sequence: 1, stage_name: "Project Manager Approval", approver_user_id: "" },
            { layer_sequence: 2, stage_name: "HO Approval", approver_user_id: "" },
          ],
          override_user_ids: [],
        });
      }
    } catch (error: any) {
      setMessage({ type: "error", text: error.message || "Could not load Muster Configuration." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConfiguration();
  }, []);

  useEffect(() => {
    if (!filters.company_id && companies.length === 1) setFilters((current) => ({ ...current, company_id: companies[0].id }));
  }, [companies, filters.company_id]);

  useEffect(() => {
    if (!filters.site_id && filters.company_id && singleSiteMode) setFilters((current) => ({ ...current, site_id: siteOptions[0].id }));
  }, [filters.company_id, filters.site_id, singleSiteMode, siteOptions]);

  useEffect(() => {
    if (filters.company_id && filters.site_id) loadConfiguration(filters);
  }, [filters.company_id, filters.site_id]);

  function updateOverride(userId: string, checked: boolean) {
    setForm((current) => ({
      ...current,
      override_user_ids: checked
        ? Array.from(new Set([...current.override_user_ids, userId]))
        : current.override_user_ids.filter((id) => id !== userId),
    }));
  }

  function updateLayerCount(value: string) {
    const nextCount = Number(value);
    if (!Number.isInteger(nextCount) || nextCount < 1 || nextCount > 5) return;
    const currentCount = Number(form.approval_layer_count || form.approval_layers.length || 0);
    if (nextCount < currentCount) {
      const removed = form.approval_layers.slice(nextCount).some((layer) => layer.stage_name || layer.approver_user_id);
      if (removed && !window.confirm("Reducing approval layers will remove the unsaved configuration for higher layers. Continue?")) return;
    }
    const nextLayers = Array.from({ length: nextCount }, (_, index) => {
      const existing = form.approval_layers[index];
      return existing || { layer_sequence: index + 1, stage_name: "", approver_user_id: "" };
    }).map((layer, index) => ({ ...layer, layer_sequence: index + 1 }));
    setForm({ ...form, approval_layer_count: String(nextCount), approval_layers: nextLayers });
  }

  function updateLayer(index: number, patch: Partial<{ stage_name: string; approver_user_id: string }>) {
    setForm((current) => ({
      ...current,
      approval_layers: current.approval_layers.map((layer, layerIndex) => layerIndex === index ? { ...layer, ...patch } : layer),
    }));
  }

  async function saveConfiguration() {
    if (saving) return;
    if (!filters.company_id || !filters.site_id) return setMessage({ type: "error", text: "Company and Site are required." });
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/labour/configuration", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ ...form, company_id: filters.company_id, site_id: filters.site_id }),
      });
      const payload = await readPayload(response);
      if (!response.ok) {
        setMessage({ type: "error", text: payload.error || "Could not save Muster Configuration." });
        return;
      }
      await loadConfiguration(filters, { preserveMessage: true });
      writeSelectedLabourContext(labourContextFromLookup({
        companyId: filters.company_id,
        siteId: filters.site_id,
        companies,
        attendanceSystem: { value: form.attendance_system || "unconfigured" },
      }));
      setMessage({ type: "success", text: "Muster Configuration saved." });
    } catch (error: any) {
      setMessage({ type: "error", text: error.message || "Could not save Muster Configuration." });
    } finally {
      setSaving(false);
    }
  }

  const field = "mt-1 h-10 w-full rounded-md border px-2 text-sm font-normal normal-case tracking-normal disabled:bg-slate-100";
  const label = "text-xs font-bold uppercase tracking-wide text-slate-500";

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-slate-950 md:px-10">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Labour Management</p>
          <h1 className="text-3xl font-semibold">Muster Configuration</h1>
          <p className="mt-1 text-sm text-slate-600">Configure site-wise attendance system, approval layers, lock hours and correction authority.</p>
        </header>

        {message && (
          <div className={`flex items-center gap-2 rounded-lg border bg-white p-3 text-sm ${message.type === "success" ? "border-green-200 text-green-800" : message.type === "error" ? "border-red-200 text-red-800" : "text-slate-700"}`}>
            {message.type === "success" && <CheckCircle2 className="h-4 w-4" />}
            <span>{message.text}</span>
          </div>
        )}

        <div className="grid gap-3 rounded-lg border bg-white p-4 shadow-sm md:grid-cols-3">
          <label className={label}>
            Company
            <select className={field} value={filters.company_id} disabled={loading || saving} onChange={(event) => {
              clearSelectedLabourContext();
              setFilters({ ...filters, company_id: event.target.value });
            }}>
              <option value="">Select Company</option>
              {companies.map((company) => <option key={company.id} value={company.id}>{company.company_name}</option>)}
            </select>
          </label>
          <label className={label}>
            Site
            <select className={field} value={filters.site_id} disabled={loading || saving || !filters.company_id || singleSiteMode} onChange={(event) => {
              clearSelectedLabourContext();
              setFilters({ ...filters, site_id: event.target.value });
            }}>
              <option value="">Select Site</option>
              {siteOptions.map((site) => <option key={site.id} value={site.id}>{site.site_name}</option>)}
            </select>
          </label>
          <div className="flex items-end">
            <button type="button" onClick={() => loadConfiguration(filters)} disabled={loading || saving} className="h-10 w-full rounded-md bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60">
              {loading ? "Loading..." : "Load Configuration"}
            </button>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-3">
          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">Site Responsibility</h2>
            <div className="mt-4 space-y-3">
              <SiteHrMultiPicker value={form.site_hr_user_ids} candidates={employeeCandidates} disabled={saving || !canEditResponsibility} onChange={(site_hr_user_ids) => setForm({ ...form, site_hr_user_ids })} />
              <p className="text-xs text-slate-500">Site HR remains site-specific and must already have the Site-In and Attendance access needed to operate the site.</p>
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm xl:col-span-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Approval Workflow</h2>
                <p className="mt-1 text-sm text-slate-600">Configure one approver per layer. Layers run strictly in ascending sequence for new submissions created after this configuration is saved.</p>
              </div>
              <label className={`${label} w-52`}>
                Number of Approval Layers
                <select className={field} value={form.approval_layer_count} disabled={saving || !canEditResponsibility} onChange={(event) => updateLayerCount(event.target.value)}>
                  {[1, 2, 3, 4, 5].map((count) => <option key={count} value={count}>{count}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {form.approval_layers.map((layer, index) => {
                const selected = approvalApprovers.find((candidate) => candidate.linked_user_id === layer.approver_user_id);
                return (
                  <div key={layer.layer_sequence} className="rounded-lg border bg-slate-50 p-3">
                    <p className="text-sm font-semibold">Layer {layer.layer_sequence}</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className={label}>
                        Stage Name
                        <input className={field} value={layer.stage_name} disabled={saving || !canEditResponsibility} onChange={(event) => updateLayer(index, { stage_name: event.target.value })} placeholder="Example: Project Manager Approval" />
                      </label>
                      <label className={label}>
                        Approver
                        <select className={field} value={layer.approver_user_id} disabled={saving || !canEditResponsibility} onChange={(event) => updateLayer(index, { approver_user_id: event.target.value })}>
                          <option value="">Select Approver</option>
                          {approvalApprovers.map((candidate) => (
                            <option key={candidate.linked_user_id} value={candidate.linked_user_id}>
                              {candidate.employee_name} — {candidate.department || "No Department"}
                            </option>
                          ))}
                        </select>
                        {selected && <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-slate-500">{selected.email || selected.erp_status}</span>}
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">Attendance Policy</h2>
            <div className="mt-4 space-y-3">
              <label className={label}>
                Attendance System
                <select className={field} value={form.attendance_system} disabled={saving || !canEditPolicy} onChange={(event) => setForm({ ...form, attendance_system: event.target.value })}>
                  <option value="">Select Attendance System</option>
                  {ATTENDANCE_SYSTEM_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className={label}>
                Attendance Lock After Hours
                <input className={field} type="number" min="0" step="1" value={form.attendance_lock_hours} disabled={saving || !canEditPolicy} onChange={(event) => setForm({ ...form, attendance_lock_hours: event.target.value })} />
              </label>
              <p className="text-xs text-slate-500">Enter a non-negative whole number of hours.</p>
              <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                Attendance locks <span className="font-semibold">{form.attendance_lock_hours || "X"}</span> whole hours after the attendance date ends at 11:59 PM.
              </p>
              {lockPreview && (
                <p className="rounded-md bg-sky-50 p-3 text-sm text-sky-900">
                  Example for today: Attendance for <span className="font-semibold">{lockPreview.date}</span> will lock on <span className="font-semibold">{lockPreview.cutoff}</span>.
                </p>
              )}
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">Unlock & Correction Authority</h2>
            <div className="mt-4 max-h-64 space-y-2 overflow-auto">
              {!overrideUsers.length && <p className="text-sm text-slate-500">No eligible override users found for this Site.</p>}
              {overrideUsers.map((user) => (
                <label key={user.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <input type="checkbox" checked={form.override_user_ids.includes(user.id)} disabled={saving || !canAssignOverride} onChange={(event) => updateOverride(user.id, event.target.checked)} />
                  <span>{user.label}</span>
                </label>
              ))}
            </div>
            {!!overrideAuthorities.length && <p className="mt-2 text-xs text-slate-500">{overrideAuthorities.length} active override assignment{overrideAuthorities.length === 1 ? "" : "s"} loaded.</p>}
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-slate-500" />
              <h2 className="text-lg font-semibold">Configuration Audit History</h2>
            </div>
            <div className="mt-4 max-h-64 space-y-2 overflow-auto">
              {!configurationEvents.length && <p className="text-sm text-slate-500">No configuration history found for this Site.</p>}
              {configurationEvents.map((event) => (
                <div key={event.id} className="rounded-md border bg-slate-50 p-3 text-sm">
                  <p className="font-semibold">{String(event.event_type || "configuration_event").replace(/_/g, " ")}</p>
                  <p className="text-xs text-slate-600">{event.created_by_name || event.created_by_email || "System"} · {event.created_at ? new Date(event.created_at).toLocaleString("en-IN") : "-"}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="flex justify-end">
          <button type="button" onClick={saveConfiguration} disabled={saving || loading || !canEdit || !filters.company_id || !filters.site_id} className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-950 px-5 text-sm font-semibold text-white disabled:opacity-60">
            <Save className="h-4 w-4" /> {saving ? "Saving..." : "Save Configuration"}
          </button>
        </div>
        {diagnostics && (
          <div className="rounded-lg border bg-white p-3 text-xs text-slate-600">
            Candidate diagnostics: {diagnostics.total_candidates} candidates · {diagnostics.total_active_profiles} active ERP profiles · {diagnostics.active_profiles_without_employee_record} profiles without employee record · {diagnostics.profiles_linked_to_deleted_employee_records} profiles linked to deleted employee records · {diagnostics.total_visible_employee_only_records} employee-only records · {diagnostics.safe_unique_email_matches_where_link_missing} safe email matches · {diagnostics.eligible_pm_candidates} PM eligible · {diagnostics.eligible_ho_hr_candidates} HO HR eligible
          </div>
        )}

        <section className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <div className="border-b px-4 py-3">
            <h2 className="text-lg font-semibold">Configured Policies</h2>
            <p className="mt-1 text-sm text-slate-600">Current effective Labour Attendance configuration by Company and Site.</p>
            {!!attendancePolicyConflicts.length && (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                {attendancePolicyConflicts.length} policy scope conflict{attendancePolicyConflicts.length === 1 ? "" : "s"} found. Review active policy data before relying on this summary.
              </p>
            )}
          </div>
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>{["Company", "Site", "Attendance System", "Lock Time", "Backdate", "Status"].map((header) => <th key={header} className="px-3 py-3">{header}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {attendancePolicies.map((policy) => (
                <tr key={policy.id}>
                  <td className="px-3 py-3">{policy.company_name || "-"}</td>
                  <td className="px-3 py-3">{policy.site_name || "-"}</td>
                  <td className="px-3 py-3">{formatAttendanceSystem(policy.attendance_system)}</td>
                  <td className="px-3 py-3">{policy.lock_time_label || "Not Configured"}</td>
                  <td className="px-3 py-3">{policy.backdate_label || "Not Allowed"}</td>
                  <td className="px-3 py-3"><span className="rounded-full border px-2 py-1 text-xs font-semibold capitalize">{policy.status || "active"}</span></td>
                </tr>
              ))}
              {!attendancePolicies.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No configured policies found.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </section>
  );
}
