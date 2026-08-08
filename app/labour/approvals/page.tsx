"use client";

import { CheckCircle2, ChevronDown, Image as ImageIcon, RotateCcw, Search, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useAccessContext } from "@/components/AccessContext";
import { useNotificationCounts } from "@/components/NotificationCountsContext";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { labelFromCode } from "@/lib/labour/constants";
import { resolveSingleLabourSiteId, selectedLabourSiteIsValid, subscribeLabourWorkspaceSummary, type LabourWorkspaceSummary } from "@/lib/labour/attendanceSystemContext";
import { supabase } from "@/lib/supabase";

type AlertTone = "error" | "warning" | "success" | "info";

const statusOptions = [
  ["pending", "Pending Approval"],
  ["sent_back", "Sent Back"],
  ["final_approved", "Approved"],
  ["all", "All"],
];

const standardStatusOptions = [
  ["pending", "Pending Approval"],
  ["finalized", "Approved"],
  ["reopened", "Sent Back"],
  ["all", "All"],
];

const monthlyRegisterStatusOptions = [
  ["submitted", "Pending Approval"],
  ["finalized", "Approved"],
  ["reopened", "Sent Back"],
  ["all", "All"],
];

const monthlyAttendanceOptions = [
  ["all", "All"],
  ["P", "Present"],
  ["A", "Absent"],
  ["HD", "Half Day"],
  ["-", "No Record"],
];

const attendanceExceptionOptions = [
  ["all", "All"],
  ["incomplete", "Incomplete Attendance"],
  ["absent", "Absent"],
  ["ot", "OT Entered"],
  ["bonus", "Bonus Entered"],
];

const photoStatusOptions = [
  ["all", "All"],
  ["with_photos", "With Photos"],
  ["missing_photos", "Missing Photos"],
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function statusLabel(status?: string | null) {
  if (status === "pending_pm_approval") return "Pending Approval";
  if (status === "pending_ho_approval") return "Pending Final Approval";
  if (status === "sent_back_by_pm" || status === "sent_back_by_ho") return "Sent Back";
  if (status === "final_approved") return "Approved";
  if (status === "submitted") return "Submitted";
  if (status === "finalized") return "Approved";
  if (status === "reopened") return "Sent Back";
  if (status === "cancelled") return "Cancelled";
  return labelFromCode(status || "");
}

function statusClass(status?: string | null) {
  if (status === "final_approved") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "finalized") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "sent_back_by_pm" || status === "sent_back_by_ho") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "reopened") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "cancelled") return "bg-red-50 text-red-700 border-red-200";
  return "bg-sky-50 text-sky-700 border-sky-200";
}

function shiftBadge(value: unknown) {
  if (value === true) return <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">Present</span>;
  if (value === false) return <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-bold text-red-700">Absent</span>;
  return <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">Incomplete</span>;
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  const [hourText, minuteText] = String(value).split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function hours(minutes: unknown) {
  const value = Number(minutes || 0);
  return value ? Math.round((value / 60) * 100) / 100 : "-";
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function numberLabel(value: unknown) {
  const amount = Number(value || 0);
  return amount ? String(amount) : "-";
}

function quantityUnit(row: any) {
  if (row.quantity === null || row.quantity === undefined || row.quantity === "") return "-";
  return `${row.quantity} ${row.unit || ""}`.trim();
}

async function readPayload(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || "Request failed." };
  }
}

