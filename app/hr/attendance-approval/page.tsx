"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, RotateCcw, Trash2 } from "lucide-react";
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

  const selectedRow = useMemo(() => rows.find((row) => row.id === selectedId) || null, [rows, selectedId]);
  const monthEnded = detail?.dates?.length ? detail.dates[detail.dates.length - 1] < currentIndiaDate() : false;
  const finalApproveBlocked = detail?.period?.status && !monthEnded;
  const filteredRows = useMemo(() => {
    if (!detail?.rows) return [];
    const start = fromDate || detail.dates?.[0] || "";
    const end = toDate || detail.dates?.[detail.dates.length - 1] || "";
    return detail.rows
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
  }, [departmentFilter, designationFilter, detail, employeeFilter, employeeSearch, fromDate, statusFilter, toDate]);

  async function loadQueue(preferredId = selectedId, nextPeriodStatus = periodStatusFilter) {
    setLoading(true);
    setMessage("");
    try {
      const payload = await apiFetch(`/api/hr/attendance/approvals?period_status=${encodeURIComponent(nextPeriodStatus)}`);
      const nextRows = payload.rows || [];
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
    setDetailLoading(true);
    setMessage("");
    try {
      const payload = await apiFetch(`/api/hr/attendance/approvals?period_id=${id}`);
      setDetail(payload);
      setFromDate(payload.dates?.[0] || "");
      setToDate(payload.dates?.[payload.dates.length - 1] || "");
      setEmployeeFilter("");
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
    const reason = action === "send-back" ? window.prompt("Enter send-back reason of at least 10 characters:")?.trim() || "" : "";
    if (action === "send-back" && reason.length < 10) {
      setMessage("Enter a send-back reason of at least 10 characters.");
      return;
    }
    setActionLoading(true);
    setMessage("");
    setSuccess("");
    try {
      await apiFetch(`/api/hr/attendance/periods/${selectedId}/${action}`, { method: "POST", body: JSON.stringify({ reason }) });
      setSuccess(action === "send-back" ? "Attendance period sent back." : "Attendance period approved.");
      if (action === "send-back") notifications.refresh();
      const nextSelected = await loadQueue(selectedId);
      if (nextSelected) await loadDetail(nextSelected);
    } catch (error: any) {
      setMessage(safeError(error.message, "Failed to update attendance approval."));
    } finally {
      setActionLoading(false);
    }
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
        <Link href="/hr/attendance/monthly" className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" />
          Attendance Register
        </Link>
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
                <p className="mt-1 text-sm text-slate-500">Company: {selectedRow.company_name}</p>
                <p className="text-sm text-slate-500">Approval Status: {selectedRow.status_label}</p>
              </div>
              <div className="max-w-md text-sm text-slate-500">
                Filters only affect the displayed records. Approval applies to the complete attendance period.
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={actionLoading || detailLoading} onClick={() => approvalAction("send-back")} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60">
                  <RotateCcw className="h-4 w-4" />
                  Send Back
                </button>
                <button type="button" title={finalApproveBlocked ? "Final approval becomes available after the attendance period ends." : "Approve attendance period"} disabled={actionLoading || detailLoading || finalApproveBlocked} onClick={() => approvalAction("finalize")} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white outline-none transition focus:ring-2 focus:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-60">
                  <CheckCircle2 className="h-4 w-4" />
                  Approve
                </button>
                {isPlatformOwner && (
                  <button type="button" disabled={actionLoading || detailLoading} onClick={deleteAttendancePeriod} className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60">
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                )}
              </div>
            </div>
            {finalApproveBlocked && (
              <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-800">
                This attendance period is still in progress. You may review all attendance records now. Final approval will become available after the attendance period ends.
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
              departmentFilter={departmentFilter}
              designationFilter={designationFilter}
              statusFilter={statusFilter}
              employeeSearch={employeeSearch}
              showHistory={showHistory}
              onFromDate={setFromDate}
              onToDate={setToDate}
              onEmployee={setEmployeeFilter}
              onDepartment={setDepartmentFilter}
              onDesignation={setDesignationFilter}
              onStatus={setStatusFilter}
              onEmployeeSearch={setEmployeeSearch}
              onClearFilters={() => {
                setFromDate(detail.dates?.[0] || "");
                setToDate(detail.dates?.[detail.dates.length - 1] || "");
                setEmployeeFilter("");
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
    </section>
  );
}

function MonthlyQueue({ rows, selectedId, onSelect }: { rows: any[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr><th className="px-4 py-3">Month</th><th className="px-4 py-3">Company</th><th className="px-4 py-3">Site</th><th className="px-4 py-3 text-center">Employees</th><th className="px-4 py-3">Current Level</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Action</th></tr>
        </thead>
        <tbody className="divide-y">{rows.map((row) => <tr key={row.id} className={row.id === selectedId ? "bg-slate-50" : ""}><td className="px-4 py-3 font-semibold text-slate-950">{row.period_label}</td><td className="px-4 py-3">{row.company_name}</td><td className="px-4 py-3">{row.site_name}</td><td className="px-4 py-3 text-center font-semibold">{row.employee_count ?? "-"}</td><td className="px-4 py-3">{row.current_level_label}</td><td className="px-4 py-3">{row.status_label}</td><td className="px-4 py-3 text-right"><button type="button" onClick={() => onSelect(row.id)} className="rounded-xl border px-3 py-2 text-xs font-semibold outline-none hover:bg-white focus:ring-2 focus:ring-slate-400">Review</button></td></tr>)}</tbody>
      </table>
    </div>
  );
}

function MonthlyDetail({ detail, rows, fromDate, toDate, employeeFilter, departmentFilter, designationFilter, statusFilter, employeeSearch, showHistory, onFromDate, onToDate, onEmployee, onDepartment, onDesignation, onStatus, onEmployeeSearch, onClearFilters, onToggleHistory }: any) {
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
      {dailySummary ? (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Summary label="Total Employees" value={dailySummary.total} />
          <Summary label="Present" value={dailySummary.present} />
          <Summary label="Absent" value={dailySummary.absent} />
          <Summary label="Half Day" value={dailySummary.halfDay} />
          <Summary label="Leave" value={dailySummary.leave} />
          <Summary label="Attendance Pending" value={dailySummary.pending} />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <Summary label="Approval Level" value={detail.current_level_label} />
          <Summary label="Lock After" value={`${detail.policy_snapshot?.lock_after_hours ?? 5} hours`} />
        </div>
      )}
      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold text-slate-950">Review Filters</h3>
          <button type="button" onClick={onClearFilters} className="rounded-xl border px-3 py-2 text-xs font-semibold outline-none hover:bg-slate-50 focus:ring-2 focus:ring-slate-400">Clear Filters</button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
          <DateInput label="From Date" value={fromDate} min={minDate} max={maxDate} onChange={onFromDate} />
          <DateInput label="To Date" value={toDate} min={minDate} max={maxDate} onChange={onToDate} />
          <Select label="Employee" value={employeeFilter} onChange={onEmployee} options={(detail.employees || []).map((employee: any) => ({ id: employee.id, label: `${employee.employee_code || "-"} · ${employee.employee_name}` }))} />
          <Select label="Department" value={departmentFilter} onChange={onDepartment} options={departments} />
          <Select label="Designation" value={designationFilter} onChange={onDesignation} options={designations} />
          <Select label="Employee Attendance Status" value={statusFilter} onChange={onStatus} options={ATTENDANCE_STATUSES.map((status) => ({ id: status, label: ATTENDANCE_STATUS_LABELS[status] }))} emptyLabel="All Attendance Status" />
          <label className="block xl:col-span-2">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Search Employee</span>
            <input value={employeeSearch} onChange={(event) => onEmployeeSearch(event.target.value)} placeholder="Search by name or code" className="h-10 w-full rounded-xl border px-3 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
          </label>
        </div>
      </section>
      <section className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b p-3 text-xs text-slate-600">
          {ATTENDANCE_STATUSES.map((status) => (
            <span key={status} title={`${ATTENDANCE_STATUS_CODES[status]} = ${ATTENDANCE_STATUS_LABELS[status]}`} className="rounded-full border bg-slate-50 px-2.5 py-1 font-semibold">
              {ATTENDANCE_STATUS_CODES[status]} = {ATTENDANCE_STATUS_LABELS[status]}
            </span>
          ))}
        </div>
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="border-b bg-slate-50 uppercase tracking-wide text-slate-500">
            <tr><th className="sticky left-0 z-10 min-w-[220px] bg-slate-50 px-3 py-3">Employee Name / Code</th>{displayDates.map((date: string) => <th key={date} className="px-2 py-3 text-center">{date.slice(-2)}</th>)}</tr>
          </thead>
          <tbody className="divide-y">{rows.length === 0 ? <tr><td colSpan={displayDates.length + 1} className="px-4 py-10 text-center text-sm text-slate-500">No employees match the selected filters.</td></tr> : rows.map((row: any) => <tr key={row.employee.id}><td className="sticky left-0 z-10 min-w-[220px] bg-white px-3 py-3"><p className="font-semibold text-slate-950">{row.employee.employee_name}</p><p className="text-slate-500">{row.employee.employee_code}</p></td>{displayDates.map((date: string, index: number) => { const day = row.filtered_days[index]; return <td key={`${row.employee.id}-${date}`} className="px-2 py-3 text-center">{day ? ATTENDANCE_STATUS_CODES[day.status as keyof typeof ATTENDANCE_STATUS_CODES] : "-"}</td>; })}</tr>)}</tbody>
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
