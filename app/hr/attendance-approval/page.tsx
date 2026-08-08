"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import AlertMessage from "@/components/AlertMessage";
import { useAccessContext } from "@/components/AccessContext";
import HrSectionNav from "@/components/hr/HrSectionNav";
import { useNotificationCounts } from "@/components/NotificationCountsContext";
import { apiFetch, formatDate } from "@/components/hr/hrClient";
import { ATTENDANCE_STATUS_CODES, ATTENDANCE_STATUS_LABELS, ATTENDANCE_STATUSES, currentIndiaDate } from "@/lib/hr/attendance";

const attendancePeriodStatusOptions = [
  ["pending", "Pending Approval"],
  ["approved", "Approved"],
  ["sent_back", "Sent Back"],
  ["all", "All"],
];

function employeeEligibleForDate(employee: any, date: string) {
  if (!date) return true;
  if (employee?.date_of_joining && employee.date_of_joining > date) return false;
  if (employee?.date_of_exit && employee.date_of_exit < date) return false;
  return String(employee?.status || "").toLowerCase() !== "deleted";
}

function dailySummaryForRows(rows: any[], selectedDate: string) {
  const eligibleRows = rows.filter((row: any) => employeeEligibleForDate(row.employee, selectedDate));
  const statusFor = (row: any) => {
    const index = (row.filtered_dates || []).indexOf(selectedDate);
    return index >= 0 ? row.filtered_days?.[index]?.status || null : null;
  };
  const present = eligibleRows.filter((row: any) => ["present", "work_from_home", "on_duty"].includes(statusFor(row))).length;
  const absent = eligibleRows.filter((row: any) => statusFor(row) === "absent").length;
  const halfDay = eligibleRows.filter((row: any) => statusFor(row) === "half_day").length;
  const leave = eligibleRows.filter((row: any) => statusFor(row) === "paid_leave" || statusFor(row) === "unpaid_leave").length;
  return {
    total: eligibleRows.length,
    present,
    absent,
    halfDay,
    leave,
    pending: eligibleRows.filter((row: any) => !statusFor(row)).length,
  };
}

