"use client";

import { CheckCircle2, Lock, Save, Unlock } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { useAccessContext } from "@/components/AccessContext";
import { clearSelectedLabourContext, labourContextFromLookup, readSelectedLabourContext, resolveSingleLabourSiteId, selectedLabourContextIsValid, selectedLabourSiteIsValid, subscribeLabourWorkspaceSummary, type LabourWorkspaceSummary, writeSelectedLabourContext } from "@/lib/labour/attendanceSystemContext";
import { previousDate, todayInIst } from "@/lib/labour/operations";

const statuses = [
  ["present", "Present"],
  ["absent", "Absent"],
];
const MAX_OT_HOURS = 6;

function attendanceSystemMessage(system: any) {
  if (!system) return "";
  if (system.value === "standard") return "Attendance System 1 — Standard Labour Attendance";
  if (system.value === "site_in_engineer") return "Attendance System 2 — Site-In & Engineer Workflow";
  return system.message || "Attendance system is not configured for this site.";
}

function today() {
  return todayInIst();
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  const [hourText, minuteText] = String(value).split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function initials(name?: string | null) {
  const parts = String(name || "L").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "L";
}

function otValidationMessage(value: unknown) {
  if (value === "" || value === null || value === undefined) return "";
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return "OT Hours must be a whole number from 0 to 6.";
  const hours = Number(text);
  if (!Number.isSafeInteger(hours) || hours < 0) return "OT Hours must be a whole number from 0 to 6.";
  if (hours > MAX_OT_HOURS) return "Maximum OT allowed is 6 hours.";
  return "";
}

function ShiftToggle({ value, disabled, onChange }: {
  value?: "present" | "absent" | null;
  disabled?: boolean;
  onChange: (value: "present" | "absent") => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border bg-white text-xs font-bold">
      {statuses.map(([nextValue, label]) => {
        const active = value === nextValue;
        const activeClass = nextValue === "present" ? "bg-green-600 text-white" : "bg-red-600 text-white";
        return (
          <button
            key={nextValue}
            type="button"
            disabled={disabled}
            onClick={() => onChange(nextValue as "present" | "absent")}
            className={`min-h-10 px-3 disabled:opacity-60 ${active ? activeClass : "text-slate-700 hover:bg-slate-50"}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default function LabourDailyAttendancePage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const global = hasGlobalAccess(access);
  const canRecoverOlderAttendance = global || Boolean(access?.roleCodes?.includes("super_admin"));
  const todayDate = today();
  const earliestNormalEditDate = previousDate(todayDate);
  const canAddAttendance = global || can(permissions, "labour_attendance", "add");
  const canEditAttendance = global || can(permissions, "labour_attendance", "edit");
  const canSave = canAddAttendance || canEditAttendance;
  const canSubmit = global || can(permissions, "labour_attendance", "submit");
  const canLock = global || can(permissions, "labour_attendance_approval", "approve");
  const canUnlock = global || can(permissions, "labour_attendance_unlock", "approve");
  const canOverride = global || can(permissions, "labour_attendance", "override");
  const [lookups, setLookups] = useState<any>({ companies: [], sites: [], contractors: [] });
  const [labourWorkspace, setLabourWorkspace] = useState<LabourWorkspaceSummary>({ pairs: [], attendance_systems: [] });
  const [filters, setFilters] = useState({ company_id: "", site_id: "", contractor_profile_id: "", labour_search: "", attendance_date: today() });
  const [rows, setRows] = useState<any[]>([]);
  const [period, setPeriod] = useState<any>(null);
  const [dayLock, setDayLock] = useState<any>(null);
  const [readOnlyReason, setReadOnlyReason] = useState("");
  const [policy, setPolicy] = useState<any>(null);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");
  const [submitSuccessMessage, setSubmitSuccessMessage] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [rowLoading, setRowLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [restoringContext, setRestoringContext] = useState(true);
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);
  const [unlockReason, setUnlockReason] = useState("");
  const [unsavedAction, setUnsavedAction] = useState<null | (() => void)>(null);
  const lookupAbortRef = useRef<AbortController | null>(null);
  const lookupRequestRef = useRef(0);

  const filteredSites = useMemo(() => lookups.sites || [], [lookups.sites]);
  const displayedRows = useMemo(() => {
    const normalizedLabourSearch = filters.labour_search.trim().toLowerCase();
    return rows.filter((row) => {
      const contractorMatches = !filters.contractor_profile_id || row.contractor?.id === filters.contractor_profile_id;
      const labourMatches = !normalizedLabourSearch
        || String(row.worker?.worker_name || "").toLowerCase().includes(normalizedLabourSearch)
        || String(row.worker?.labour_code || "").toLowerCase().includes(normalizedLabourSearch);
      return contractorMatches && labourMatches;
    });
  }, [filters.contractor_profile_id, filters.labour_search, rows]);
  const otErrors = useMemo(() => Object.fromEntries(
    rows
      .map((row) => [row.labour_worker_id, otValidationMessage(row.ot_hours)])
      .filter(([, message]) => Boolean(message)),
  ) as Record<string, string>, [rows]);

  const hasUnsavedChanges = Object.values(dirty).some(Boolean);
  const readOnly = dayLock?.is_locked || ["submitted", "finalized"].includes(period?.status);
  const sentBack = period?.status === "reopened";
  const filtersDisabled = rowLoading || saving || submitting;
  const attendanceSystem = lookups.attendance_system || null;
  const systemValue = attendanceSystem?.value || null;
  const policyMissing = Boolean(filters.company_id && filters.site_id && attendanceSystem && systemValue !== "standard" && systemValue !== "site_in_engineer");
  const siteInEngineerSite = systemValue === "site_in_engineer";
  const standardBlocked = policyMissing || siteInEngineerSite;
  async function token() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  }

  async function loadLookups() {
    setMessage("");
    lookupAbortRef.current?.abort();
    const requestId = lookupRequestRef.current + 1;
    lookupRequestRef.current = requestId;
    const controller = new AbortController();
    lookupAbortRef.current = controller;
    setLookupLoading(true);
    try {
      const params = new URLSearchParams({ purpose: "labour_attendance" });
      if (filters.company_id) params.set("company_id", filters.company_id);
      if (filters.site_id) params.set("site_id", filters.site_id);
      if (filters.attendance_date) params.set("attendance_date", filters.attendance_date);
      const response = await fetch(`/api/labour/lookups?${params}`, {
        headers: { Authorization: `Bearer ${await token()}` },
        signal: controller.signal,
      });
      const payload = await response.json();
      if (requestId !== lookupRequestRef.current) return;
      if (!response.ok) {
        setMessage(payload.error || "Could not load attendance filters.");
        return;
      }
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
    } catch (lookupError: any) {
      if (lookupError?.name === "AbortError") return;
      setMessage(lookupError.message || "Could not load attendance filters.");
    } finally {
      if (requestId === lookupRequestRef.current) setLookupLoading(false);
    }
  }

  async function loadRows(options: { skipDirtyConfirm?: boolean } = {}) {
    if (rowLoading) return;
    if (!options.skipDirtyConfirm && hasUnsavedChanges) {
      setUnsavedAction(() => () => loadRows({ skipDirtyConfirm: true }));
      return;
    }
    if (!filters.company_id) return setMessage("Select a company.");
    if (!filters.site_id) return setMessage("Select a site.");
    if (!filters.attendance_date) return setMessage("Select an attendance date.");
    if (policyMissing) return setMessage("Attendance system is not configured for this site.");
    if (siteInEngineerSite) return setMessage("This site uses Site-In & Engineer Daily Labour. Use Site-In and Engineer Daily Labour for attendance.");
    setSubmitSuccessMessage("");
    setMessage("");
    setSubmitted(false);
    setRowLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("company_id", filters.company_id);
      params.set("site_id", filters.site_id);
      params.set("attendance_date", filters.attendance_date);
      const response = await fetch(`/api/labour/attendance/daily?${params}`, { headers: { Authorization: `Bearer ${await token()}` } });
      const payload = await response.json();
      if (!response.ok) return setMessage(payload.error || "Could not load attendance.");
      const nextRows = payload.rows || [];
      setRows(nextRows);
      setMessage(nextRows.length ? "" : "No eligible deployed labourers found for this Site/date.");
      setPeriod(payload.period || null);
      setDayLock(payload.day_lock || null);
      setReadOnlyReason(payload.read_only_reason || "");
      setPolicy(payload.policy || null);
      setDirty({});
    } catch (loadError: any) {
      setMessage(loadError.message || "Could not load attendance.");
    } finally {
      setRowLoading(false);
    }
  }

  function updateRow(workerId: string, patch: Record<string, any>) {
    setMessage("");
    setRows((current) => current.map((row) => row.labour_worker_id === workerId ? { ...row, ...patch } : row));
    setDirty((current) => ({ ...current, [workerId]: true }));
  }

  function applyFilterChange(patch: Partial<typeof filters>, options: { clearContractors?: boolean } = {}) {
    if ("company_id" in patch || "site_id" in patch) clearSelectedLabourContext();
    setRows([]);
    setPeriod(null);
    setDayLock(null);
    setReadOnlyReason("");
    setPolicy(null);
    setDirty({});
    setSubmitted(false);
    if (options.clearContractors) {
      setLookups((current: any) => ({ ...current, contractors: [], attendance_system: null }));
    }
    setFilters((current) => ({ ...current, ...patch }));
  }

  function updateFilters(patch: Partial<typeof filters>, options: { clearContractors?: boolean } = {}) {
    if ("contractor_profile_id" in patch && Object.keys(patch).length === 1) {
      setFilters((current) => ({ ...current, contractor_profile_id: patch.contractor_profile_id || "" }));
      return;
    }
    if ("labour_search" in patch && Object.keys(patch).length === 1) {
      setFilters((current) => ({ ...current, labour_search: patch.labour_search || "" }));
      return;
    }
    const action = () => applyFilterChange(patch, options);
    if (hasUnsavedChanges) {
      setUnsavedAction(() => action);
      return;
    }
    action();
  }

  async function saveDraftAndContinue() {
    if (!unsavedAction || saving || submitting) return;
    setSaving(true);
    try {
      const ok = await persistRows("draft");
      if (!ok) return;
      const action = unsavedAction;
      setUnsavedAction(null);
      action();
    } finally {
      setSaving(false);
    }
  }

  function continueWithoutSaving() {
    if (!unsavedAction) return;
    const action = unsavedAction;
    setDirty({});
    setMessage("");
    setSubmitSuccessMessage("");
    setSubmitted(false);
    setUnsavedAction(null);
    action();
  }

  function updateShiftStatus(workerId: string, shift: "first" | "second", status: "present" | "absent") {
    const row = rows.find((item) => item.labour_worker_id === workerId);
    const field = shift === "first" ? "first_shift_status" : "second_shift_status";
    const existingField = shift === "first" ? "first_half_present" : "second_half_present";
    const reasonField = shift === "first" ? "first_shift_override_reason" : "second_shift_override_reason";
    const label = shift === "first" ? "First Shift" : "Second Shift";
    if (row?.attendance?.[existingField] === false && status === "present" && !canOverride) {
      setMessage(`You need attendance override permission to change ${label} from Absent to Present.`);
      return;
    }
    let overrideReason = row?.[reasonField] || "";
    if (row?.attendance?.[existingField] === false && status === "present" && canOverride && !overrideReason) {
      overrideReason = window.prompt(`Reason for changing ${label} from Absent to Present`)?.trim() || "";
      if (overrideReason.length < 10) {
        setMessage("Enter an override reason of at least 10 characters.");
        return;
      }
    }
    updateRow(workerId, { [field]: status, [reasonField]: overrideReason });
  }

  function batchStatus(status: string) {
    if (!displayedRows.length || readOnly || !canSave) return;
    if (standardBlocked) return;
    const visibleWorkerIds = new Set(displayedRows.map((row) => row.labour_worker_id));
    const savedRows = displayedRows.some((row) => row.attendance);
    const newRows = displayedRows.some((row) => !row.attendance);
    if (savedRows && !canEditAttendance) return setMessage("You do not have permission to edit labour attendance.");
    if (newRows && !canAddAttendance) return setMessage("You do not have permission to add labour attendance.");
    if (savedRows && !window.confirm("This will change the visible attendance rows. Continue?")) return;
    if (status === "present" && displayedRows.some((row) => row.attendance?.first_half_present === false || row.attendance?.second_half_present === false) && !canOverride) {
      setMessage("Mark All Present would change saved Absent shifts back to Present. Attendance override permission is required.");
      return;
    }
    setMessage("");
    setSubmitted(false);
    setRows((current) => current.map((row) => visibleWorkerIds.has(row.labour_worker_id) ? {
      ...row,
      first_shift_status: status,
      second_shift_status: status,
      ot_hours: status === "present" ? row.ot_hours || "" : "",
      bonus_hours: status === "present" ? row.bonus_hours ?? "" : "",
      first_shift_override_reason: "",
      second_shift_override_reason: "",
    } : row));
    setDirty((current) => ({ ...current, ...Object.fromEntries(displayedRows.map((row) => [row.labour_worker_id, true])) }));
  }

  function clearChanges() {
    if (!displayedRows.length || readOnly || !canSave) return;
    if (standardBlocked) return;
    const visibleWorkerIds = new Set(displayedRows.map((row) => row.labour_worker_id));
    if (displayedRows.some((row) => row.attendance) && !canEditAttendance) return setMessage("You do not have permission to edit labour attendance.");
    if (!window.confirm("Reset visible rows to a blank draft state?")) return;
    setRows((current) => current.map((row) => visibleWorkerIds.has(row.labour_worker_id) ? {
      ...row,
      first_shift_status: null,
      second_shift_status: null,
      ot_hours: "",
      bonus_hours: "",
      first_shift_override_reason: "",
      second_shift_override_reason: "",
    } : row));
    setDirty((current) => ({ ...current, ...Object.fromEntries(displayedRows.map((row) => [row.labour_worker_id, true])) }));
    setMessage("");
    setSubmitted(false);
  }

  async function markWorkerInactive(row: any) {
    if (!canEditAttendance) return setMessage("You do not have permission to edit labour attendance.");
    if (readOnly) return setMessage("Attendance is submitted, approved or locked for this date.");
    if (dirty[row.labour_worker_id]) {
      const discard = window.confirm("This labourer has unsaved attendance values. Marking them inactive will remove this row from the current grid and discard those unsaved values. Continue?");
      if (!discard) return;
    }
    const confirmed = window.confirm("Mark this labourer inactive?\n\nThey will be removed from current and future attendance lists. Existing attendance, deployment history, rate history and documents will remain unchanged.");
    if (!confirmed) return;
    const reason = window.prompt("Reason for marking this labourer inactive (minimum 10 characters)")?.trim() || "";
    if (reason.length < 10) {
      setMessage("Reason must be at least 10 characters.");
      return;
    }
    setMessage("");
    try {
      const response = await fetch(`/api/labour/workers/${row.labour_worker_id}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({
          status: "inactive",
          source: "labour_attendance",
          reason,
          effective_date: filters.attendance_date,
          company_id: filters.company_id,
          site_id: filters.site_id,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error || "Could not mark labourer inactive.");
        return;
      }
      setRows((current) => current.filter((item) => item.labour_worker_id !== row.labour_worker_id));
      setDirty((current) => {
        const next = { ...current };
        delete next[row.labour_worker_id];
        return next;
      });
      setMessage("Labourer marked inactive and removed from this attendance grid.");
    } catch (statusError: any) {
      setMessage(statusError.message || "Could not mark labourer inactive.");
    }
  }

  function changeWorkerStatus(row: any, status: string) {
    if (status !== "inactive") return;
    markWorkerInactive(row);
  }

  async function persistRows(mode: "draft" | "submit") {
    if (policyMissing) {
      setMessage("Attendance system is not configured for this site.");
      return false;
    }
    if (siteInEngineerSite) {
      setMessage("This site uses Site-In & Engineer Daily Labour. Use Site-In and Engineer Daily Labour for attendance.");
      return false;
    }
    const changed = mode === "submit" ? rows : rows.filter((row) => dirty[row.labour_worker_id]);
    if (!changed.length) {
      setMessage(mode === "submit" ? "Load attendance before submitting." : "No changes to save.");
      return false;
    }
    const firstInvalidOt = rows.find((row) => otErrors[row.labour_worker_id]);
    if (firstInvalidOt) {
      setMessage("Correct the highlighted OT Hours before saving.");
      window.setTimeout(() => document.getElementById(`ot-hours-${firstInvalidOt.labour_worker_id}`)?.focus(), 0);
      return false;
    }
    setSubmitSuccessMessage("");
    setMessage("");
    const backdated = filters.attendance_date < previousDate(today());
    const backdated_reason = backdated ? prompt("Reason for backdated attendance change") : "";
    if (backdated && !backdated_reason) return false;
    try {
      const response = await fetch("/api/labour/attendance/daily", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({
          company_id: filters.company_id,
          site_id: filters.site_id,
          attendance_date: filters.attendance_date,
          backdated_reason,
          mode,
          rows: changed.map(({ labour_worker_id, first_shift_status, second_shift_status, ot_hours, remarks, first_shift_override_reason, second_shift_override_reason }) => {
            const sourceRow = rows.find((row) => row.labour_worker_id === labour_worker_id);
            const rawOtHours = sourceRow?.ot_hours;
            const safeOtHours = rawOtHours === "" || rawOtHours === null || rawOtHours === undefined ? "" : String(rawOtHours);
            const rawBonusHours = sourceRow?.bonus_hours;
            const safeBonusHours = rawBonusHours === "" || rawBonusHours === null || rawBonusHours === undefined ? "" : String(rawBonusHours);
            return {
              labour_worker_id,
              first_shift_status: first_shift_status || null,
              second_shift_status: second_shift_status || null,
              ot_hours: safeOtHours,
              bonus_hours: safeBonusHours,
              first_shift_override_reason,
              second_shift_override_reason,
              remarks,
            };
          }),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error || "Could not save attendance.");
        return false;
      }
      setMessage(`Saved ${payload.saved} attendance rows.`);
      setDirty({});
      return true;
    } catch (saveError: any) {
      setMessage(saveError.message || "Could not save attendance.");
      return false;
    }
  }

  async function saveRows() {
    if (saving || submitting) return;
    setSaving(true);
    try {
      const ok = await persistRows("draft");
      if (ok) await loadRows({ skipDirtyConfirm: true });
    } finally {
      setSaving(false);
    }
  }

  async function submitRows() {
    if (saving || submitting) return;
    if (!period?.id) return setMessage("Load attendance before submitting.");
    if (!rows.length) return setMessage("Load attendance before submitting.");
    setSubmitting(true);
    setSubmitted(false);
    try {
      const saved = await persistRows("submit");
      if (!saved) return;
      const response = await fetch(`/api/labour/attendance/periods/${period.id}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ attendance_date: filters.attendance_date }),
      });
      const payload = await response.json();
      if (!response.ok) return setMessage(payload.error || "Could not submit attendance.");
      setDirty({});
      await loadRows({ skipDirtyConfirm: true });
      setSubmitted(true);
      setSubmitSuccessMessage(sentBack ? "Attendance resubmitted successfully." : "Attendance submitted successfully.");
      setMessage("");
    } catch (submitError: any) {
      setMessage(submitError.message || "Could not submit attendance.");
    } finally {
      setSubmitting(false);
    }
  }

  async function lockDay() {
    if (!filters.company_id) return setMessage("Select a company.");
    if (!filters.site_id) return setMessage("Select a site.");
    if (!filters.attendance_date) return setMessage("Select an attendance date.");
    if (!rows.length) return setMessage("Load attendance before locking the day.");
    if (hasUnsavedChanges) return setMessage("Save attendance changes before locking the day.");
    const response = await fetch("/api/labour/attendance/day-lock", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({
        company_id: filters.company_id,
        site_id: filters.site_id,
        attendance_date: filters.attendance_date,
      }),
    });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.error || "Could not update lock.");
    setMessage("Day locked.");
    loadRows();
  }

  async function unlockDay() {
    if (!filters.company_id) return setMessage("Select a company.");
    if (!filters.site_id) return setMessage("Select a site.");
    if (!filters.attendance_date) return setMessage("Select an attendance date.");
    const reason = unlockReason.trim();
    if (reason.length < 10) return setMessage("Enter a reason of at least 10 characters to unlock attendance.");
    const response = await fetch("/api/labour/attendance/day-unlock", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({
        company_id: filters.company_id,
        site_id: filters.site_id,
        attendance_date: filters.attendance_date,
        reason,
      }),
    });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.error || "Could not update lock.");
    setMessage("Day unlocked.");
    setUnlockDialogOpen(false);
    setUnlockReason("");
    loadRows();
  }

  useEffect(() => {
    loadLookups();
    return () => lookupAbortRef.current?.abort();
  }, [filters.company_id, filters.site_id, filters.attendance_date]);
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
  useEffect(() => {
    if (!filters.site_id && filters.company_id && filteredSites.length === 1) setFilters((f) => ({ ...f, site_id: filteredSites[0].id }));
  }, [filteredSites, filters.company_id, filters.site_id]);

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-slate-950 md:px-10">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Labour Attendance</p>
            <h1 className="text-3xl font-semibold">Mark Labour Attendance</h1>
            <p className="text-sm text-slate-600">Record daily attendance for active deployed labourers.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canSave && !readOnly && (
              <button onClick={saveRows} disabled={saving || submitting || !hasUnsavedChanges} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                <Save className="h-4 w-4" /> {saving ? "Saving attendance..." : "Save Draft"}
              </button>
            )}
            {canSubmit && !readOnly && (
              <button onClick={submitRows} disabled={saving || submitting || rowLoading || !rows.length} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                <CheckCircle2 className="h-4 w-4" /> {submitting ? "Submitting attendance..." : sentBack ? "Resubmit Attendance" : "Submit Attendance"}
              </button>
            )}
            {canLock && (
              <button onClick={lockDay} disabled={!rows.length || hasUnsavedChanges || readOnly || saving || submitting} className="inline-flex min-h-11 items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm font-semibold disabled:opacity-60">
                <Lock className="h-4 w-4" /> Lock Day
              </button>
            )}
            {canUnlock && dayLock?.is_locked && (
              <button onClick={() => setUnlockDialogOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm font-semibold">
                <Unlock className="h-4 w-4" /> Unlock Day
              </button>
            )}
          </div>
        </header>

        {message && <div className="rounded-lg border bg-white p-3 text-sm">{message}</div>}
        {readOnly && readOnlyReason && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
            {readOnlyReason}
          </div>
        )}
        {filters.company_id && filters.site_id && attendanceSystem && (
          <div className={`rounded-lg border bg-white p-3 text-sm ${standardBlocked ? "border-amber-200 text-amber-800" : "border-emerald-200 text-emerald-800"}`}>
            <p className="font-semibold">{attendanceSystemMessage(attendanceSystem)}</p>
            {policyMissing && <p className="mt-1">Attendance system is not configured for this site.</p>}
            {siteInEngineerSite && (
              <p className="mt-1">
                This site uses Site-In & Engineer Daily Labour.{" "}
                <a href="/labour/site-in" className="font-semibold underline">Go to Site-In</a>
                {" · "}
                <a href="/labour/engineer-daily" className="font-semibold underline">Go to Engineer Daily Labour</a>
              </p>
            )}
          </div>
        )}
        {submitted && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-800">
            <div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5" /> {submitSuccessMessage || "Attendance submitted successfully."}</div>
          </div>
        )}
        {sentBack && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm">
            <p className="text-base font-bold">Attendance Sent Back</p>
            <div className="mt-2 grid gap-1 md:grid-cols-2">
              <p><span className="font-semibold">Reason:</span> {period.transition_reason || "No reason recorded."}</p>
              <p><span className="font-semibold">Sent Back By:</span> {period.reopened_by_name || period.reopened_by_email || period.updated_by_name || period.updated_by_email || "-"}</p>
              <p><span className="font-semibold">Sent Back At:</span> {period.reopened_at ? new Date(period.reopened_at).toLocaleString("en-IN") : period.updated_at ? new Date(period.updated_at).toLocaleString("en-IN") : "-"}</p>
              <p><span className="font-semibold">Previously Submitted:</span> {period.submitted_at ? new Date(period.submitted_at).toLocaleString("en-IN") : "-"}</p>
            </div>
            <p className="mt-2 font-semibold">Correct the Labour attendance for this site/date and resubmit it for approval.</p>
          </div>
        )}

        <div className="grid gap-3 rounded-lg border bg-white p-4 shadow-sm md:grid-cols-6">
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Company
            <select disabled={filtersDisabled} value={filters.company_id} onChange={(e) => {
              updateFilters({ company_id: e.target.value, contractor_profile_id: "" }, { clearContractors: true });
            }} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950 disabled:bg-slate-100">
              <option value="">Company</option>
              {lookups.companies.map((company: any) => <option key={company.id} value={company.id}>{company.company_name}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Site
            <select disabled={filtersDisabled} value={filters.site_id} onChange={(e) => {
              updateFilters({ site_id: e.target.value, contractor_profile_id: "" }, { clearContractors: true });
            }} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950 disabled:bg-slate-100">
              <option value="">Site</option>
              {!filteredSites.length && <option value="" disabled>No permitted sites available</option>}
              {filteredSites.map((site: any) => <option key={site.id} value={site.id}>{site.site_name}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Attendance Date
            <input disabled={filtersDisabled} type="date" value={filters.attendance_date} min={canRecoverOlderAttendance ? undefined : earliestNormalEditDate} max={todayDate} onChange={(e) => {
              updateFilters({ attendance_date: e.target.value, contractor_profile_id: "" }, { clearContractors: true });
            }} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950 disabled:bg-slate-100" />
          </label>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Contractor
            <div className="relative mt-1">
              <select disabled={filtersDisabled || lookupLoading} value={filters.contractor_profile_id} onChange={(e) => updateFilters({ contractor_profile_id: e.target.value })} className="h-11 w-full rounded-lg border px-3 pr-9 text-sm font-normal normal-case tracking-normal text-slate-950 disabled:bg-slate-100">
                <option value="">{lookupLoading ? "Loading contractors..." : "All Contractors"}</option>
                {lookups.contractors.map((contractor: any) => <option key={contractor.id} value={contractor.id}>{contractor.vendors?.vendor_name || contractor.contractor_code}</option>)}
              </select>
              {lookupLoading && <span aria-hidden="true" className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-slate-300 border-t-slate-700 animate-spin" />}
            </div>
          </label>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Labour Name
            <input disabled={filtersDisabled} type="search" value={filters.labour_search} onChange={(e) => updateFilters({ labour_search: e.target.value })} placeholder="Search labour name or code" className="mt-1 h-11 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950 placeholder:text-slate-400 disabled:bg-slate-100" />
          </label>
          <button onClick={() => loadRows()} disabled={filtersDisabled || lookupLoading || standardBlocked} className="h-11 w-full self-end rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60">{rowLoading ? "Loading attendance..." : "Load Attendance"}</button>
        </div>

        {displayedRows.length > 0 && canSave && !readOnly && (
          <div className="flex flex-wrap gap-2 rounded-lg border bg-white p-3 shadow-sm">
            <button type="button" onClick={() => batchStatus("present")} disabled={saving || submitting} className="min-h-11 rounded-lg border px-3 text-sm font-semibold disabled:opacity-60">Mark All Present</button>
            <button type="button" onClick={() => batchStatus("absent")} disabled={saving || submitting} className="min-h-11 rounded-lg border px-3 text-sm font-semibold disabled:opacity-60">Mark All Absent</button>
            <button type="button" onClick={clearChanges} disabled={saving || submitting} className="min-h-11 rounded-lg border px-3 text-sm font-semibold disabled:opacity-60">Clear/Reset</button>
          </div>
        )}

        <div className="hidden overflow-x-auto rounded-lg border bg-white shadow-sm md:block">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>{["S.No.", "Labour", "Contractor", "Category", "Daily Rate", "Worker Status", "First Shift", "Second Shift", "OT Hours", "Bonus Hours"].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {displayedRows.map((row, index) => {
                const controlsDisabled = readOnly || saving || submitting || (row.attendance ? !canEditAttendance : !canAddAttendance);
                return (
                  <tr key={row.labour_worker_id}>
                    <td className="px-3 py-3">{index + 1}</td>
                    <td className="px-3 py-3">{row.worker?.worker_name || "-"}</td>
                    <td className="px-3 py-3">{row.contractor?.vendors?.vendor_name || "Contractor not available"}</td>
                    <td className="px-3 py-3">{row.trade?.trade_name || "-"}</td>
                    <td className="px-3 py-3 whitespace-nowrap font-semibold">{row.daily_rate_label || (row.rate_applicable ? "Not Set" : "N/A")}</td>
                    <td className="px-3 py-3">
                      {canEditAttendance && !readOnly ? (
                        <select value="active" onChange={(event) => changeWorkerStatus(row, event.target.value)} disabled={saving || submitting} className="h-9 rounded-lg border bg-white px-2 text-xs font-semibold disabled:bg-slate-100">
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">Active</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <ShiftToggle value={row.first_shift_status} disabled={controlsDisabled} onChange={(value) => updateShiftStatus(row.labour_worker_id, "first", value)} />
                    </td>
                    <td className="px-3 py-3">
                      <ShiftToggle value={row.second_shift_status} disabled={controlsDisabled} onChange={(value) => updateShiftStatus(row.labour_worker_id, "second", value)} />
                    </td>
                    <td className="px-3 py-3">
                      <input id={`ot-hours-${row.labour_worker_id}`} disabled={controlsDisabled} type="number" min="0" max="6" step="1" inputMode="numeric" value={row.ot_hours ?? ""} onChange={(e) => updateRow(row.labour_worker_id, { ot_hours: e.target.value === "" ? "" : e.target.value })} className={`h-10 w-24 rounded-md border px-2 disabled:bg-slate-100 ${otErrors[row.labour_worker_id] ? "border-red-300 bg-red-50 text-red-800" : ""}`} />
                      {otErrors[row.labour_worker_id] && <p className="mt-1 max-w-36 text-xs font-semibold text-red-700">{otErrors[row.labour_worker_id]}</p>}
                    </td>
                    <td className="px-3 py-3">
                      <input disabled={controlsDisabled} type="number" min="0" step="1" inputMode="numeric" value={row.bonus_hours ?? ""} onChange={(e) => updateRow(row.labour_worker_id, { bonus_hours: e.target.value === "" ? "" : e.target.value })} className="h-10 w-24 rounded-md border px-2 disabled:bg-slate-100" />
                    </td>
                  </tr>
                );
              })}
              {!displayedRows.length && <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-500">{rows.length ? "No labourers match the selected filters." : "Select company, site and date, then load attendance."}</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="space-y-3 md:hidden">
          {displayedRows.map((row) => {
            const controlsDisabled = readOnly || saving || submitting || (row.attendance ? !canEditAttendance : !canAddAttendance);
            return (
              <div key={row.labour_worker_id} className="rounded-lg border bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-700">{initials(row.worker?.worker_name)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-950">{row.worker?.worker_name || "-"}</p>
                    <p className="text-xs font-semibold text-slate-500">{row.contractor?.vendors?.vendor_name || "Contractor not available"}</p>
                    <p className="text-xs text-slate-500">{row.trade?.trade_name || "-"} · {row.daily_rate_label || (row.rate_applicable ? "Not Set" : "N/A")}</p>
                    <div className="mt-2">
                      {canEditAttendance && !readOnly ? (
                        <select value="active" onChange={(event) => changeWorkerStatus(row, event.target.value)} disabled={saving || submitting} className="h-9 rounded-lg border bg-white px-2 text-xs font-semibold disabled:bg-slate-100">
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">Active</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid gap-3">
                  <div className="grid gap-3 rounded-lg bg-slate-50 p-3 text-sm">
                    <div>
                      <p className="text-xs font-bold uppercase text-slate-500">First Shift</p>
                      <div className="mt-1"><ShiftToggle value={row.first_shift_status} disabled={controlsDisabled} onChange={(value) => updateShiftStatus(row.labour_worker_id, "first", value)} /></div>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase text-slate-500">Second Shift</p>
                      <div className="mt-1"><ShiftToggle value={row.second_shift_status} disabled={controlsDisabled} onChange={(value) => updateShiftStatus(row.labour_worker_id, "second", value)} /></div>
                    </div>
                  </div>
                  <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    OT Hours
                    <input id={`ot-hours-${row.labour_worker_id}`} disabled={controlsDisabled} type="number" min="0" max="6" step="1" inputMode="numeric" value={row.ot_hours ?? ""} onChange={(e) => updateRow(row.labour_worker_id, { ot_hours: e.target.value === "" ? "" : e.target.value })} className={`mt-1 h-11 w-full rounded-md border px-2 text-sm font-normal normal-case tracking-normal text-slate-950 disabled:bg-slate-100 ${otErrors[row.labour_worker_id] ? "border-red-300 bg-red-50 text-red-800" : ""}`} />
                    {otErrors[row.labour_worker_id] && <p className="mt-1 text-xs font-semibold normal-case tracking-normal text-red-700">{otErrors[row.labour_worker_id]}</p>}
                  </label>
                  <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    Bonus Hours
                    <input disabled={controlsDisabled} type="number" min="0" step="1" inputMode="numeric" value={row.bonus_hours ?? ""} onChange={(e) => updateRow(row.labour_worker_id, { bonus_hours: e.target.value === "" ? "" : e.target.value })} className="mt-1 h-11 w-full rounded-md border px-2 text-sm font-normal normal-case tracking-normal text-slate-950 disabled:bg-slate-100" />
                  </label>
                </div>
              </div>
            );
          })}
          {!displayedRows.length && <div className="rounded-lg border bg-white px-3 py-8 text-center text-sm text-slate-500">{rows.length ? "No labourers match the selected filters." : "Select company, site and date, then load attendance."}</div>}
        </div>

        {unlockDialogOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
              <h2 className="text-lg font-semibold">Unlock Attendance</h2>
              <p className="mt-2 text-sm text-slate-600">Attendance for this day will become editable again according to the existing unlock-window rules.</p>
              <label className="mt-4 block text-sm font-semibold text-slate-700">
                Reason for Unlock
                <textarea value={unlockReason} onChange={(e) => setUnlockReason(e.target.value)} className="mt-1 min-h-24 w-full rounded-lg border px-3 py-2 text-sm font-normal" />
              </label>
              <p className="mt-1 text-xs text-slate-500">Enter a reason of at least 10 characters to unlock attendance.</p>
              <div className="mt-5 flex justify-end gap-2">
                <button onClick={() => { setUnlockDialogOpen(false); setUnlockReason(""); }} className="rounded-lg border px-4 py-2 text-sm font-semibold">Cancel</button>
                <button onClick={unlockDay} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Unlock</button>
              </div>
            </div>
          </div>
        )}

        {unsavedAction && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
              <h2 className="text-lg font-semibold text-slate-950">Unsaved Attendance Changes</h2>
              <p className="mt-2 text-sm text-slate-600">
                Changing filters will replace the currently loaded attendance rows. Save this draft first, continue without saving, or cancel.
              </p>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => setUnsavedAction(null)} disabled={saving} className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-60">Cancel</button>
                <button type="button" onClick={continueWithoutSaving} disabled={saving} className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-60">Continue Without Saving</button>
                <button type="button" onClick={saveDraftAndContinue} disabled={saving} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {saving ? "Saving..." : "Save Draft & Continue"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