export function LabourApprovalsPageContent({ historyMode = false }: { historyMode?: boolean }) {
  const { access } = useAccessContext();
  const notifications = useNotificationCounts();
  const permissions = access?.permissions || [];
  const global = hasGlobalAccess(access);
  const isPlatformOwner = Boolean(access?.roleCodes.includes("platform_owner"));
  const canViewDailyApproval = global || can(permissions, "labour_daily_submission", "view");
  const canViewMonthly = global || can(permissions, "labour_attendance", "view");
  const canPmApprove = global || can(permissions, "labour_daily_submission", "pm_approve");
  const canPmSendBack = global || can(permissions, "labour_daily_submission", "pm_send_back");
  const canHoApprove = global || can(permissions, "labour_daily_submission", "ho_approve");
  const canHoSendBack = global || can(permissions, "labour_daily_submission", "ho_send_back");
  const canStandardApprove = global || can(permissions, "labour_daily_submission", "pm_approve");
  const canStandardSendBack = global || can(permissions, "labour_daily_submission", "pm_send_back");
  const showAdvancedStatus = global || (canPmApprove && canHoApprove);
  const primaryStatus = canHoApprove || canPmApprove ? "pending" : "all";
  const [filters, setFilters] = useState({
    company_id: "",
    site_id: "",
    work_date: "",
    date_from: today(),
    date_to: today(),
    contractor_profile_id: "",
    engineer_employee_id: "",
    group_id: "",
    status: historyMode ? "all" : "pending",
    attendance_exception: "all",
    photo_status: "all",
    search: "",
    page: 1,
    page_size: 50,
  });
  const [rows, setRows] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [activeRegister, setActiveRegister] = useState<any>(null);
  const [attendanceSystem, setAttendanceSystem] = useState<"standard" | "site_in_engineer" | null>(null);
  const [summary, setSummary] = useState<any>({});
  const [pagination, setPagination] = useState<any>({ page: 1, page_size: 50, total: 0, total_pages: 1 });
  const [lookups, setLookups] = useState<any>({ companies: [], sites: [], contractors: [], engineers: [], groups: [] });
  const [labourWorkspace, setLabourWorkspace] = useState<LabourWorkspaceSummary>({ pairs: [], attendance_systems: [] });
  const [selectedSubmissionIds, setSelectedSubmissionIds] = useState<string[]>([]);
  const [detailFilters, setDetailFilters] = useState({ contractor: "", category: "", attendance_status: "", search: "" });
  const [photoModal, setPhotoModal] = useState<any>(null);
  const [message, setMessage] = useState<{ tone: AlertTone; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [registerLoaded, setRegisterLoaded] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [activeView, setActiveView] = useState<"daily" | "monthly">("daily");

  const selectedSet = useMemo(() => new Set(selectedSubmissionIds), [selectedSubmissionIds]);
  const visibleSubmissionIds = useMemo(() => Array.from(new Set(submissions.map((row) => row.submission_id || row.id).filter(Boolean))), [submissions]);
  const selectedRegisters = useMemo(() => {
    const selected = submissions.filter((row) => selectedSet.has(row.submission_id || row.id));
    if (activeRegister && selectedSet.has(activeRegister.submission_id || activeRegister.id) && !selected.some((row) => (row.submission_id || row.id) === (activeRegister.submission_id || activeRegister.id))) {
      selected.push(activeRegister);
    }
    return selected;
  }, [activeRegister, selectedSet, submissions]);
  const isStandard = attendanceSystem === "standard";
  const isEngineerMode = attendanceSystem === "site_in_engineer";
  const pageTitle = "Labour Attendance Approval";
  const pageSubtitle = "Review attendance submitted for this site.";
  const visibleStatusOptions = isStandard ? standardStatusOptions : statusOptions;
  const statusValue = isStandard && !standardStatusOptions.some(([value]) => value === filters.status) ? "submitted" : showAdvancedStatus ? filters.status : primaryStatus;
  const siteOptions = useMemo(() => lookups.sites || [], [lookups.sites]);
  const filteredDetailRows = useMemo(() => {
    if (!isStandard || !activeRegister) return rows;
    const query = detailFilters.search.trim().toLowerCase();
    return rows
      .filter((row) => !detailFilters.contractor || row.contractor_profile_id === detailFilters.contractor)
      .filter((row) => !detailFilters.category || row.category === detailFilters.category)
      .filter((row) => {
        if (!detailFilters.attendance_status) return true;
        const status = row.first_half_present === true && row.second_half_present === true
          ? "present"
          : row.first_half_present === false && row.second_half_present === false
            ? "absent"
            : "partial";
        return status === detailFilters.attendance_status;
      })
      .filter((row) => {
        if (!query) return true;
        return `${row.labour_code || ""} ${row.labour_name || ""}`.toLowerCase().includes(query);
      });
  }, [activeRegister, detailFilters, isStandard, rows]);
  const detailContractors = useMemo(() => Array.from(new Map(rows.map((row) => [row.contractor_profile_id || "", { id: row.contractor_profile_id || "", name: row.contractor_name || "All Contractors" }])).values()).filter((item) => item.id), [rows]);
  const detailCategories = useMemo(() => Array.from(new Set(rows.map((row) => row.category).filter(Boolean))).sort(), [rows]);
  const activeRegisterTotals = useMemo(() => {
    const register = activeRegister || {};
    return {
      labourers: register.labourers_count || rows.length || 0,
      present: register.present_count ?? rows.filter((row) => row.first_half_present === true && row.second_half_present === true).length,
      absent: register.absent_count ?? rows.filter((row) => row.first_half_present === false && row.second_half_present === false).length,
      halfDay: register.half_day_count ?? rows.filter((row) =>
        (row.first_half_present === true && row.second_half_present === false) ||
        (row.first_half_present === false && row.second_half_present === true)
      ).length,
      pending: register.pending_count ?? rows.filter((row) =>
        row.first_half_present !== true &&
        row.first_half_present !== false &&
        row.second_half_present !== true &&
        row.second_half_present !== false
      ).length,
      ot: register.total_ot_minutes ?? rows.reduce((sum, row) => sum + Number(row.overtime_minutes || 0), 0),
      bonus: register.total_bonus_minutes ?? rows.reduce((sum, row) => sum + Number(row.bonus_minutes || 0), 0),
      otHours: Math.round((Number(register.total_ot_minutes ?? rows.reduce((sum, row) => sum + Number(row.overtime_minutes || 0), 0)) / 60) * 100) / 100,
      bonusHours: Math.round((Number(register.total_bonus_minutes ?? rows.reduce((sum, row) => sum + Number(row.bonus_minutes || 0), 0)) / 60) * 100) / 100,
    };
  }, [activeRegister, rows]);
  const optionalFilters = useMemo(() => {
    const chips: Array<{ key: keyof typeof filters | "photo_status_missing"; label: string; value: string }> = [];
    const labelFor = (items: any[], id: string) => items.find((item: any) => item.id === id)?.name || id;
    if (filters.contractor_profile_id) chips.push({ key: "contractor_profile_id", label: "Contractor", value: labelFor(lookups.contractors || [], filters.contractor_profile_id) });
    if (isEngineerMode && filters.engineer_employee_id) chips.push({ key: "engineer_employee_id", label: "Engineer", value: labelFor(lookups.engineers || [], filters.engineer_employee_id) });
    if (isEngineerMode && filters.group_id) chips.push({ key: "group_id", label: "Group", value: labelFor(lookups.groups || [], filters.group_id) });
    if (filters.attendance_exception !== "all") chips.push({ key: "attendance_exception", label: "Attendance", value: labelFromCode(filters.attendance_exception) });
    if (isEngineerMode && filters.photo_status !== "all") chips.push({ key: "photo_status", label: "Photo", value: labelFromCode(filters.photo_status) });
    return chips;
  }, [filters, isEngineerMode, lookups.contractors, lookups.engineers, lookups.groups]);

  async function token() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  }

  function showMessage(tone: AlertTone, text: string) {
    setMessage({ tone, text });
  }

  function switchView(view: "daily" | "monthly") {
    setActiveView(view);
    setMessage(null);
    if (view === "daily") resetRegisterState(true);
  }

  function resetRegisterState(clearMode = true) {
    setRows([]);
    setSubmissions([]);
    setActiveRegister(null);
    setSummary({});
    setPagination({ page: 1, page_size: filters.page_size || 50, total: 0, total_pages: 1 });
    setSelectedSubmissionIds([]);
    setRegisterLoaded(false);
    setMoreFiltersOpen(false);
    if (clearMode) setAttendanceSystem(null);
  }

  function patchFilters(patch: Partial<typeof filters>) {
    setFilters((current) => {
      const next = { ...current, ...patch, page: patch.page || 1 };
      if ("company_id" in patch) {
        next.site_id = "";
        next.contractor_profile_id = "";
        next.engineer_employee_id = "";
        next.group_id = "";
        next.attendance_exception = "all";
        next.photo_status = "all";
      }
      if ("site_id" in patch) {
        next.contractor_profile_id = "";
        next.engineer_employee_id = "";
        next.group_id = "";
        next.attendance_exception = "all";
        next.photo_status = "all";
      }
      return next;
    });
    if ("company_id" in patch || "site_id" in patch) {
      resetRegisterState(true);
    }
  }

  function handleCompanyChange(value: string) {
    patchFilters({ company_id: value });
  }

  async function handleSiteChange(value: string) {
    const nextFilters = {
      ...filters,
      site_id: value,
      contractor_profile_id: "",
      engineer_employee_id: "",
      group_id: "",
      attendance_exception: "all",
      photo_status: "all",
      page: 1,
    };
    setFilters(nextFilters);
    resetRegisterState(true);
    if (filters.company_id && value && filters.work_date) {
      await loadRows(nextFilters, { metadataOnly: true, silent: true });
    }
  }

  async function loadRows(nextFilters = filters, options: { metadataOnly?: boolean; silent?: boolean } = {}) {
    const hasDateContext = historyMode ? Boolean(nextFilters.date_from && nextFilters.date_to) : true;
    if (!options.metadataOnly && (!nextFilters.company_id || !nextFilters.site_id || !hasDateContext)) {
      if (!options.silent) showMessage("warning", historyMode ? "Select Company, Site and date range before loading the attendance register." : "Select Company and Site before applying the approval filters.");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const params = new URLSearchParams();
      const statusParam = historyMode
        ? nextFilters.status || "all"
        : attendanceSystem === "standard" && !standardStatusOptions.some(([value]) => value === nextFilters.status)
        ? "submitted"
        : showAdvancedStatus ? nextFilters.status : primaryStatus;
      params.set("status", statusParam);
      params.set("page", String(nextFilters.page || 1));
      params.set("page_size", String(nextFilters.page_size || 50));
      if (options.metadataOnly) params.set("metadata_only", "true");
      if (nextFilters.company_id) params.set("company_id", nextFilters.company_id);
      if (nextFilters.site_id) params.set("site_id", nextFilters.site_id);
      if (historyMode) {
        if (nextFilters.date_from) params.set("date_from", nextFilters.date_from);
        if (nextFilters.date_to) params.set("date_to", nextFilters.date_to);
      } else if (nextFilters.work_date) {
        params.set("work_date", nextFilters.work_date);
      }
      if (nextFilters.contractor_profile_id) params.set("contractor_profile_id", nextFilters.contractor_profile_id);
      if (nextFilters.engineer_employee_id) params.set("engineer_employee_id", nextFilters.engineer_employee_id);
      if (nextFilters.group_id) params.set("group_id", nextFilters.group_id);
      if (nextFilters.attendance_exception !== "all") params.set("attendance_exception", nextFilters.attendance_exception);
      if (nextFilters.photo_status !== "all") params.set("photo_status", nextFilters.photo_status);
      if (nextFilters.search.trim()) params.set("search", nextFilters.search.trim());
      const response = await fetch(`/api/labour/approvals?${params.toString()}`, { headers: { Authorization: `Bearer ${await token()}` } });
      const payload = await readPayload(response);
      if (!response.ok) return showMessage("error", payload.error || "Could not load Labour approvals.");
      setRows([]);
      setSubmissions(payload.submissions || []);
      setActiveRegister(null);
      setAttendanceSystem(payload.attendance_system || null);
      setSummary(payload.summary || {});
      setPagination(payload.pagination || { page: 1, page_size: nextFilters.page_size || 50, total: 0, total_pages: 1 });
      setLookups({
        companies: payload.companies || [],
        sites: payload.sites || [],
        contractors: payload.contractors || [],
        engineers: payload.engineers || [],
        groups: payload.groups || [],
      });
      setSelectedSubmissionIds((current) => current.filter((id) => (payload.submissions || []).some((row: any) => (row.submission_id || row.id) === id)));
      setRegisterLoaded(!options.metadataOnly);
    } catch (error: any) {
      showMessage("error", error.message || "Could not load Labour approvals.");
    } finally {
      setLoading(false);
    }
  }

  function toggleSubmission(submissionId: string, checked: boolean) {
    setSelectedSubmissionIds((current) => checked ? Array.from(new Set([...current, submissionId])) : current.filter((id) => id !== submissionId));
  }

  function selectAllVisible() {
    setSelectedSubmissionIds((current) => Array.from(new Set([...current, ...visibleSubmissionIds])));
  }

  async function transition(action: string, needsReason = false, explicitRegisters?: any[]) {
    const registersForAction = explicitRegisters || selectedRegisters;
    const idsForAction = explicitRegisters
      ? explicitRegisters.map((row) => row.submission_id || row.id).filter(Boolean)
      : selectedSubmissionIds;
    if (!idsForAction.length) return showMessage("warning", isStandard ? "Open an attendance register first." : "Open an engineer submission first.");
    const reason = needsReason ? window.prompt("Remarks are required")?.trim() || "" : "";
    if (needsReason && reason.length < 10) return showMessage("warning", "Enter remarks of at least 10 characters.");
    if (action.includes("approve") && !window.confirm(`Approve this ${isStandard ? "attendance register" : "submission"}?`)) return;
    setActioning(true);
    setMessage(null);
    try {
      const actionTargets = isStandard
        ? registersForAction.map((row) => ({
            id: row.attendance_period_id || row.period_ids?.[0] || row.id,
            period_ids: row.period_ids || null,
            work_date: row.work_date || filters.work_date || null,
          })).filter((row) => row.id)
        : idsForAction.map((id) => ({ id, period_ids: null, work_date: null }));
      for (const target of actionTargets) {
        const response = await fetch("/api/labour/approvals", {
          method: "PATCH",
          headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
          body: JSON.stringify({ id: target.id, period_ids: target.period_ids, work_date: target.work_date, action, reason }),
        });
        const payload = await readPayload(response);
        if (!response.ok) throw new Error(payload.error || "Could not update one selected approval.");
      }
      showMessage("success", "Approval status updated.");
      if (action.includes("send_back")) notifications.refresh();
      setSelectedSubmissionIds([]);
      setActiveRegister(null);
      setRows([]);
      await loadRows();
    } catch (error: any) {
      showMessage("error", error.message || "Could not update approval.");
    } finally {
      setActioning(false);
    }
  }

  function transitionOpenRegister(action: string, needsReason = false) {
    if (!activeRegister) return;
    transition(action, needsReason, [activeRegister]);
  }

  async function exportRegister(format: "xlsx" | "pdf") {
    if (!activeRegister || !isStandard) return;
    setExportOpen(false);
    try {
      const periodIds = activeRegister.period_ids || [activeRegister.submission_id || activeRegister.id];
      const attendanceDate = activeRegister.work_date || filters.work_date || "";
      const response = await fetch(`/api/labour/approvals/export?format=${format}&period_ids=${encodeURIComponent(periodIds.filter(Boolean).join(","))}&attendance_date=${encodeURIComponent(attendanceDate)}`, { headers: { Authorization: `Bearer ${await token()}` } });
      if (!response.ok) throw new Error((await response.text()) || "Could not export attendance register.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `Labour_Attendance.${format}`; anchor.click(); URL.revokeObjectURL(url);
    } catch (error: any) {
      showMessage("error", error.message || "Could not export attendance register.");
    }
  }

  async function deleteAttendance(register: any) {
    const id = register?.submission_id || register?.attendance_period_id || register?.id;
    if (!id) return showMessage("warning", "Open an attendance register first.");
    if (!window.confirm("Delete this attendance permanently?\n\nThis action cannot be undone.")) return;
    const reason = window.prompt("Enter deletion reason of at least 10 characters:")?.trim() || "";
    if (reason.length < 10) return showMessage("warning", "Deletion reason must be at least 10 characters.");
    setActioning(true);
    setMessage(null);
    try {
      const response = await fetch("/api/labour/approvals", {
        method: "DELETE",
        headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({
          mode: isStandard ? "standard" : "site_in_engineer",
          id,
          period_ids: isStandard ? register.period_ids || [id] : null,
          work_date: isStandard ? register.work_date || filters.work_date : null,
          reason,
        }),
      });
      const payload = await readPayload(response);
      if (!response.ok) throw new Error(payload.error || "Could not delete attendance.");
      showMessage("success", "Attendance deleted.");
      setSelectedSubmissionIds([]);
      setActiveRegister(null);
      setRows([]);
      await loadRows();
    } catch (error: any) {
      showMessage("error", error.message || "Could not delete attendance.");
    } finally {
      setActioning(false);
    }
  }

  async function openPhoto(photo: any) {
    if (!photo?.id) return;
    const response = await fetch(`/api/labour/photo-evidence/${encodeURIComponent(photo.id)}`, { headers: { Authorization: `Bearer ${await token()}` } });
    const payload = await readPayload(response);
    if (!response.ok || !payload.url) return showMessage("error", payload.error || "Could not open photo.");
    setPhotoModal({ ...photo, url: payload.url });
  }

  async function openRegister(register: any) {
    const id = register.submission_id || register.id;
    if (!id) return;
    setDetailLoading(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({ id, mode: isStandard ? "standard" : "site_in_engineer" });
      if (isStandard && register.period_ids?.length) params.set("standard_ids", register.period_ids.join(","));
      if (isStandard && register.work_date) params.set("work_date", register.work_date);
      else if (!historyMode && filters.work_date) params.set("work_date", filters.work_date);
      const response = await fetch(`/api/labour/approvals?${params.toString()}`, { headers: { Authorization: `Bearer ${await token()}` } });
      const payload = await readPayload(response);
      if (!response.ok) return showMessage("error", payload.error || "Could not open attendance register.");
      setActiveRegister(payload.submission || register);
      setRows(payload.snapshot?.attendance_rows || []);
      setDetailFilters({ contractor: "", category: "", attendance_status: "", search: "" });
      setSelectedSubmissionIds([id]);
    } catch (error: any) {
      showMessage("error", error.message || "Could not open attendance register.");
    } finally {
      setDetailLoading(false);
    }
  }

  function closeRegister() {
    setRows([]);
    setActiveRegister(null);
    setSelectedSubmissionIds([]);
    setDetailFilters({ contractor: "", category: "", attendance_status: "", search: "" });
  }

  useEffect(() => subscribeLabourWorkspaceSummary(setLabourWorkspace), []);
  useEffect(() => {
    const requestedView = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("view") : "";
    if (requestedView === "monthly" && canViewMonthly) setActiveView("monthly");
    if (!canViewDailyApproval && canViewMonthly) setActiveView("monthly");
    if (!canViewMonthly && canViewDailyApproval) setActiveView("daily");
  }, [canViewDailyApproval, canViewMonthly]);
  useEffect(() => {
    if (activeView !== "daily" || !canViewDailyApproval) return;
    loadRows(filters, { metadataOnly: true, silent: true });
  }, [activeView, canViewDailyApproval]);
  useEffect(() => {
    if (activeView !== "daily" || !canViewDailyApproval) return;
    const singleSiteId = resolveSingleLabourSiteId(labourWorkspace);
    if (!singleSiteId || selectedLabourSiteIsValid(filters.site_id, labourWorkspace)) return;
    const nextFilters = {
      ...filters,
      site_id: singleSiteId,
      page: 1,
    };
    setFilters(nextFilters);
    loadRows(nextFilters, { metadataOnly: true, silent: true });
  }, [activeView, canViewDailyApproval, filters, labourWorkspace]);

  function clearOptionalFilters() {
    patchFilters({ contractor_profile_id: "", engineer_employee_id: "", group_id: "", attendance_exception: "all", photo_status: "all" });
  }

  function removeFilter(key: keyof typeof filters | "photo_status_missing") {
    if (key === "attendance_exception" || key === "photo_status") return patchFilters({ [key]: "all" } as any);
    patchFilters({ [key]: "" } as any);
  }

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-5 py-6 text-slate-950 md:px-8">
      <div className="mx-auto max-w-[1800px] space-y-4">
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Labour Management</p>
          <h1 className="text-3xl font-semibold">{pageTitle}</h1>
          <p className="mt-1 text-sm text-slate-600">{pageSubtitle}</p>
        </header>

        {!historyMode && canViewDailyApproval && canViewMonthly && (
          <div className="inline-flex rounded-lg border bg-white p-1 shadow-sm">
            {[
              ["daily", "Daily Approval"],
              ["monthly", "Monthly View"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => switchView(value as "daily" | "monthly")}
                className={`rounded-md px-4 py-2 text-sm font-semibold ${activeView === value ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-50"}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {message && <Alert tone={message.tone} onDismiss={() => setMessage(null)}>{message.text}</Alert>}

        {!historyMode && activeView === "monthly" && <MonthlyLabourAttendanceView />}

        {activeView === "daily" && (
          <>

        <div className="space-y-3 rounded-lg border bg-white p-4 shadow-sm">
          <div className={historyMode ? "grid gap-3 xl:grid-cols-[minmax(220px,1.1fr)_minmax(260px,1.4fr)_minmax(150px,0.7fr)_minmax(150px,0.7fr)_minmax(150px,0.7fr)]" : "grid gap-3 xl:grid-cols-[minmax(260px,1.4fr)_minmax(320px,1.8fr)_minmax(150px,0.7fr)_minmax(150px,0.7fr)]"}>
            <FilterSelect label="Company" value={filters.company_id} onChange={handleCompanyChange} options={lookups.companies} empty="Select Company" />
            <FilterSelect label="Site" value={filters.site_id} onChange={handleSiteChange} options={siteOptions} empty="Select Site" />
            {!historyMode && <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Attendance Date<input type="date" value={filters.work_date} onChange={(event) => patchFilters({ work_date: event.target.value })} className="mt-1 h-10 w-full rounded-md border px-2 text-sm font-normal normal-case tracking-normal" /></label>}
            {historyMode && <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Attendance Date From<input type="date" value={filters.date_from} onChange={(event) => patchFilters({ date_from: event.target.value })} className="mt-1 h-10 w-full rounded-md border px-2 text-sm font-normal normal-case tracking-normal" /></label>}
            {historyMode && <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Attendance Date To<input type="date" value={filters.date_to} onChange={(event) => patchFilters({ date_to: event.target.value })} className="mt-1 h-10 w-full rounded-md border px-2 text-sm font-normal normal-case tracking-normal" /></label>}
            <div className="flex items-end">
              <button type="button" onClick={() => loadRows()} disabled={loading || !filters.company_id || !filters.site_id || (historyMode ? !filters.date_from || !filters.date_to : false)} className="h-10 w-full rounded-md bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60">{loading ? "Loading..." : historyMode ? "Load History" : "Apply Filters"}</button>
            </div>
          </div>
          <div className={isStandard ? "grid gap-3 xl:grid-cols-[minmax(190px,0.75fr)_minmax(300px,1.4fr)_1fr]" : "grid gap-3 xl:grid-cols-[minmax(190px,0.75fr)_minmax(300px,1.4fr)_minmax(130px,0.45fr)_1fr]"}>
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Status<select value={statusValue} disabled={!isStandard && !showAdvancedStatus} onChange={(event) => patchFilters({ status: event.target.value })} className="mt-1 h-10 w-full rounded-md border px-2 text-sm font-normal normal-case tracking-normal disabled:bg-slate-100">{visibleStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Search<div className="mt-1 flex h-10 items-center gap-2 rounded-md border bg-white px-2"><Search className="h-4 w-4 text-slate-400" /><input value={filters.search} onChange={(event) => patchFilters({ search: event.target.value })} className="min-w-0 flex-1 text-sm font-normal normal-case tracking-normal outline-none" placeholder="Name/code" /></div></label>
            {isEngineerMode && (
              <div className="flex items-end">
                <button type="button" onClick={() => setMoreFiltersOpen((value) => !value)} disabled={!isEngineerMode} className="h-10 w-full rounded-md border px-3 text-sm font-semibold disabled:opacity-50">
                More Filters
                </button>
              </div>
            )}
            <div className="hidden xl:block" />
          </div>
          {optionalFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {optionalFilters.map((chip) => (
                <button key={chip.key} type="button" onClick={() => removeFilter(chip.key)} className="inline-flex items-center gap-1 rounded-full border bg-slate-50 px-3 py-1 text-xs font-bold text-slate-700">
                  {chip.label}: {chip.value} <X className="h-3 w-3" />
                </button>
              ))}
              <button type="button" onClick={clearOptionalFilters} className="text-xs font-bold text-slate-600 underline">Clear Filters</button>
            </div>
          )}
          {moreFiltersOpen && isEngineerMode && (
            <div className="grid gap-2 border-t pt-3 md:grid-cols-2 lg:grid-cols-5">
              {isEngineerMode && <FilterSelect label="Engineer" value={filters.engineer_employee_id} onChange={(value) => patchFilters({ engineer_employee_id: value })} options={lookups.engineers} empty="All Engineers" />}
              <FilterSelect label="Contractor" value={filters.contractor_profile_id} onChange={(value) => patchFilters({ contractor_profile_id: value })} options={lookups.contractors} empty="All Contractors" />
              {isEngineerMode && <FilterSelect label="Group" value={filters.group_id} onChange={(value) => patchFilters({ group_id: value })} options={lookups.groups} empty="All Groups" />}
              <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Attendance Exception<select value={filters.attendance_exception} onChange={(event) => patchFilters({ attendance_exception: event.target.value })} className="mt-1 h-9 w-full rounded-md border px-2 text-sm font-normal normal-case tracking-normal">{attendanceExceptionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              {isEngineerMode && <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Photo Status<select value={filters.photo_status} onChange={(event) => patchFilters({ photo_status: event.target.value })} className="mt-1 h-9 w-full rounded-md border px-2 text-sm font-normal normal-case tracking-normal">{photoStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
            </div>
          )}
        </div>

        {attendanceSystem && <ModeBanner attendanceSystem={attendanceSystem} />}

        {!attendanceSystem && !registerLoaded && (
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm font-semibold text-blue-800 shadow-sm">
            Select Company, Site and Date to load the applicable approval register.
          </div>
        )}

        {!historyMode && !activeRegister && selectedSubmissionIds.length > 0 && <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{selectedSubmissionIds.length} {isStandard ? "attendance periods" : "submissions"} selected</span>
              <button type="button" onClick={selectAllVisible} className="rounded-md border px-3 py-1.5 text-xs font-bold">Select All Visible</button>
            <button type="button" onClick={() => setSelectedSubmissionIds([])} className="rounded-md border px-3 py-1.5 text-xs font-bold">Clear Selection</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {isStandard && canStandardApprove && selectedRegisters.some((row) => row.status === "submitted") && <button type="button" disabled={actioning} onClick={() => transition("standard_approve")} className="inline-flex h-9 items-center gap-2 rounded-md bg-green-700 px-3 text-sm font-semibold text-white disabled:opacity-60"><CheckCircle2 className="h-4 w-4" />Approve</button>}
            {isStandard && canStandardSendBack && selectedRegisters.some((row) => row.status === "submitted") && <button type="button" disabled={actioning} onClick={() => transition("standard_send_back", true)} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold disabled:opacity-60"><RotateCcw className="h-4 w-4" />Send Back</button>}
            {!isStandard && canPmApprove && selectedRegisters.some((row) => row.status === "pending_pm_approval") && <button type="button" disabled={actioning} onClick={() => transition("pm_approve")} className="inline-flex h-9 items-center gap-2 rounded-md bg-green-700 px-3 text-sm font-semibold text-white disabled:opacity-60"><CheckCircle2 className="h-4 w-4" />Approve</button>}
            {!isStandard && canHoApprove && selectedRegisters.some((row) => row.status === "pending_ho_approval") && <button type="button" disabled={actioning} onClick={() => transition("ho_approve")} className="inline-flex h-9 items-center gap-2 rounded-md bg-green-700 px-3 text-sm font-semibold text-white disabled:opacity-60"><CheckCircle2 className="h-4 w-4" />Approve</button>}
            {!isStandard && canPmSendBack && selectedRegisters.some((row) => row.status === "pending_pm_approval") && <button type="button" disabled={actioning} onClick={() => transition("pm_send_back", true)} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold disabled:opacity-60"><RotateCcw className="h-4 w-4" />Send Back</button>}
            {!isStandard && canHoSendBack && selectedRegisters.some((row) => row.status === "pending_ho_approval") && <button type="button" disabled={actioning} onClick={() => transition("ho_send_back", true)} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold disabled:opacity-60"><RotateCcw className="h-4 w-4" />Send Back</button>}
          </div>
        </div>}

        {attendanceSystem && registerLoaded && !activeRegister && (
          <SubmittedRegisterList
            registers={submissions}
            isStandard={isStandard}
            readOnly={historyMode}
            selectedSet={selectedSet}
            toggleSubmission={toggleSubmission}
            openRegister={openRegister}
            deleteRegister={deleteAttendance}
            canDelete={isPlatformOwner && !historyMode}
            loading={detailLoading}
          />
        )}
        {activeRegister && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-white p-4 shadow-sm">
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Attendance Register</p>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{activeRegister.company_name || "-"}</h2>
                  <span className="text-slate-400">/</span>
                  <span className="text-lg font-semibold">{activeRegister.site_name || "-"}</span>
                  <StatusBadge status={activeRegister.status} />
                </div>
                <div className="grid gap-x-6 gap-y-1 text-sm text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
                  <span><strong className="text-slate-800">Attendance Date:</strong> {activeRegister.work_date || activeRegister.period_month || "-"}</span>
                  <span><strong className="text-slate-800">Submitted By:</strong> {activeRegister.submitted_by_name || activeRegister.submitted_by_email || "-"}</span>
                  <span><strong className="text-slate-800">Submitted At:</strong> {formatDateTime(activeRegister.submitted_at)}</span>
                  <span><strong className="text-slate-800">Status:</strong> {statusLabel(activeRegister.status)}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {!historyMode && isStandard && canStandardApprove && activeRegister.status === "submitted" && <button type="button" disabled={actioning} onClick={() => transitionOpenRegister("standard_approve")} className="inline-flex h-10 items-center gap-2 rounded-md bg-green-700 px-4 text-sm font-semibold text-white disabled:opacity-60"><CheckCircle2 className="h-4 w-4" />Approve Register</button>}
                {!historyMode && isStandard && canStandardSendBack && activeRegister.status === "submitted" && <button type="button" disabled={actioning} onClick={() => transitionOpenRegister("standard_send_back", true)} className="inline-flex h-10 items-center gap-2 rounded-md border bg-white px-4 text-sm font-semibold disabled:opacity-60"><RotateCcw className="h-4 w-4" />Send Back Register</button>}
                {!historyMode && isEngineerMode && canPmApprove && activeRegister.status === "pending_pm_approval" && <button type="button" disabled={actioning} onClick={() => transitionOpenRegister("pm_approve")} className="inline-flex h-10 items-center gap-2 rounded-md bg-green-700 px-4 text-sm font-semibold text-white disabled:opacity-60"><CheckCircle2 className="h-4 w-4" />Approve Register</button>}
                {!historyMode && isEngineerMode && canHoApprove && activeRegister.status === "pending_ho_approval" && <button type="button" disabled={actioning} onClick={() => transitionOpenRegister("ho_approve")} className="inline-flex h-10 items-center gap-2 rounded-md bg-green-700 px-4 text-sm font-semibold text-white disabled:opacity-60"><CheckCircle2 className="h-4 w-4" />Approve Register</button>}
                {!historyMode && isEngineerMode && canPmSendBack && activeRegister.status === "pending_pm_approval" && <button type="button" disabled={actioning} onClick={() => transitionOpenRegister("pm_send_back", true)} className="inline-flex h-10 items-center gap-2 rounded-md border bg-white px-4 text-sm font-semibold disabled:opacity-60"><RotateCcw className="h-4 w-4" />Send Back Register</button>}
                {!historyMode && isEngineerMode && canHoSendBack && activeRegister.status === "pending_ho_approval" && <button type="button" disabled={actioning} onClick={() => transitionOpenRegister("ho_send_back", true)} className="inline-flex h-10 items-center gap-2 rounded-md border bg-white px-4 text-sm font-semibold disabled:opacity-60"><RotateCcw className="h-4 w-4" />Send Back Register</button>}
                {isPlatformOwner && <button type="button" disabled={actioning} onClick={() => deleteAttendance(activeRegister)} className="inline-flex h-10 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-700 disabled:opacity-60"><Trash2 className="h-4 w-4" />Delete</button>}
                {isStandard && <div className="relative"><button type="button" onClick={() => setExportOpen((current) => !current)} className="inline-flex h-10 items-center gap-2 rounded-md border bg-white px-4 text-sm font-semibold hover:bg-slate-50"><span>Export</span><ChevronDown className="h-4 w-4" /></button>{exportOpen && <div className="absolute right-0 top-11 z-30 min-w-44 rounded-md border bg-white p-1 text-sm shadow-lg"><button type="button" onClick={() => void exportRegister("xlsx")} className="block w-full rounded px-3 py-2 text-left hover:bg-slate-50">Excel (.xlsx)</button><button type="button" onClick={() => void exportRegister("pdf")} className="block w-full rounded px-3 py-2 text-left hover:bg-slate-50">PDF (.pdf)</button></div>}</div>}
                <button type="button" onClick={closeRegister} className="h-10 rounded-md border bg-white px-4 text-sm font-semibold">{historyMode ? "Back to Attendance Register" : "Back to Registers"}</button>
              </div>
            </div>
            {isStandard && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-white p-3 text-sm shadow-sm">
                <Summary label="Total Labour" value={activeRegisterTotals.labourers || 0} />
                <Summary label="Present" value={activeRegisterTotals.present || 0} />
                <Summary label="Absent" value={activeRegisterTotals.absent || 0} />
                <Summary label="Half Day" value={activeRegisterTotals.halfDay || 0} />
                <Summary label="Attendance Pending" value={activeRegisterTotals.pending || 0} />
                <Summary label="OT Hours" value={activeRegisterTotals.otHours || 0} />
                <Summary label="Bonus Hours" value={activeRegisterTotals.bonusHours || 0} />
              </div>
            )}
            {activeRegister.status === "reopened" && activeRegister.send_back_reason && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm">
                <p className="font-bold">Attendance Sent Back</p>
                <div className="mt-2 grid gap-1 md:grid-cols-2">
                  <p><span className="font-semibold">Reason:</span> {activeRegister.send_back_reason}</p>
                  <p><span className="font-semibold">Sent Back By:</span> {activeRegister.sent_back_by_name || activeRegister.sent_back_by_email || "-"}</p>
                  <p><span className="font-semibold">Sent Back At:</span> {formatDateTime(activeRegister.sent_back_at)}</p>
                  <p><span className="font-semibold">Previously Submitted:</span> {formatDateTime(activeRegister.submitted_at)}</p>
                </div>
              </div>
            )}
            {["sent_back_by_pm", "sent_back_by_ho"].includes(activeRegister.status) && activeRegister.send_back_reason && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm">
                <p className="font-bold">Submission Sent Back</p>
                <div className="mt-2 grid gap-1 md:grid-cols-2">
                  <p><span className="font-semibold">Reason:</span> {activeRegister.send_back_reason}</p>
                  <p><span className="font-semibold">Sent Back By:</span> {activeRegister.sent_back_by_name || activeRegister.sent_back_by_email || "-"}</p>
                  <p><span className="font-semibold">Sent Back At:</span> {formatDateTime(activeRegister.sent_back_at)}</p>
                  <p><span className="font-semibold">Previously Submitted:</span> {formatDateTime(activeRegister.submitted_at)}</p>
                </div>
              </div>
            )}
            {isStandard && (
              <>
                <RegisterDetailFilters
                  filters={detailFilters}
                  contractors={detailContractors}
                  categories={detailCategories}
                  onChange={(patch) => setDetailFilters((current) => ({ ...current, ...patch }))}
                  onClear={() => setDetailFilters({ contractor: "", category: "", attendance_status: "", search: "" })}
                />
                <StandardAttendanceTable rows={filteredDetailRows} />
              </>
            )}
            {isEngineerMode && <EngineerDailyTable rows={rows} openPhoto={openPhoto} />}
          </div>
        )}

        {attendanceSystem && registerLoaded && !activeRegister && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-3 text-sm shadow-sm">
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <select value={filters.page_size} onChange={(event) => { const next = { ...filters, page_size: Number(event.target.value), page: 1 }; setFilters(next); loadRows(next); }} className="h-9 rounded-md border px-2">
              {[50, 100, 200].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={loading || pagination.page <= 1} onClick={() => { const next = { ...filters, page: Math.max(1, filters.page - 1) }; setFilters(next); loadRows(next); }} className="rounded border px-3 py-1.5 disabled:opacity-50">Prev</button>
            <span>Page {pagination.page || 1} / {pagination.total_pages || 1} · {pagination.total || 0} registers</span>
            <button type="button" disabled={loading || pagination.page >= pagination.total_pages} onClick={() => { const next = { ...filters, page: filters.page + 1 }; setFilters(next); loadRows(next); }} className="rounded border px-3 py-1.5 disabled:opacity-50">Next</button>
          </div>
        </div>}
          </>
        )}
      </div>

      {photoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b p-4">
              <div>
                <h2 className="text-lg font-semibold">{photoModal.group_name || "Group Photo"}</h2>
                <p className="text-sm text-slate-500">{photoModal.work_activity || "No activity recorded"}</p>
                <p className="text-xs text-slate-500">Captured by {photoModal.uploaded_by || "-"} · {formatDateTime(photoModal.uploaded_at || photoModal.captured_at)}</p>
              </div>
              <button type="button" onClick={() => setPhotoModal(null)} className="rounded-full border p-2" aria-label="Close photo preview"><X className="h-4 w-4" /></button>
            </div>
            <div className="bg-slate-950 p-3">
              <img src={photoModal.url} alt={photoModal.file_name || "Labour work photo"} className="mx-auto max-h-[70vh] rounded object-contain" />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function MonthlyLabourAttendanceView() {
  const field = "h-10 rounded-md border px-2 text-sm font-normal normal-case tracking-normal";
  const [filters, setFilters] = useState({
    company_id: "",
    site_id: "",
    month: currentMonth(),
    contractor_profile_id: "",
    category: "",
    attendance_status: "all",
    status: "finalized",
    search: "",
  });
  const [rows, setRows] = useState<any[]>([]);
  const [lookups, setLookups] = useState<any>({ companies: [], sites: [], contractors: [], categories: [] });
  const [days, setDays] = useState(31);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const dayNumbers = useMemo(() => Array.from({ length: days }, (_, index) => String(index + 1)), [days]);

  async function token() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  }

  async function loadMonthly(nextFilters = filters) {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({
        view: "monthly",
        month: nextFilters.month,
        status: nextFilters.status,
      });
      if (nextFilters.company_id) params.set("company_id", nextFilters.company_id);
      if (nextFilters.site_id) params.set("site_id", nextFilters.site_id);
      if (nextFilters.contractor_profile_id) params.set("contractor_profile_id", nextFilters.contractor_profile_id);
      if (nextFilters.category) params.set("category", nextFilters.category);
      if (nextFilters.attendance_status !== "all") params.set("attendance_status", nextFilters.attendance_status);
      if (nextFilters.search.trim()) params.set("search", nextFilters.search.trim());
      const response = await fetch(`/api/labour/approvals?${params.toString()}`, {
        headers: { Authorization: `Bearer ${await token()}` },
      });
      const payload = await readPayload(response);
      if (!response.ok) throw new Error(payload.error || "Could not load monthly Labour attendance.");
      setRows(payload.rows || []);
      setDays(payload.days || 31);
      setLookups({
        companies: payload.companies || [],
        sites: payload.sites || [],
        contractors: payload.contractors || [],
        categories: payload.categories || [],
      });
    } catch (error: any) {
      setMessage(error.message || "Could not load monthly Labour attendance.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMonthly();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateFilters(patch: Partial<typeof filters>, autoLoad = true) {
    const next = { ...filters, ...patch };
    if (patch.company_id !== undefined || patch.site_id !== undefined || patch.month !== undefined || patch.status !== undefined) {
      next.contractor_profile_id = patch.contractor_profile_id ?? "";
      next.category = patch.category ?? "";
    }
    setFilters(next);
    if (autoLoad) loadMonthly(next);
  }

  return (
    <section className="space-y-4">
      <div className="grid gap-3 rounded-lg border bg-white p-4 shadow-sm md:grid-cols-3 xl:grid-cols-7">
        <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Company
          <select value={filters.company_id} onChange={(event) => updateFilters({ company_id: event.target.value, site_id: "" })} className={`${field} mt-1 w-full`}>
            <option value="">Select Company</option>
            {lookups.companies.map((company: any) => <option key={company.id} value={company.id}>{company.company_name || company.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Site
          <select value={filters.site_id} onChange={(event) => updateFilters({ site_id: event.target.value })} className={`${field} mt-1 w-full`}>
            <option value="">Select Site</option>
            {lookups.sites.map((site: any) => <option key={`${site.company_id || "site"}:${site.id}`} value={site.id}>{site.site_name || site.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Month
          <input type="month" value={filters.month} onChange={(event) => updateFilters({ month: event.target.value || currentMonth() })} className={`${field} mt-1 w-full`} />
        </label>
        <FilterSelect label="Contractor" value={filters.contractor_profile_id} onChange={(value) => updateFilters({ contractor_profile_id: value })} options={lookups.contractors} empty="All Contractors" />
        <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Category / Trade
          <select value={filters.category} onChange={(event) => updateFilters({ category: event.target.value })} className={`${field} mt-1 w-full`}>
            <option value="">All Categories</option>
            {lookups.categories.map((category: string) => <option key={category} value={category}>{category}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Attendance Status
          <select value={filters.attendance_status} onChange={(event) => updateFilters({ attendance_status: event.target.value })} className={`${field} mt-1 w-full`}>
            {monthlyAttendanceOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Register Status
          <select value={filters.status} onChange={(event) => updateFilters({ status: event.target.value })} className={`${field} mt-1 w-full`}>
            {monthlyRegisterStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold uppercase tracking-wide text-slate-500 md:col-span-2 xl:col-span-3">Labourer Search
          <input value={filters.search} onChange={(event) => updateFilters({ search: event.target.value }, false)} onKeyDown={(event) => { if (event.key === "Enter") loadMonthly(); }} placeholder="Search name, code or contractor" className={`${field} mt-1 w-full`} />
        </label>
        <div className="flex items-end gap-2">
          <button type="button" onClick={() => loadMonthly()} className="h-10 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white">Apply</button>
          <button type="button" onClick={() => updateFilters({ contractor_profile_id: "", category: "", attendance_status: "all", status: "finalized", search: "" })} className="h-10 rounded-md border bg-white px-4 text-sm font-semibold">Clear</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-lg border bg-white p-3 text-xs text-slate-600 shadow-sm">
        <span className="font-bold text-slate-800">Legend</span>
        <span><b>P</b> = Present</span>
        <span><b>A</b> = Absent</span>
        <span><b>HD</b> = Half Day</span>
        <span><b>-</b> = No attendance record</span>
      </div>

      {message && <Alert tone="error" onDismiss={() => setMessage("")}>{message}</Alert>}

      <div className="overflow-auto rounded-lg border bg-white shadow-sm">
        <table className="min-w-[1300px] text-sm">
          <thead className="sticky top-0 z-20 bg-slate-100 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="sticky left-0 z-30 min-w-[220px] bg-slate-100 px-3 py-3">Labour Name / Code</th>
              <th className="min-w-[180px] px-3 py-3">Contractor</th>
              <th className="min-w-[150px] px-3 py-3">Category / Trade</th>
              <th className="min-w-[110px] px-3 py-3">Daily Rate</th>
              {dayNumbers.map((day) => <th key={day} className="px-2 py-3 text-center">{day.padStart(2, "0")}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading && <tr><td colSpan={days + 4} className="px-3 py-8 text-center text-slate-500">Loading monthly attendance...</td></tr>}
            {!loading && rows.map((row) => (
              <tr key={row.labour_worker_id} className="bg-white">
                <td className="sticky left-0 z-10 bg-white px-3 py-3 font-semibold">
                  {row.labour_name || "-"}
                  <span className="block text-xs font-normal text-slate-500">{row.labour_code || "-"}</span>
                </td>
                <td className="px-3 py-3">{row.contractor_name || "-"}</td>
                <td className="px-3 py-3">{row.category || "-"}</td>
                <td className="px-3 py-3">{row.daily_rate_label || "-"}</td>
                {dayNumbers.map((day) => <td key={day} className="px-2 py-3 text-center font-semibold">{row.days?.[day] || "-"}</td>)}
              </tr>
            ))}
            {!loading && !rows.length && <tr><td colSpan={days + 4} className="px-3 py-8 text-center text-slate-500">No monthly Labour attendance records match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SubmittedRegisterList({ registers, isStandard, readOnly = false, selectedSet, toggleSubmission, openRegister, deleteRegister, canDelete = false, loading }: { registers: any[]; isStandard: boolean; readOnly?: boolean; selectedSet: Set<string>; toggleSubmission: (id: string, checked: boolean) => void; openRegister: (register: any) => void; deleteRegister?: (register: any) => void; canDelete?: boolean; loading: boolean }) {
  const headings = isStandard
    ? [...(readOnly ? [] : ["Select"]), "Date", "Company", "Site", "Submitted By", "Submitted At", "Labour", "Present", "Absent", "OT Hours", "Bonus Hours", "Status", readOnly ? "View" : "Review", ...(canDelete ? ["Delete"] : [])]
    : ["Select", "Company", "Site", "Date / Period", "Submission Type", "Submitted By", "Submitted At", "Labourers", "Present", "Absent", "Exceptions", "Status", "Open", ...(canDelete ? ["Delete"] : [])];
  return (
    <div className="overflow-auto rounded-lg border bg-white shadow-sm">
      <table className="min-w-[1300px] text-sm">
        <thead className="sticky top-0 z-10 bg-slate-100 text-left text-xs uppercase text-slate-500">
          <tr>{headings.map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr>
        </thead>
        <tbody className="divide-y">
          {registers.map((register) => {
            const id = register.submission_id || register.id;
            return (
              <tr key={id} className={selectedSet.has(id) ? "bg-sky-50" : "bg-white"}>
                {!readOnly && <td className="px-3 py-3"><input type="checkbox" checked={selectedSet.has(id)} onChange={(event) => toggleSubmission(id, event.target.checked)} aria-label={`Select ${register.company_name} ${register.site_name} register`} /></td>}
                {isStandard ? (
                  <>
                    <td className="px-3 py-3">{register.work_date || register.period_month || "-"}</td>
                    <td className="px-3 py-3 font-semibold">{register.company_name || "-"}</td>
                    <td className="px-3 py-3">{register.site_name || "-"}</td>
                    <td className="px-3 py-3">{register.submitted_by_name || register.submitted_by_email || "-"}</td>
                    <td className="px-3 py-3 text-xs text-slate-500">{formatDateTime(register.submitted_at)}</td>
                    <td className="px-3 py-3">{register.labourers_count || 0}</td>
                    <td className="px-3 py-3">{register.present_count ?? "-"}</td>
                    <td className="px-3 py-3">{register.absent_count ?? "-"}</td>
                    <td className="px-3 py-3">{hours(register.total_ot_minutes)}</td>
                    <td className="px-3 py-3">{hours(register.total_bonus_minutes)}</td>
                    <td className="px-3 py-3"><StatusBadge status={register.status} /></td>
                    <td className="px-3 py-3"><button type="button" disabled={loading} onClick={() => openRegister(register)} className="rounded-md border bg-white px-3 py-1.5 text-xs font-bold disabled:opacity-50">{readOnly ? "View" : "Review"}</button></td>
                    {canDelete && <td className="px-3 py-3"><button type="button" disabled={loading} onClick={() => deleteRegister?.(register)} className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />Delete</button></td>}
                  </>
                ) : (
                  <>
                <td className="px-3 py-3 font-semibold">{register.company_name || "-"}</td>
                <td className="px-3 py-3">{register.site_name || "-"}</td>
                <td className="px-3 py-3">{register.work_date || register.period_month || "-"}</td>
                <td className="px-3 py-3">{isStandard ? "Standard Attendance" : "Engineer Daily Labour"}</td>
                <td className="px-3 py-3">{register.submitted_by_name || register.submitted_by_email || "-"}</td>
                <td className="px-3 py-3 text-xs text-slate-500">{formatDateTime(register.submitted_at)}</td>
                <td className="px-3 py-3">{register.labourers_count || 0}</td>
                <td className="px-3 py-3">{register.present_count ?? "-"}</td>
                <td className="px-3 py-3">{register.absent_count ?? "-"}</td>
                <td className="px-3 py-3">{hours(register.total_ot_minutes)}</td>
                {readOnly && <td className="px-3 py-3">{hours(register.total_bonus_minutes)}</td>}
                {!readOnly && <td className="px-3 py-3">{hours(register.total_bonus_minutes)}</td>}
                <td className="px-3 py-3"><StatusBadge status={register.status} /></td>
                <td className="px-3 py-3"><button type="button" disabled={loading} onClick={() => openRegister(register)} className="rounded-md border bg-white px-3 py-1.5 text-xs font-bold disabled:opacity-50">{readOnly ? "View" : "Open"}</button></td>
                {canDelete && <td className="px-3 py-3"><button type="button" disabled={loading} onClick={() => deleteRegister?.(register)} className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />Delete</button></td>}
                  </>
                )}
              </tr>
            );
          })}
          {!registers.length && <tr><td colSpan={readOnly ? 13 : 13} className="px-3 py-8 text-center text-slate-500">No submitted attendance registers match these filters.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function EngineerDailyTable({ rows, openPhoto }: { rows: any[]; openPhoto: (photo: any) => void }) {
  return (
    <div className="overflow-auto rounded-lg border bg-white shadow-sm">
          <table className="min-w-[1800px] text-sm">
            <thead className="sticky top-0 z-10 bg-slate-100 text-left text-xs uppercase text-slate-500">
              <tr>{["Engineer", "Contractor", "Group Number / Name", "Labour Code", "Labour Name", "Category / Trade", "Site-In Time", "First Half", "Second Half", "OT Hours", "Bonus Hours", "Work Type", "Activity / Work Description", "Quantity + Unit", "Photos", "Group Remarks", "Submitted At", "Status"].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row, index) => {
                const previous = rows[index - 1];
                const firstSubmissionRow = !previous || previous.submission_id !== row.submission_id;
                const firstGroupRow = firstSubmissionRow || previous.group_id !== row.group_id;
                return (
                  <tr key={row.id} className={firstSubmissionRow ? "border-t-4 border-sky-200 bg-white" : firstGroupRow ? "bg-slate-50" : "bg-white"}>
                    <td className="sticky left-0 z-[5] min-w-44 bg-inherit px-3 py-2 font-semibold">{firstSubmissionRow ? row.engineer_name : ""}</td>
                    <td className="px-3 py-2">{firstSubmissionRow ? row.contractor_name : ""}</td>
                    <td className="sticky left-44 z-[5] min-w-44 bg-inherit px-3 py-2 font-semibold">{firstGroupRow ? row.group_name : ""}</td>
                    <td className="px-3 py-2 font-semibold">{row.labour_code || "-"}</td>
                    <td className="sticky left-[25rem] z-[5] min-w-48 bg-inherit px-3 py-2 font-semibold">{row.labour_name}</td>
                    <td className="px-3 py-2">{row.category || "-"}</td>
                    <td className="px-3 py-2">{formatTime(row.site_in_time)}</td>
                    <td className="px-3 py-2">{shiftBadge(row.first_half_present)}</td>
                    <td className="px-3 py-2">{shiftBadge(row.second_half_present)}</td>
                    <td className="px-3 py-2">{hours(row.overtime_minutes)}</td>
                    <td className="px-3 py-2">{hours(row.bonus_minutes)}</td>
                    <td className="px-3 py-2">{firstGroupRow ? labelFromCode(row.work_type || "") || "-" : ""}</td>
                    <td className="px-3 py-2">{firstGroupRow ? row.work_description || "-" : ""}</td>
                    <td className="px-3 py-2">{firstGroupRow ? quantityUnit(row) : ""}</td>
                    <td className="px-3 py-2">
                      {firstGroupRow ? <PhotoCell row={row} onOpen={openPhoto} /> : ""}
                    </td>
                    <td className="px-3 py-2">{firstGroupRow ? row.group_remarks || "-" : ""}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{firstSubmissionRow ? formatDateTime(row.submitted_at) : ""}</td>
                    <td className="px-3 py-2">{firstSubmissionRow ? <StatusBadge status={row.status} /> : ""}</td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={18} className="px-3 py-8 text-center text-slate-500">No Engineer Daily Labour submissions match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
  );
}

function StandardAttendanceTable({ rows }: { rows: any[] }) {
  return (
    <div className="overflow-auto rounded-lg border bg-white shadow-sm">
      <table className="min-w-[1500px] text-sm">
        <thead className="sticky top-0 z-10 bg-slate-100 text-left text-xs uppercase text-slate-500">
          <tr>{["Labour Code", "Labour Name", "Contractor", "Category / Trade", "Daily Rate", "Attendance Date", "Submitted By", "First Half", "Second Half", "OT Hours", "Bonus Hours", "Status"].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row, index) => {
            const previous = rows[index - 1];
            const firstPeriodRow = !previous || previous.submission_id !== row.submission_id;
            return (
              <tr key={row.id} className={firstPeriodRow ? "border-t-4 border-sky-200 bg-white" : "bg-white"}>
                <td className="sticky left-0 z-[5] min-w-32 bg-inherit px-3 py-2 font-semibold">{row.labour_code || "-"}</td>
                <td className="sticky left-32 z-[5] min-w-48 bg-inherit px-3 py-2 font-semibold">{row.labour_name || "-"}</td>
                <td className="px-3 py-2">{row.contractor_name || "-"}</td>
                <td className="px-3 py-2">{row.category || "-"}</td>
                <td className="px-3 py-2">{row.daily_rate_label || "-"}</td>
                <td className="px-3 py-2">{row.work_date || row.period_month || "-"}</td>
                <td className="px-3 py-2">{firstPeriodRow ? row.submitted_by_name || row.submitted_by_email || "-" : ""}</td>
                <td className="px-3 py-2">{shiftBadge(row.first_half_present)}</td>
                <td className="px-3 py-2">{shiftBadge(row.second_half_present)}</td>
                <td className="px-3 py-2">{hours(row.overtime_minutes)}</td>
                <td className="px-3 py-2">{hours(row.bonus_minutes)}</td>
                <td className="px-3 py-2">{firstPeriodRow ? <StatusBadge status={row.status} /> : ""}</td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={12} className="px-3 py-8 text-center text-slate-500">No submitted Standard Attendance registers match these filters.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function RegisterDetailFilters({ filters, contractors, categories, onChange, onClear }: { filters: any; contractors: any[]; categories: string[]; onChange: (patch: any) => void; onClear: () => void }) {
  return (
    <div className="grid gap-3 rounded-lg border bg-white p-3 shadow-sm md:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_minmax(180px,1fr)_minmax(220px,1.2fr)_auto]">
      <FilterSelect label="Contractor" value={filters.contractor} onChange={(value) => onChange({ contractor: value })} options={contractors} empty="All Contractors" />
      <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
        Category / Trade
        <select value={filters.category} onChange={(event) => onChange({ category: event.target.value })} className="mt-1 h-9 w-full rounded-md border px-2 text-sm font-normal normal-case tracking-normal">
          <option value="">All Categories</option>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
      </label>
      <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
        Attendance Status
        <select value={filters.attendance_status} onChange={(event) => onChange({ attendance_status: event.target.value })} className="mt-1 h-9 w-full rounded-md border px-2 text-sm font-normal normal-case tracking-normal">
          <option value="">All Statuses</option>
          <option value="present">Present</option>
          <option value="absent">Absent</option>
          <option value="partial">Partial</option>
        </select>
      </label>
      <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
        Labour Name / Code
        <input value={filters.search} onChange={(event) => onChange({ search: event.target.value })} placeholder="Search labour" className="mt-1 h-9 w-full rounded-md border px-2 text-sm font-normal normal-case tracking-normal" />
      </label>
      <div className="flex items-end">
        <button type="button" onClick={onClear} className="h-9 w-full rounded-md border px-3 text-sm font-semibold">Clear Filters</button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status?: string | null }) {
  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${statusClass(status)}`}>{statusLabel(status)}</span>;
}

function ModeBanner({ attendanceSystem }: { attendanceSystem: "standard" | "site_in_engineer" }) {
  const standard = attendanceSystem === "standard";
  return (
    <div className="rounded-lg border bg-white p-3 shadow-sm">
      <p className="text-sm font-semibold text-slate-950">
        {standard ? "Standard Attendance Approval" : "Engineer Daily Labour Approval"}
      </p>
      <p className="mt-0.5 text-sm text-slate-600">
        {standard ? "Review submitted attendance registers for this site." : "Review engineer submissions, labour attendance, work and photos."}
      </p>
    </div>
  );
}

function Alert({ tone, children, onDismiss }: { tone: AlertTone; children: ReactNode; onDismiss: () => void }) {
  const classes = tone === "error"
    ? "border-red-200 bg-red-50 text-red-800"
    : tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : "border-blue-200 bg-blue-50 text-blue-800";
  return (
    <div className={`flex items-start justify-between gap-3 rounded-lg border p-3 text-sm font-semibold ${classes}`}>
      <span>{children}</span>
      <button type="button" onClick={onDismiss} className="rounded-full p-1 hover:bg-white/60" aria-label="Dismiss message">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, empty }: { label: string; value: string; onChange: (value: string) => void; options: any[]; empty: string }) {
  return (
    <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-9 w-full rounded-md border px-2 text-sm font-normal normal-case tracking-normal">
        <option value="">{empty}</option>
        {options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
  );
}

function Summary({ label, value, tone = "slate" }: { label: string; value: number; tone?: "slate" | "amber" }) {
  return <div className={`rounded-md border px-3 py-2 ${tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-800" : "bg-slate-50"}`}><span className="text-xs font-bold uppercase text-slate-500">{label}</span><span className="ml-2 text-base font-semibold">{value}</span></div>;
}

function PhotoCell({ row, onOpen }: { row: any; onOpen: (photo: any) => void }) {
  if (row.productive_photo_missing) return <span className="rounded bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">Photo Missing</span>;
  if (!row.photo_count) return <span className="text-slate-400">No Photos</span>;
  const first = row.photo_metadata?.[0];
  return (
    <button type="button" onClick={() => onOpen(first)} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-bold hover:bg-slate-50">
      <ImageIcon className="h-3 w-3" />
      {row.photo_count} Photo{row.photo_count === 1 ? "" : "s"}
    </button>
  );
}

export default function LabourApprovalsPage() {
  return <LabourApprovalsPageContent />;
}