export default function EmployeeAttendanceApprovalPage() {
  const notifications = useNotificationCounts();
  const { access } = useAccessContext();
  const isPlatformOwner = Boolean(access?.roleCodes.includes("platform_owner"));
  const [rows, setRows] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<any>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [designationFilter, setDesignationFilter] = useState("");
  const [periodStatusFilter, setPeriodStatusFilter] = useState("pending");
  const [statusFilter, setStatusFilter] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [sendBackIds, setSendBackIds] = useState<string[]>([]);
  const [sendBackReason, setSendBackReason] = useState("");
  const [approveOpen, setApproveOpen] = useState(false);

  const selectedRow = useMemo(() => rows.find((row) => row.id === selectedId) || null, [rows, selectedId]);
  const monthEnded = detail?.dates?.length ? detail.dates[detail.dates.length - 1] < currentIndiaDate() : false;
  const finalApproveBlocked = detail?.periods?.some((period: any) => period.status !== "finalized") && !monthEnded;
  const filteredRows = useMemo(() => {
    if (!detail?.rows) return [];
    const start = fromDate || detail.dates?.[0] || "";
    const end = toDate || detail.dates?.[detail.dates.length - 1] || "";
    return detail.rows
      .filter((row: any) => !companyFilter || row.company_id === companyFilter)
      .filter((row: any) => !employeeFilter || row.employee.id === employeeFilter)
      .filter((row: any) => !departmentFilter || row.employee.department_id === departmentFilter)
      .filter((row: any) => !designationFilter || row.employee.designation_id === designationFilter)
      .filter((row: any) => {
        const query = employeeSearch.trim().toLowerCase();
        if (!query) return true;
        return `${row.employee.employee_name || ""} ${row.employee.employee_code || ""}`.toLowerCase().includes(query);
      })
      .map((row: any) => {
        const days = row.days.map((day: any, index: number) => {
          const date = detail.dates[index];
          if (start && date < start) return undefined;
          if (end && date > end) return undefined;
          if (statusFilter && day?.status !== statusFilter) return null;
          return day;
        }).filter((day: any) => day !== undefined);
        return { ...row, filtered_days: days, filtered_dates: detail.dates.filter((date: string) => (!start || date >= start) && (!end || date <= end)) };
      })
      .filter((row: any) => !statusFilter || row.filtered_days.some((day: any) => day?.status === statusFilter));
  }, [companyFilter, departmentFilter, designationFilter, detail, employeeFilter, employeeSearch, fromDate, statusFilter, toDate]);

  async function loadQueue(preferredId = selectedId, nextPeriodStatus = periodStatusFilter) {
    setLoading(true);
    setMessage("");
    try {
      const payload = await apiFetch(`/api/hr/attendance/approval-groups?period_status=${encodeURIComponent(nextPeriodStatus)}`);
      const nextRows = payload.groups || [];
      setRows(nextRows);
      const nextSelected = nextRows.some((row: any) => row.id === preferredId) ? preferredId : nextRows[0]?.id || "";
      setSelectedId(nextSelected);
      if (!nextSelected) setDetail(null);
      return nextSelected;
    } catch (error: any) {
      setRows([]);
      setDetail(null);
      setMessage(safeError(error.message, "Failed to load attendance approval queue."));
      return "";
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id: string) {
    if (!id) return;
    const group = rows.find((row) => row.id === id);
    if (!group) return;
    setDetailLoading(true);
    setMessage("");
    try {
      const payload = await apiFetch(`/api/hr/attendance/approval-groups?site_id=${encodeURIComponent(group.site_id)}&period_month=${encodeURIComponent(group.period_month)}`);
      setDetail(payload);
      setFromDate(payload.dates?.[0] || "");
      setToDate(payload.dates?.[payload.dates.length - 1] || "");
      setEmployeeFilter("");
      setCompanyFilter("");
      setDepartmentFilter("");
      setDesignationFilter("");
      setStatusFilter("");
      setEmployeeSearch("");
      setShowHistory(false);
    } catch (error: any) {
      setDetail(null);
      setMessage(safeError(error.message, "Failed to load attendance approval detail."));
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    loadQueue("", periodStatusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodStatusFilter]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function approvalAction(action: "finalize" | "send-back") {
    if (!selectedId) return;
    if (action === "finalize" && finalApproveBlocked) return;
    const reason = action === "send-back" ? sendBackReason.trim() : "";
    if (action === "send-back" && reason.length < 10) {
      setMessage("Enter a send-back reason of at least 10 characters.");
      return;
    }
    setActionLoading(true);
    setMessage("");
    setSuccess("");
    try {
      const endpoint = action === "send-back" ? "/api/hr/attendance/approval-groups/send-back" : "/api/hr/attendance/approval-groups/approve";
      const eligibleIds = (selectedRow?.periods || []).filter((period: any) => action === "finalize" ? period.can_approve : period.can_send_back).map((period: any) => period.period_id);
      const result = await apiFetch(endpoint, { method: "POST", body: JSON.stringify({ period_ids: eligibleIds, reason }) });
      const failures = (result.results || []).filter((item: any) => !item.success);
      setSuccess(failures.length ? `Completed with ${failures.length} company-period failure(s).` : action === "send-back" ? "Attendance periods sent back." : "Attendance periods approved.");
      if (action === "send-back") notifications.refresh();
      const nextSelected = await loadQueue(selectedId);
      if (nextSelected) await loadDetail(nextSelected);
    } catch (error: any) {
      setMessage(safeError(error.message, "Failed to update attendance approval."));
    } finally {
      setActionLoading(false);
    }
  }

  function openSendBackModal() {
    setSendBackIds((selectedRow?.periods || []).filter((period: any) => period.can_send_back).map((period: any) => period.period_id));
    setSendBackReason("");
    setSendBackOpen(true);
  }

  function openApproveModal() {
    if (!selectedId || finalApproveBlocked) return;
    setApproveOpen(true);
  }

  async function deleteAttendancePeriod() {
    if (!selectedId) return;
    if (!window.confirm("Delete this attendance permanently?\n\nThis action cannot be undone.")) return;
    const reason = window.prompt("Enter deletion reason of at least 10 characters:")?.trim() || "";
    if (reason.length < 10) {
      setMessage("Deletion reason must be at least 10 characters.");
      return;
    }
    setActionLoading(true);
    setMessage("");
    setSuccess("");
    try {
      await apiFetch(`/api/hr/attendance/periods/${selectedId}`, { method: "DELETE", body: JSON.stringify({ reason }) });
      setSuccess("Attendance period deleted.");
      setSelectedId("");
      setDetail(null);
      await loadQueue("");
    } catch (error: any) {
      setMessage(safeError(error.message, "Failed to delete attendance period."));
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">Attendance Approval</h1>
          <p className="text-sm text-slate-500">Review submitted monthly employee attendance periods at your configured approval level.</p>
        </div>
      </header>
      <HrSectionNav />
      <AlertMessage type="error" message={message} onClose={() => setMessage("")} />
      <AlertMessage type="success" message={success} onClose={() => setSuccess("")} />

      <section className="rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div>
            <h2 className="font-semibold text-slate-950">Attendance Period Queue</h2>
            <p className="text-sm text-slate-500">Browse attendance periods by approval workflow state.</p>
          </div>
          <label className="min-w-[220px] text-xs font-semibold uppercase tracking-wide text-slate-500">
            Attendance Period Status
            <select value={periodStatusFilter} onChange={(event) => setPeriodStatusFilter(event.target.value)} className="mt-1 h-10 w-full rounded-xl border px-3 text-sm font-normal normal-case tracking-normal">
              {attendancePeriodStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        {loading ? <p className="p-4 text-sm text-slate-500">Loading approval queue...</p> : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            <p className="font-semibold text-slate-700">No attendance periods match this approval status.</p>
            <p className="mt-1">Change Attendance Period Status to browse another workflow state.</p>
          </div>
        ) : <MonthlyQueue rows={rows} selectedId={selectedId} onSelect={setSelectedId} />}
      </section>

      {selectedRow && (
        <section className="space-y-4">
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Attendance Period</p>
                <h2 className="mt-1 text-xl font-bold text-slate-950">{selectedRow.site_name} · {selectedRow.period_label}</h2>
                <p className="mt-1 text-sm text-slate-500">{selectedRow.total_employee_count} Employees · {selectedRow.company_count} Companies · {selectedRow.status_label}</p>
                <div className="mt-2 space-y-0.5 text-xs text-slate-500">
                  {(selectedRow.periods || []).map((period: any) => <p key={period.period_id}>{period.company_name} · {period.employee_count} employees</p>)}
                </div>
              </div>
              <div className="max-w-md text-sm text-slate-500">
                Filters only affect the displayed records. Approval applies to the complete attendance period.
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={actionLoading || detailLoading} onClick={openSendBackModal} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60">
                  <RotateCcw className="h-4 w-4" />
                  Send Back
                </button>
                <button type="button" title={finalApproveBlocked ? "Final approval becomes available after the attendance period ends." : "Approve attendance period"} disabled={actionLoading || detailLoading || finalApproveBlocked} onClick={openApproveModal} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white outline-none transition focus:ring-2 focus:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-60">
                  <CheckCircle2 className="h-4 w-4" />
                  Approve
                </button>
              </div>
            </div>
            {finalApproveBlocked && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                {selectedRow.period_label} attendance is still in progress. Final approval will be available after month-end.
              </p>
            )}
          </div>
          {detailLoading || !detail ? <p className="rounded-2xl border bg-white p-4 text-sm text-slate-500 shadow-sm">Loading approval details...</p> : (
            <MonthlyDetail
              detail={detail}
              rows={filteredRows}
              fromDate={fromDate}
              toDate={toDate}
              employeeFilter={employeeFilter}
              companyFilter={companyFilter}
              departmentFilter={departmentFilter}
              designationFilter={designationFilter}
              statusFilter={statusFilter}
              employeeSearch={employeeSearch}
              showHistory={showHistory}
              onFromDate={setFromDate}
              onToDate={setToDate}
              onEmployee={setEmployeeFilter}
              onCompany={setCompanyFilter}
              onDepartment={setDepartmentFilter}
              onDesignation={setDesignationFilter}
              onStatus={setStatusFilter}
              onEmployeeSearch={setEmployeeSearch}
              onClearFilters={() => {
                setFromDate(detail.dates?.[0] || "");
                setToDate(detail.dates?.[detail.dates.length - 1] || "");
                setEmployeeFilter("");
                setCompanyFilter("");
                setDepartmentFilter("");
                setDesignationFilter("");
                setStatusFilter("");
                setEmployeeSearch("");
              }}
              onToggleHistory={() => setShowHistory((current) => !current)}
            />
          )}
        </section>
      )}
      {approveOpen && selectedRow && detail && <ApproveDialog group={selectedRow} detail={detail} onCancel={() => setApproveOpen(false)} onConfirm={() => { setApproveOpen(false); void approvalAction("finalize"); }} saving={actionLoading} />}
      {sendBackOpen && selectedRow && <SendBackDialog periods={selectedRow.periods || []} selectedIds={sendBackIds} reason={sendBackReason} onToggle={(id: string) => setSendBackIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} onReason={setSendBackReason} onCancel={() => setSendBackOpen(false)} onConfirm={() => { setSendBackOpen(false); void approvalAction("send-back"); }} saving={actionLoading} />}
    </section>
  );
}

function SendBackDialog({ periods, selectedIds, reason, onToggle, onReason, onCancel, onConfirm, saving }: any) {
  const eligible = periods.filter((period: any) => period.can_send_back);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-label="Send Back Attendance"><div className="w-full max-w-lg rounded-2xl bg-white shadow-xl"><div className="border-b px-6 py-5"><h2 className="text-xl font-bold text-slate-950">Send Back Attendance</h2><p className="mt-1 text-sm text-slate-500">Select the company periods that need correction.</p></div><div className="space-y-3 px-6 py-5">{eligible.map((period: any) => <label key={period.period_id} className="flex items-start gap-3 rounded-xl border p-3 text-sm"><input type="checkbox" checked={selectedIds.includes(period.period_id)} onChange={() => onToggle(period.period_id)} className="mt-1" /><span><span className="font-semibold text-slate-950">{period.company_name}</span><span className="block text-slate-500">{period.status_label}</span></span></label>)}<label className="block text-sm font-semibold text-slate-700"><span>Reason *</span><textarea value={reason} onChange={(event) => onReason(event.target.value)} rows={3} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label></div><div className="flex justify-end gap-3 border-t bg-slate-50 px-6 py-4"><button type="button" onClick={onCancel} disabled={saving} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Cancel</button><button type="button" onClick={onConfirm} disabled={saving || !selectedIds.length || reason.trim().length < 10} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Sending..." : "Send Back"}</button></div></div></div>;
}

function ApproveDialog({ group, detail, onCancel, onConfirm, saving }: any) {
  const datesWithAttendance = (detail.dates || []).filter((date: string, index: number) => (detail.rows || []).some((row: any) => Boolean(row.days?.[index])));
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-label="Approve Attendance"><div className="w-full max-w-lg rounded-2xl bg-white shadow-xl"><div className="border-b px-6 py-5"><h2 className="text-xl font-bold text-slate-950">Approve Attendance</h2><p className="mt-1 text-sm text-slate-500">Review this grouped attendance submission before approval.</p></div><div className="space-y-3 px-6 py-5 text-sm"><div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3"><div><p className="text-xs uppercase tracking-wide text-slate-500">Site</p><p className="font-semibold text-slate-950">{group.site_name}</p></div><div><p className="text-xs uppercase tracking-wide text-slate-500">Month</p><p className="font-semibold text-slate-950">{group.period_label}</p></div><div><p className="text-xs uppercase tracking-wide text-slate-500">Employees</p><p className="font-semibold text-slate-950">{group.total_employee_count}</p></div><div><p className="text-xs uppercase tracking-wide text-slate-500">Companies</p><p className="font-semibold text-slate-950">{group.company_count}</p></div></div><div><p className="font-semibold text-slate-700">Company periods</p><div className="mt-1 space-y-1 text-slate-600">{(group.periods || []).map((period: any) => <p key={period.period_id}>{period.company_name} · {period.employee_count} employees</p>)}</div></div><div><p className="font-semibold text-slate-700">Dates with attendance</p><p className="mt-1 text-slate-600">{datesWithAttendance.length ? datesWithAttendance.map((date: string) => formatDate(date)).join(", ") : "No attendance dates recorded."}</p></div></div><div className="flex justify-end gap-3 border-t bg-slate-50 px-6 py-4"><button type="button" onClick={onCancel} disabled={saving} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Cancel</button><button type="button" onClick={onConfirm} disabled={saving} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Approving..." : "Approve"}</button></div></div></div>;
}

function MonthlyQueue({ rows, selectedId, onSelect }: { rows: any[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr><th className="px-4 py-3">Month</th><th className="px-4 py-3">Site</th><th className="px-4 py-3 text-center">Employees</th><th className="px-4 py-3 text-center">Companies</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Action</th></tr>
        </thead>
        <tbody className="divide-y">{rows.map((row) => <tr key={row.id} className={row.id === selectedId ? "bg-slate-50" : ""}><td className="px-4 py-3 font-semibold text-slate-950">{row.period_label}</td><td className="px-4 py-3">{row.site_name}</td><td className="px-4 py-3 text-center font-semibold">{row.total_employee_count ?? "-"}</td><td className="px-4 py-3 text-center">{row.company_count ?? "-"}</td><td className="px-4 py-3">{row.status_label}</td><td className="px-4 py-3 text-right"><button type="button" onClick={() => onSelect(row.id)} className="rounded-xl border px-3 py-2 text-xs font-semibold outline-none hover:bg-white focus:ring-2 focus:ring-slate-400">Review</button></td></tr>)}</tbody>
      </table>
    </div>
  );
}

function MonthlyDetail({ detail, rows, fromDate, toDate, employeeFilter, companyFilter, departmentFilter, designationFilter, statusFilter, employeeSearch, showHistory, onFromDate, onToDate, onEmployee, onCompany, onDepartment, onDesignation, onStatus, onEmployeeSearch, onClearFilters, onToggleHistory }: any) {
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const minDate = detail.dates?.[0] || "";
  const maxDate = detail.dates?.[detail.dates.length - 1] || "";
  const displayDates = detail.dates.filter((date: string) => (!fromDate || date >= fromDate) && (!toDate || date <= toDate));
  const selectedDate = fromDate && toDate && fromDate === toDate ? fromDate : "";
  const dailySummary = selectedDate ? dailySummaryForRows(rows, selectedDate) : null;
  const departments = Array.from(
    new Map<string, { id: string; label: string }>(
      (detail.employees || [])
        .filter((employee: any) => employee.department_id)
        .map((employee: any) => [employee.department_id, { id: employee.department_id, label: employee.department_name || "Department" }]),
    ).values(),
  );
  const designations = Array.from(
    new Map<string, { id: string; label: string }>(
      (detail.employees || [])
        .filter((employee: any) => employee.designation_id)
        .map((employee: any) => [employee.designation_id, { id: employee.designation_id, label: employee.designation_name || "Designation" }]),
    ).values(),
  );
  return (
    <>
      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold text-slate-950">Review Filters</h3>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setShowMoreFilters((current) => !current)} className="rounded-xl border px-3 py-2 text-xs font-semibold outline-none hover:bg-slate-50 focus:ring-2 focus:ring-slate-400">{showMoreFilters ? "Hide Filters" : "More Filters"}</button><button type="button" onClick={onClearFilters} className="rounded-xl border px-3 py-2 text-xs font-semibold outline-none hover:bg-slate-50 focus:ring-2 focus:ring-slate-400">Clear Filters</button></div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
          <DateInput label="From Date" value={fromDate} min={minDate} max={maxDate} onChange={onFromDate} />
          <DateInput label="To Date" value={toDate} min={minDate} max={maxDate} onChange={onToDate} />
          <Select label="Company" value={companyFilter} onChange={onCompany} options={(detail.periods || []).map((period: any) => ({ id: period.company_id, label: period.company_name }))} emptyLabel="All Companies" />
          <Select label="Employee" value={employeeFilter} onChange={onEmployee} options={(detail.employees || []).map((employee: any) => ({ id: employee.id, label: `${employee.employee_code || "-"} · ${employee.employee_name}` }))} />
          <label className="block xl:col-span-2">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Search Employee</span>
            <input value={employeeSearch} onChange={(event) => onEmployeeSearch(event.target.value)} placeholder="Search by name or code" className="h-10 w-full rounded-xl border px-3 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
          </label>
        </div>
        {showMoreFilters && <div className="mt-3 grid gap-3 md:grid-cols-3"><Select label="Department" value={departmentFilter} onChange={onDepartment} options={departments} /><Select label="Designation" value={designationFilter} onChange={onDesignation} options={designations} /><Select label="Employee Attendance Status" value={statusFilter} onChange={onStatus} options={ATTENDANCE_STATUSES.map((status) => ({ id: status, label: ATTENDANCE_STATUS_LABELS[status] }))} emptyLabel="All Attendance Status" /></div>}
      </section>
      <section className="max-h-[70vh] overflow-auto rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b p-3 text-xs text-slate-600">
          {ATTENDANCE_STATUSES.map((status) => (
            <span key={status} title={`${ATTENDANCE_STATUS_CODES[status]} = ${ATTENDANCE_STATUS_LABELS[status]}`} className="rounded-full border bg-slate-50 px-2.5 py-1 font-semibold">
              {ATTENDANCE_STATUS_CODES[status]} = {ATTENDANCE_STATUS_LABELS[status]}
            </span>
          ))}
        </div>
        <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-xs">
          <thead className="sticky top-0 z-20 border-b bg-slate-50 uppercase tracking-wide text-slate-500">
            <tr><th className="sticky left-0 z-30 min-w-[220px] border-b bg-slate-50 px-3 py-3">Employee Name / Code</th>{displayDates.map((date: string) => { const hasAttendance = detail.rows?.some((row: any) => Boolean(row.days?.[detail.dates.indexOf(date)])); return <th key={date} title={hasAttendance ? "Attendance records exist" : undefined} className={`border-b px-2 py-3 text-center ${hasAttendance ? "bg-sky-50 text-sky-800" : ""}`}>{date.slice(-2)}</th>; })}</tr>
          </thead>
          <tbody>{rows.length === 0 ? <tr><td colSpan={displayDates.length + 1} className="px-4 py-10 text-center text-sm text-slate-500">No employees match the selected filters.</td></tr> : rows.map((row: any) => <tr key={row.employee.id} className="border-b"><td className="sticky left-0 z-10 min-w-[220px] border-b bg-white px-3 py-3"><p className="font-semibold text-slate-950">{row.employee.employee_name}</p><p className="text-slate-500">{row.employee.employee_code}</p></td>{displayDates.map((date: string) => { const day = row.days?.[detail.dates.indexOf(date)]; return <td key={`${row.employee.id}-${date}`} className={`border-b px-2 py-3 text-center ${day ? "bg-sky-50/50" : ""}`}>{day ? ATTENDANCE_STATUS_CODES[day.status as keyof typeof ATTENDANCE_STATUS_CODES] : "-"}</td>; })}</tr>)}</tbody>
        </table>
      </section>
      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <button type="button" onClick={onToggleHistory} className="rounded-xl border px-4 py-2 text-sm font-semibold outline-none hover:bg-slate-50 focus:ring-2 focus:ring-slate-400">
          {showHistory ? "Hide Approval History" : "View Approval History"}
        </button>
        {showHistory && <History events={detail.history || []} />}
      </section>
    </>
  );
}

function History({ events }: { events: any[] }) {
  return <section className="rounded-2xl border bg-white p-4 shadow-sm"><h3 className="font-semibold text-slate-950">Approval History</h3><div className="mt-3 divide-y rounded-xl border">{events.length === 0 ? <p className="p-3 text-sm text-slate-500">No approval history recorded yet.</p> : events.map((event) => <div key={event.id} className="p-3 text-sm"><p className="font-semibold text-slate-950">{event.description || event.action}</p><p className="text-slate-500">{event.created_by_name || event.created_by_email || "System"} · {event.created_at ? formatDate(event.created_at) : "-"}</p></div>)}</div></section>;
}

function Select({ label, value, onChange, options, emptyLabel }: { label: string; value: string; onChange: (value: string) => void; options: { id: string; label: string }[]; emptyLabel?: string }) {
  return <label className="block"><span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-xl border px-3 text-sm"><option value="">{emptyLabel || `All ${label}`}</option>{options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>;
}

function DateInput({ label, value, min, max, onChange }: { label: string; value: string; min: string; max: string; onChange: (value: string) => void }) {
  return <label className="block"><span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span><input type="date" value={value} min={min} max={max} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-xl border px-3 text-sm" /></label>;
}

function Summary({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-2xl border bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-lg font-bold text-slate-950">{value}</p></div>;
}

function safeError(message: string | undefined, fallback: string) {
  const text = String(message || "").trim();
  if (!text) return fallback;
  if (/column .* does not exist|schema cache|PostgREST|PGRST|SQLSTATE|relation .* does not exist/i.test(text)) return fallback;
  return text;
}
