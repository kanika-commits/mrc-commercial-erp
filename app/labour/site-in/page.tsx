"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { useAccessContext } from "@/components/AccessContext";
import { clearSelectedLabourContext, labourContextFromLookup, readSelectedLabourContext, resolveSingleLabourSiteId, selectedLabourContextIsValid, selectedLabourSiteIsValid, subscribeLabourWorkspaceSummary, type LabourWorkspaceSummary, writeSelectedLabourContext } from "@/lib/labour/attendanceSystemContext";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function nowTime() {
  return new Date().toTimeString().slice(0, 5);
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function attendanceSystemLabel(system: any) {
  if (!system) return "";
  if (system.value === "standard") return "Attendance System 1 — Standard Labour Attendance";
  if (system.value === "site_in_engineer") return "Attendance System 2 — Site-In & Engineer Workflow";
  return system.message || "Attendance system is not configured for this site.";
}

export default function LabourSiteInPage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const global = hasGlobalAccess(access);
  const canMark = global || can(permissions, "labour_site_in", "add");
  const canCorrectTime = global || can(permissions, "labour_site_in", "correct_time");
  const [lookups, setLookups] = useState<any>({ companies: [], sites: [], contractors: [] });
  const [labourWorkspace, setLabourWorkspace] = useState<LabourWorkspaceSummary>({ pairs: [], attendance_systems: [] });
  const [filters, setFilters] = useState({ company_id: "", site_id: "", contractor_profile_id: "", site_in_date: today(), search: "" });
  const [engineers, setEngineers] = useState<any[]>([]);
  const [assignedEngineerId, setAssignedEngineerId] = useState("");
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([]);
  const [saveSummary, setSaveSummary] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [engineerLoading, setEngineerLoading] = useState(false);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [loading, setLoading] = useState(false);
  const [correcting, setCorrecting] = useState<any>(null);
  const [correctionForm, setCorrectionForm] = useState({ site_in_time: "", reason: "" });
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [restoringContext, setRestoringContext] = useState(true);
  const lookupRequestRef = useRef(0);
  const lookupAbortRef = useRef<AbortController | null>(null);

  const actionInProgress = loading || savingCorrection || savingAssignment;
  const filteredSites = useMemo(() => lookups.sites || [], [lookups.sites]);
  const attendanceSystem = lookups.attendance_system || null;
  const systemValue = attendanceSystem?.value || null;
  const policyMissing = Boolean(filters.company_id && filters.site_id && attendanceSystem && systemValue !== "standard" && systemValue !== "site_in_engineer");
  const standardSite = systemValue === "standard";
  const workflowBlocked = policyMissing || standardSite;

  async function token() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  }

  async function parsePayload(response: Response) {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { error: text };
    }
  }

  async function loadLookups() {
    const requestId = lookupRequestRef.current + 1;
    lookupRequestRef.current = requestId;
    lookupAbortRef.current?.abort();
    const controller = new AbortController();
    lookupAbortRef.current = controller;
    setMessage("");
    setLookupLoading(true);
    try {
      const params = new URLSearchParams({ purpose: "labour_site_in" });
      if (filters.company_id) params.set("company_id", filters.company_id);
      if (filters.site_id) params.set("site_id", filters.site_id);
      if (filters.site_in_date) params.set("site_in_date", filters.site_in_date);
      const response = await fetch(`/api/labour/lookups?${params.toString()}`, {
        headers: { Authorization: `Bearer ${await token()}` },
        signal: controller.signal,
      });
      const payload = await parsePayload(response);
      if (!response.ok) return setMessage(payload.error || "Could not load Site-In filters.");
      if (requestId !== lookupRequestRef.current) return;
      setLookups(payload);
      setFilters((current) => {
        const companyValid = !current.company_id || (payload.companies || []).some((company: any) => company.id === current.company_id);
        const siteValid = !current.site_id || (payload.sites || []).some((site: any) => site.id === current.site_id);
        const contractorValid = !current.contractor_profile_id || (payload.contractors || []).some((contractor: any) => contractor.id === current.contractor_profile_id);
        return {
          ...current,
          company_id: companyValid ? current.company_id : "",
          site_id: siteValid ? current.site_id : "",
          contractor_profile_id: contractorValid ? current.contractor_profile_id : "",
        };
      });
    } catch (error: any) {
      if (error?.name === "AbortError") return;
      setMessage(error.message || "Could not load Site-In filters.");
    } finally {
      if (requestId === lookupRequestRef.current) setLookupLoading(false);
    }
  }

  async function loadRows() {
    if (loading) return;
    if (!filters.company_id) return setMessage("Select a company.");
    if (!filters.site_id) return setMessage("Select a site.");
    if (!filters.site_in_date) return setMessage("Select a Site-In date.");
    if (!assignedEngineerId) return setMessage("Select an engineer.");
    if (policyMissing) return setMessage("Attendance system is not configured for this site.");
    if (standardSite) return setMessage("This site uses Standard Labour Attendance. Site-In is not required.");
    setMessage("");
    setLoading(true);
    try {
      const params = new URLSearchParams({
        company_id: filters.company_id,
        site_id: filters.site_id,
        site_in_date: filters.site_in_date,
      });
      if (filters.contractor_profile_id) params.set("contractor_profile_id", filters.contractor_profile_id);
      if (filters.search.trim()) params.set("search", filters.search.trim());
      params.set("engineer_employee_id", assignedEngineerId);
      const response = await fetch(`/api/labour/site-in?${params.toString()}`, { headers: { Authorization: `Bearer ${await token()}` } });
      const payload = await parsePayload(response);
      if (!response.ok) return setMessage(payload.error || "Could not load Site-In labourers.");
      const loadedRows = payload.rows || [];
      setRows(loadedRows);
      setEngineers(payload.engineers || []);
      setSelectedWorkerIds(
        loadedRows
          .filter((row: any) => row.assigned_engineer_employee_id && row.assigned_engineer_employee_id === assignedEngineerId)
          .map((row: any) => row.labour_worker_id)
          .filter(Boolean),
      );
      setSaveSummary(null);
      setMessage(loadedRows.length ? "" : "No deployed labourers found for this Site/date.");
    } catch (error: any) {
      setMessage(error.message || "Could not load Site-In labourers.");
    } finally {
      setLoading(false);
    }
  }

  async function loadEngineers() {
    setEngineers([]);
    setAssignedEngineerId("");
    if (!filters.company_id || !filters.site_id || !filters.site_in_date) return;
    if (workflowBlocked) return;
    setEngineerLoading(true);
    try {
      const params = new URLSearchParams({
        company_id: filters.company_id,
        site_id: filters.site_id,
        site_in_date: filters.site_in_date,
        assignment_only: "true",
      });
      const response = await fetch(`/api/labour/site-in?${params.toString()}`, { headers: { Authorization: `Bearer ${await token()}` } });
      const payload = await parsePayload(response);
      if (!response.ok) return setMessage(payload.error || "Could not load engineers.");
      setEngineers(payload.engineers || []);
    } catch (error: any) {
      setMessage(error.message || "Could not load engineers.");
    } finally {
      setEngineerLoading(false);
    }
  }

  function toggleWorker(row: any, checked: boolean) {
    if (!row.selectable) return;
    setSelectedWorkerIds((current) => checked
      ? Array.from(new Set([...current, row.labour_worker_id]))
      : current.filter((id) => id !== row.labour_worker_id));
    setSaveSummary(null);
  }

  async function saveEngineerAssignment() {
    if (savingAssignment) return;
    if (policyMissing) return setMessage("Attendance system is not configured for this site.");
    if (standardSite) return setMessage("This site uses Standard Labour Attendance. Site-In is not required.");
    if (!assignedEngineerId) return setMessage("Select an engineer.");
    if (!selectedWorkerIds.length) return setMessage("Select at least one labourer.");
    setMessage("");
    setSavingAssignment(true);
    try {
      const response = await fetch("/api/labour/site-in", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({
          action: "assign_engineer",
          company_id: filters.company_id,
          site_id: filters.site_id,
          contractor_profile_id: filters.contractor_profile_id,
          site_in_date: filters.site_in_date,
          site_in_time: nowTime(),
          engineer_employee_id: assignedEngineerId,
          labour_worker_ids: selectedWorkerIds,
        }),
      });
      const payload = await parsePayload(response);
      if (!response.ok) return setMessage(payload.error || "Could not assign labour to engineer.");
      setSaveSummary(payload);
      setMessage("Site-In and engineer assignment saved.");
      await loadRows();
    } catch (error: any) {
      setMessage(error.message || "Could not assign labour to engineer.");
    } finally {
      setSavingAssignment(false);
    }
  }

  function openCorrection(row: any) {
    if (!row.site_in) return;
    setCorrecting(row);
    setCorrectionForm({ site_in_time: String(row.site_in_time || "").slice(0, 5), reason: "" });
    setMessage("");
  }

  async function saveCorrection() {
    if (!correcting?.site_in?.id || savingCorrection) return;
    const reason = correctionForm.reason.trim();
    if (!correctionForm.site_in_time) return setMessage("New Site-In time is required.");
    if (reason.length < 10) return setMessage("Enter a correction reason of at least 10 characters.");
    setSavingCorrection(true);
    setMessage("");
    try {
      const response = await fetch("/api/labour/site-in", {
        method: "PATCH",
        headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({
          site_in_id: correcting.site_in.id,
          site_in_time: correctionForm.site_in_time,
          reason,
        }),
      });
      const payload = await parsePayload(response);
      if (!response.ok) return setMessage(payload.error || "Could not correct Site-In time.");
      setCorrecting(null);
      setCorrectionForm({ site_in_time: "", reason: "" });
      setMessage("Site-In time corrected.");
      await loadRows();
    } catch (error: any) {
      setMessage(error.message || "Could not correct Site-In time.");
    } finally {
      setSavingCorrection(false);
    }
  }

  useEffect(() => { loadLookups(); }, [filters.company_id, filters.site_id, filters.site_in_date]);
  useEffect(() => {
    const savedContext = readSelectedLabourContext();
    if (savedContext) {
      setFilters((current) => ({
        ...current,
        company_id: savedContext.company_id,
        site_id: savedContext.site_id,
        contractor_profile_id: "",
      }));
    }
    setRestoringContext(false);
  }, []);
  useEffect(() => subscribeLabourWorkspaceSummary(setLabourWorkspace), []);
  useEffect(() => {
    if (restoringContext) return;
    const savedContext = readSelectedLabourContext();
    if (selectedLabourContextIsValid(savedContext, labourWorkspace)) return;
    const singleSiteId = resolveSingleLabourSiteId(labourWorkspace);
    if (singleSiteId && !selectedLabourSiteIsValid(filters.site_id, labourWorkspace)) {
      setFilters((current) => ({
        ...current,
        site_id: singleSiteId,
        contractor_profile_id: "",
      }));
      return;
    }
    if (savedContext && labourWorkspace.pairs.length > 0) clearSelectedLabourContext();
  }, [filters.company_id, filters.site_id, labourWorkspace, restoringContext]);
  useEffect(() => {
    if (restoringContext) return;
    if (!filters.company_id || !filters.site_id) {
      clearSelectedLabourContext();
      return;
    }
    if (!attendanceSystem) return;
    writeSelectedLabourContext(labourContextFromLookup({
      companyId: filters.company_id,
      siteId: filters.site_id,
      companies: lookups.companies,
      attendanceSystem,
    }));
  }, [attendanceSystem, filters.company_id, filters.site_id, lookups.companies, restoringContext]);
  useEffect(() => { loadEngineers(); }, [filters.company_id, filters.site_id, filters.site_in_date]);
  useEffect(() => {
    if (!filters.site_id && filters.company_id && filteredSites.length === 1) setFilters((current) => ({ ...current, site_id: filteredSites[0].id }));
  }, [filteredSites, filters.company_id, filters.site_id]);

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-slate-950 md:px-10">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Labour Site-In</p>
          <h1 className="text-3xl font-semibold">Site-In</h1>
          <p className="text-sm text-slate-600">Site HR assigns labourers to engineers during Site-In. Engineers will create temporary teams later.</p>
        </header>

        {message && <div className="rounded-lg border bg-white p-3 text-sm font-semibold">{message}</div>}
        {filters.company_id && filters.site_id && attendanceSystem && (
          <div className={`rounded-lg border bg-white p-3 text-sm ${workflowBlocked ? "border-amber-200 text-amber-800" : "border-emerald-200 text-emerald-800"}`}>
            <p className="font-semibold">{attendanceSystemLabel(attendanceSystem)}</p>
            {policyMissing && <p className="mt-1">Attendance system is not configured for this site.</p>}
            {standardSite && (
              <p className="mt-1">
                This site uses Standard Labour Attendance. Site-In is not required.{" "}
                <a href="/labour/attendance/daily" className="font-semibold underline">Go to Standard Attendance</a>
              </p>
            )}
          </div>
        )}

        <div className="grid gap-3 rounded-lg border bg-white p-4 shadow-sm md:grid-cols-7">
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Company
            <select disabled={actionInProgress} value={filters.company_id} onChange={(event) => {
              clearSelectedLabourContext();
              setLookups((current: any) => ({ ...current, contractors: [], attendance_system: null }));
              setFilters({ ...filters, company_id: event.target.value, contractor_profile_id: "" });
            }} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950 disabled:bg-slate-100">
              <option value="">Company</option>
              {lookups.companies.map((company: any) => <option key={company.id} value={company.id}>{company.company_name}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Site
            <select disabled={actionInProgress} value={filters.site_id} onChange={(event) => {
              clearSelectedLabourContext();
              setLookups((current: any) => ({ ...current, contractors: [], attendance_system: null }));
              setFilters({ ...filters, site_id: event.target.value, contractor_profile_id: "" });
            }} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950 disabled:bg-slate-100">
              <option value="">Site</option>
              {!filteredSites.length && <option value="" disabled>No permitted sites available</option>}
              {filteredSites.map((site: any) => <option key={site.id} value={site.id}>{site.site_name}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Date
            <input disabled={actionInProgress} type="date" value={filters.site_in_date} onChange={(event) => {
              setLookups((current: any) => ({ ...current, contractors: [], attendance_system: null }));
              setFilters({ ...filters, site_in_date: event.target.value, contractor_profile_id: "" });
            }} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950 disabled:bg-slate-100" />
          </label>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Contractor
            <select disabled={actionInProgress || lookupLoading || !filters.company_id || !filters.site_id} value={filters.contractor_profile_id} onChange={(event) => setFilters({ ...filters, contractor_profile_id: event.target.value })} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950 disabled:bg-slate-100">
              <option value="">All Contractors</option>
              {lookupLoading && <option value="" disabled>Loading contractors...</option>}
              {lookups.contractors.map((contractor: any) => <option key={contractor.id} value={contractor.id}>{contractor.vendors?.vendor_name || contractor.contractor_code}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Engineer
            <select disabled={actionInProgress || engineerLoading || !filters.company_id || !filters.site_id || workflowBlocked} value={assignedEngineerId} onChange={(event) => {
              setAssignedEngineerId(event.target.value);
              setRows([]);
              setSelectedWorkerIds([]);
              setSaveSummary(null);
            }} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950 disabled:bg-slate-100">
              <option value="">{engineerLoading ? "Loading..." : "Select Engineer"}</option>
              {engineers.map((engineer: any) => <option key={engineer.id} value={engineer.id}>{engineer.label || engineer.full_name || engineer.email}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Search
            <div className="mt-1 flex h-11 items-center gap-2 rounded-lg border bg-white px-3">
              <Search className="h-4 w-4 text-slate-400" />
              <input disabled={actionInProgress} value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Code or name" className="min-w-0 flex-1 text-sm font-normal normal-case tracking-normal outline-none disabled:bg-white" />
            </div>
          </label>
          <button type="button" onClick={loadRows} disabled={actionInProgress || lookupLoading || workflowBlocked || !assignedEngineerId} className="h-11 w-full self-end rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60">{loading ? "Loading..." : "Load Labour"}</button>
        </div>

        {!!rows.length && (
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-[260px] flex-1 rounded-lg bg-slate-50 p-3 text-sm">
                <p className="font-semibold text-slate-800">{selectedWorkerIds.length} labourer{selectedWorkerIds.length === 1 ? "" : "s"} selected</p>
                <p className="mt-1 text-slate-600">{assignedEngineerId ? "Selected labourers will be assigned to the chosen engineer." : "Select an engineer, then choose labourers to Site-In."}</p>
              </div>
              <button type="button" onClick={saveEngineerAssignment} disabled={!canMark || actionInProgress || !assignedEngineerId || !selectedWorkerIds.length || workflowBlocked} className="h-11 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-60">
                {savingAssignment ? "Saving Site-In..." : "Site In"}
              </button>
            </div>
          </div>
        )}

        {saveSummary?.assignments?.length ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="font-bold">Saved Engineer Assignment</p>
            <p className="mt-1">{saveSummary.selected_workers} labourer{saveSummary.selected_workers === 1 ? "" : "s"} assigned to {saveSummary.engineer?.label || "the selected engineer"}.</p>
            {saveSummary.engineer?.user_id ? null : <p className="mt-1 text-amber-800">Selected engineer has no ERP login. Assignment is allowed; login can be linked later from Admin Users.</p>}
          </div>
        ) : null}

        <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>{["Select", "Labour Name", "Labour Code", "Contractor", "Category", "Daily Rate", "Site-In Status", "Assigned Engineer"].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.deployment_id}>
                  <td className="px-3 py-3">
                    <input type="checkbox" checked={selectedWorkerIds.includes(row.labour_worker_id)} disabled={actionInProgress || !row.selectable} onChange={(event) => toggleWorker(row, event.target.checked)} className="h-4 w-4 rounded border-slate-300" aria-label={`Select ${row.worker_name || row.labour_code || "labourer"}`} />
                  </td>
                  <td className="px-3 py-3 font-semibold">{row.worker_name || "-"}</td>
                  <td className="px-3 py-3 font-mono text-xs">{row.labour_code || "-"}</td>
                  <td className="px-3 py-3">{row.contractor_name || "-"}</td>
                  <td className="px-3 py-3">{row.category_name || "-"}</td>
                  <td className="px-3 py-3 font-semibold">{row.daily_rate_label || "Not Set"}</td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${row.site_in ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-700"}`}>
                      {row.site_in ? `Site-In ${formatTime(row.site_in_time)}` : "Not Site-In"}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {row.assigned_engineer_employee_id === assignedEngineerId && <span className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800">Saved</span>}
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${row.assigned_engineer_employee_id ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-700"}`}>{row.assigned_engineer_label || "Not Assigned"}</span>
                      {row.site_in && canCorrectTime && row.can_correct_time && <button type="button" onClick={() => openCorrection(row)} className="min-h-9 rounded-lg border bg-white px-3 text-xs font-bold">Correct Time</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">Select company, site and date, then load Site-In labourers.</td></tr>}
            </tbody>
          </table>
        </div>

        {correcting && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
              <h2 className="text-lg font-semibold">Correct Site-In Time</h2>
              <p className="mt-2 text-sm text-slate-600">Saved Site-In times are locked. Corrections require an authorised reason.</p>
              <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
                <p className="text-xs font-bold uppercase text-slate-500">Existing Time</p>
                <p className="font-semibold">{formatTime(correcting.site_in_time)}</p>
              </div>
              <label className="mt-4 block text-sm font-semibold text-slate-700">
                New Site-In Time
                <input type="time" value={correctionForm.site_in_time} onChange={(event) => setCorrectionForm({ ...correctionForm, site_in_time: event.target.value })} className="mt-1 h-11 w-full rounded-lg border px-3" />
              </label>
              <label className="mt-4 block text-sm font-semibold text-slate-700">
                Correction Reason
                <textarea value={correctionForm.reason} onChange={(event) => setCorrectionForm({ ...correctionForm, reason: event.target.value })} className="mt-1 min-h-24 w-full rounded-lg border px-3 py-2" placeholder="Reason for correcting the saved Site-In time" />
              </label>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={() => setCorrecting(null)} disabled={savingCorrection} className="min-h-11 rounded-lg border px-4 text-sm font-semibold disabled:opacity-60">Cancel</button>
                <button type="button" onClick={saveCorrection} disabled={savingCorrection} className="min-h-11 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60">{savingCorrection ? "Saving..." : "Save Correction"}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
