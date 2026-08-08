"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Save, Send } from "lucide-react";
import AlertMessage from "@/components/AlertMessage";
import HrSectionNav from "@/components/hr/HrSectionNav";
import { apiFetch, formatDate } from "@/components/hr/hrClient";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import { ATTENDANCE_STATUS_LABELS, EMPLOYEE_STANDARD_WORKING_HOURS, PHASE1_ATTENDANCE_STATUSES, currentIndiaDate, previousDate } from "@/lib/hr/attendance";

type RowState = {
  employee_id: string;
  status: string;
  company_id?: string;
};

export default function DailyAttendancePage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const canView = can(permissions, "hr_attendance", "view");
  const canEdit = can(permissions, "hr_attendance", "add") || can(permissions, "hr_attendance", "edit");
  const canSubmit = can(permissions, "hr_attendance", "submit");
  const isAdminRecovery = Boolean(access?.roleCodes.includes("platform_owner") || access?.roleCodes.includes("super_admin"));
  const today = currentIndiaDate();
  const [lookups, setLookups] = useState<{ companies: any[]; sites: any[]; error: string }>({ companies: [], sites: [], error: "" });
  const [companyId, setCompanyId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState<any[]>([]);
  const [period, setPeriod] = useState<any>(null);
  const [periods, setPeriods] = useState<any[]>([]);
  const [attendanceContexts, setAttendanceContexts] = useState<Record<string, any>>({});
  const [policy, setPolicy] = useState<any>(null);
  const [dayLock, setDayLock] = useState<any>(null);
  const [draft, setDraft] = useState<Record<string, RowState>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [unsavedAction, setUnsavedAction] = useState<null | (() => void)>(null);

  const visibleSites = lookups.sites;
  const visibleCompanies = useMemo(() => {
    const site = lookups.sites.find((item) => item.id === siteId);
    const allowed = new Set(site?.company_ids || []);
    return !allowed.size ? lookups.companies : lookups.companies.filter((item) => allowed.has(item.id));
  }, [lookups.companies, lookups.sites, siteId]);
  const isPast = date < today;
  const isFuture = date > today;
  const earliestNormalEditDate = previousDate(today);
  const isOlderThanYesterday = date < earliestNormalEditDate;
  const sentBack = period?.status === "reopened";
  const readOnlyReason = useMemo(() => {
    if (!canEdit) return "You do not have permission to edit attendance.";
    if (isFuture) return "Future attendance cannot be created or edited.";
    if (isOlderThanYesterday && !isAdminRecovery) return "Attendance can be edited only for today or yesterday.";
    return "";
  }, [canEdit, isAdminRecovery, isFuture, isOlderThanYesterday]);
  const editable = canEdit && !readOnlyReason;
  const visibleRows = useMemo(
    () => companyId ? rows.filter((item) => item.employee.company_id === companyId) : rows,
    [companyId, rows],
  );
  const rowEditable = (item: any) => {
    if (!canEdit || isFuture || (isOlderThanYesterday && !isAdminRecovery)) return false;
    const context = attendanceContexts[item.employee.company_id || ""];
    if (!context || context.dayLock) return false;
    return !["submitted", "level_1_approved", "level_2_approved", "finalized", "cancelled"].includes(context.period?.status);
  };
  const hasEditableRows = rows.some(rowEditable);

  useEffect(() => {
    let active = true;
    apiFetch("/api/hr/attendance/lookups")
      .then((payload) => {
        if (!active) return;
        setLookups({ companies: payload.companies || [], sites: payload.sites || [], error: "" });
      })
      .catch((error: any) => {
        if (!active) return;
        setLookups({ companies: [], sites: [], error: error.message || "Failed to load attendance lookups." });
      });
    return () => {
      active = false;
    };
  }, []);

  async function load(options: { skipDirtyGuard?: boolean } = {}) {
    if (!siteId || !date) {
      setMessage("Select site and date.");
      return;
    }
    if (!options.skipDirtyGuard && hasUnsavedChanges) {
      setUnsavedAction(() => () => load({ skipDirtyGuard: true }));
      return;
    }
    setLoading(true);
    setMessage("");
    setSuccess("");
    try {
      const selectedSite = lookups.sites.find((item) => item.id === siteId);
      const companyIds: string[] = (selectedSite?.company_ids || []).filter(Boolean) as string[];
      if (!companyIds.length) {
        setMessage("No permitted companies are available for the selected site.");
        return;
      }
      const results = await Promise.all(companyIds.map((id) => apiFetch(`/api/hr/attendance/daily?company_id=${id}&site_id=${siteId}&date=${date}`)));
      const merged = results.flatMap((result, index) => (result.attendance || []).map((item: any) => ({ ...item, employee: { ...item.employee, company_id: companyIds[index], company_name: lookups.companies.find((company) => company.id === companyIds[index])?.label || companyIds[index] } })));
      const nextContexts: Record<string, any> = {};
      results.forEach((result, index) => {
        nextContexts[companyIds[index]] = { period: result.period, policy: result.policy, dayLock: result.day_lock };
      });
      setRows(merged);
      setPeriods(results.map((result) => result.period).filter(Boolean));
      setAttendanceContexts(nextContexts);
      setPeriod(results[0]?.period || null);
      setPolicy(results[0]?.policy || null);
      setDayLock(null);
      const nextDraft: Record<string, RowState> = {};
      for (const item of merged) {
        nextDraft[item.employee.id] = {
          employee_id: item.employee.id,
          company_id: item.employee.company_id,
          status: item.attendance?.status || "present",
        };
      }
      setDraft(nextDraft);
      setHasUnsavedChanges(false);
    } catch (error: any) {
      setMessage(error.message || "Failed to load daily attendance.");
    } finally {
      setLoading(false);
    }
  }

  function updateRow(employeeId: string, patch: Partial<RowState>) {
    setDraft((prev) => ({
      ...prev,
      [employeeId]: { ...(prev[employeeId] || { employee_id: employeeId, status: "present" }), ...patch },
    }));
    setHasUnsavedChanges(true);
  }

  function markAllPresent() {
    const next = { ...draft };
    for (const item of visibleRows) {
      if (!rowEditable(item)) continue;
      next[item.employee.id] = { ...(next[item.employee.id] || { employee_id: item.employee.id }), status: "present" };
    }
    setDraft(next);
    setHasUnsavedChanges(true);
  }

  function updateAttendanceContext(update: () => void) {
    const action = () => {
      setRows([]);
      setPeriod(null);
      setPeriods([]);
      setAttendanceContexts({});
      setPolicy(null);
      setDayLock(null);
      setDraft({});
      setHasUnsavedChanges(false);
      update();
    };
    if (hasUnsavedChanges) {
      setUnsavedAction(() => action);
      return;
    }
    action();
  }

  async function saveDraftAndContinue() {
    if (!unsavedAction || saving) return;
    const saved = await save();
    if (!saved) return;
    const action = unsavedAction;
    setUnsavedAction(null);
    action();
  }

  function continueWithoutSaving() {
    if (!unsavedAction) return;
    const action = unsavedAction;
    setHasUnsavedChanges(false);
    setMessage("");
    setSuccess("");
    setUnsavedAction(null);
    action();
  }

  async function save(options: { silent?: boolean } = {}) {
    if (!rows.some(rowEditable)) return null;
    const requiresReason = isOlderThanYesterday && isAdminRecovery;
    const reason = requiresReason ? window.prompt("Enter reason for backdated attendance correction:") : "";
    if (requiresReason && !reason?.trim()) {
      setMessage("Backdated attendance reason is required.");
      return null;
    }
    setSaving(true);
    if (!options.silent) {
      setMessage("");
      setSuccess("");
    }
    try {
      const groups = new Map<string, RowState[]>();
      for (const row of Object.values(draft)) {
        const item = rows.find((entry) => entry.employee.id === row.employee_id);
        if (row.company_id && item && rowEditable(item)) groups.set(row.company_id, [...(groups.get(row.company_id) || []), row]);
      }
      const outcomes = await Promise.all(Array.from(groups.entries()).map(async ([groupCompanyId, attendance]) => {
        try {
          return { companyId: groupCompanyId, result: await apiFetch("/api/hr/attendance/daily", { method: "PUT", body: JSON.stringify({ company_id: groupCompanyId, site_id: siteId, date, attendance, backdated_reason: reason }) }) };
        } catch (error) {
          return { companyId: groupCompanyId, error };
        }
      }));
      const failures = outcomes.filter((outcome: any) => outcome.error);
      if (failures.length) {
        const labels = failures.map((failure: any) => lookups.companies.find((company) => company.id === failure.companyId)?.label || failure.companyId);
        throw new Error(`Attendance save failed for: ${labels.join(", ")}. Other company drafts may have been saved.`);
      }
      const results = outcomes.map((outcome: any) => outcome.result);
      if (!options.silent) setSuccess(`Draft saved for ${results.reduce((total, result) => total + Number(result.saved || 0), 0)} attendance rows.`);
      await load({ skipDirtyGuard: true });
      return { periods: results.map((result) => result.period).filter(Boolean) };
    } catch (error: any) {
      setMessage(error.message || "Failed to save attendance.");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function submitAttendance() {
    if (!rows.some(rowEditable) || !canSubmit) return;
    const saved = await save({ silent: true });
    if (!saved) return;
    const periodIds = (saved.periods || periods).map((item: any) => item.id).filter(Boolean);
    if (!periodIds.length) {
      setMessage("Attendance period could not be resolved for submission.");
      return;
    }
    setSaving(true);
    setMessage("");
    setSuccess("");
    try {
      const results = [];
      for (let index = 0; index < periodIds.length; index += 1) {
        try {
          results.push(await apiFetch(`/api/hr/attendance/periods/${periodIds[index]}/submit`, { method: "POST" }));
        } catch (error: any) {
          const submittedPeriod = (saved.periods || periods).find((item: any) => item.id === periodIds[index]);
          const label = lookups.companies.find((company) => company.id === submittedPeriod?.company_id)?.label || submittedPeriod?.company_id || "the selected company";
          throw new Error(`Attendance submission failed for ${label}: ${error.message || "request failed"}`);
        }
      }
      setPeriod(results[0]?.period || period || null);
      setSuccess(sentBack ? "Attendance resubmitted for approval." : "Attendance submitted for approval.");
      await load({ skipDirtyGuard: true });
    } catch (error: any) {
      setMessage(error.message || "Failed to submit attendance.");
    } finally {
      setSaving(false);
    }
  }

  if (!canView) {
    return <div className="rounded-2xl border bg-white p-8 text-sm text-slate-500 shadow-sm">Attendance is not available for your permissions.</div>;
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">Mark Attendance</h1>
          <p className="text-sm text-slate-500">Enter salaried staff attendance by company, site and date.</p>
        </div>
        <Link href="/hr/attendance" className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      </header>
      <HrSectionNav />
      <AlertMessage type="error" message={message || lookups.error} onClose={() => setMessage("")} />
      <AlertMessage type="success" message={success} onClose={() => setSuccess("")} />

      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-4">
          <Select label="Site *" value={siteId} disabled={loading || saving} onChange={(value) => updateAttendanceContext(() => { setSiteId(value); setCompanyId(""); })} options={visibleSites} />
          <Select label="Company" value={companyId} disabled={loading || saving} onChange={setCompanyId} options={visibleCompanies} allLabel="All Companies" />
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Date</span>
            <input type="date" value={date} min={isAdminRecovery ? undefined : earliestNormalEditDate} max={today} disabled={loading || saving} onChange={(event) => updateAttendanceContext(() => setDate(event.target.value))} className="h-10 w-full rounded-xl border px-3 text-sm disabled:bg-slate-100" />
          </label>
          <div className="flex items-end gap-2">
            <button type="button" onClick={() => load()} disabled={loading || saving} className="h-10 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60">
              {loading ? "Loading..." : "Load Attendance"}
            </button>
          </div>
        </div>
      </section>

      {period && (
        <div className="grid gap-3 md:grid-cols-5">
          <Summary label="Employees" value={visibleRows.length} />
          <Summary label="Period" value={sentBack ? "Sent Back" : period.status || "draft"} />
          <Summary label="Date" value={formatDate(date)} />
          <Summary label="Working Day" value={`${policy?.standard_working_hours || EMPLOYEE_STANDARD_WORKING_HOURS} hrs`} />
          <Summary label="Lock" value={dayLock ? "Locked" : "Open"} />
        </div>
      )}

      {sentBack && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm">
          <p className="text-base font-bold">Attendance Sent Back</p>
          <div className="mt-2 grid gap-1 md:grid-cols-2">
            <p><span className="font-semibold">Reason:</span> {period.send_back_reason || "No reason recorded."}</p>
            <p><span className="font-semibold">Sent Back By:</span> {period.reopened_by_name || period.reopened_by_email || "-"}</p>
            <p><span className="font-semibold">Sent Back At:</span> {period.reopened_at ? new Date(period.reopened_at).toLocaleString("en-IN") : "-"}</p>
            <p><span className="font-semibold">Previously Submitted:</span> {period.submitted_at ? new Date(period.submitted_at).toLocaleString("en-IN") : "-"}</p>
          </div>
          <p className="mt-2 font-semibold">Correct the attendance and resubmit it for approval.</p>
        </section>
      )}

      {period && (period.submitted_at || period.send_back_reason) && (
        <section className="rounded-2xl border bg-white p-4 text-sm text-slate-600 shadow-sm">
          <p className="font-bold text-slate-950">Attendance Activity</p>
          <div className="mt-2 grid gap-1 md:grid-cols-2">
            {period.submitted_at && <p><span className="font-semibold text-slate-800">{sentBack ? "Previously Submitted:" : "Submitted:"}</span> {period.submitted_by_name || period.submitted_by_email || "-"} · {new Date(period.submitted_at).toLocaleString("en-IN")}</p>}
            {period.send_back_reason && <p><span className="font-semibold text-slate-800">Latest Send Back:</span> {period.send_back_reason}</p>}
          </div>
        </section>
      )}

      {readOnlyReason && rows.length > 0 && <AlertMessage type="warning" message={readOnlyReason} />}

      <section className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div>
            <h2 className="font-semibold text-slate-950">Mark Attendance</h2>
            <p className="text-sm text-slate-500">Employees without saved attendance appear as Present until saved.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {hasEditableRows && <button type="button" onClick={markAllPresent} className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50">Mark All Present</button>}
            {hasEditableRows && <button type="button" onClick={() => save()} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"><Save className="h-4 w-4" />{saving ? "Saving..." : "Save Draft"}</button>}
            {hasEditableRows && canSubmit && <button type="button" onClick={submitAttendance} disabled={saving || rows.length === 0} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"><Send className="h-4 w-4" />{sentBack ? "Resubmit Attendance" : "Submit Attendance"}</button>}
          </div>
        </div>
        <table className="min-w-[760px] w-full text-left text-sm">
          <thead className="border-b bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">S. No.</th>
              <th className="px-3 py-3">Employee</th>
              <th className="px-3 py-3">Company</th>
              <th className="px-3 py-3">Department</th>
              <th className="px-3 py-3">Designation</th>
              <th className="px-3 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visibleRows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No employees loaded.</td></tr>
            ) : visibleRows.map((item, index) => {
              const current = draft[item.employee.id] || { employee_id: item.employee.id, status: "present", company_id: item.employee.company_id };
              return (
                <tr key={item.employee.id}>
                  <td className="px-4 py-3 text-slate-500">{index + 1}</td>
                  <td className="px-3 py-3 font-medium text-slate-950">{item.employee.employee_name}</td>
                  <td className="px-3 py-3 text-slate-600">{item.employee.company_name || "-"}</td>
                  <td className="px-3 py-3 text-slate-600">{item.employee.department_name || "-"}</td>
                  <td className="px-3 py-3 text-slate-600">{item.employee.designation_name || "-"}</td>
                  <td className="px-3 py-3">
                    <select disabled={!rowEditable(item)} value={current.status} onChange={(event) => updateRow(item.employee.id, { status: event.target.value })} className="h-9 rounded-xl border px-3 text-sm disabled:bg-slate-50">
                      {PHASE1_ATTENDANCE_STATUSES.map((status) => <option key={status} value={status}>{ATTENDANCE_STATUS_LABELS[status]}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

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
    </section>
  );
}

function Select({ label, value, onChange, options, disabled, allLabel }: { label: string; value: string; onChange: (value: string) => void; options: { id: string; label: string }[]; disabled?: boolean; allLabel?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-xl border px-3 text-sm disabled:bg-slate-100">
        <option value="">{allLabel || `Select ${label}`}</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  );
}

function Summary({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-2xl border bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-xl font-bold text-slate-950">{value}</p></div>;
}
