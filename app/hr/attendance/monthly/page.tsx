"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Trash2 } from "lucide-react";
import AlertMessage from "@/components/AlertMessage";
import HrSectionNav from "@/components/hr/HrSectionNav";
import { apiFetch, formatDate } from "@/components/hr/hrClient";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import { ATTENDANCE_STATUS_CODES, ATTENDANCE_STATUSES, EMPLOYEE_STANDARD_WORKING_HOURS, currentIndiaDate, monthStart } from "@/lib/hr/attendance";

export default function MonthlyAttendancePage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const canView = can(permissions, "hr_attendance", "view");
  const canApprove = can(permissions, "hr_attendance_approval", "approve");
  const canReject = can(permissions, "hr_attendance_approval", "reject");
  const canExport = can(permissions, "hr_attendance", "export");
  const isAdminRecovery = Boolean(access?.roleCodes.includes("platform_owner") || access?.roleCodes.includes("super_admin"));
  const isPlatformOwner = Boolean(access?.roleCodes.includes("platform_owner"));
  const [lookups, setLookups] = useState<{ companies: any[]; sites: any[]; error: string }>({ companies: [], sites: [], error: "" });
  const [companyId, setCompanyId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [month, setMonth] = useState(monthStart(currentIndiaDate())!.slice(0, 7));
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");
  const visibleSites = useMemo(
    () => companyId ? lookups.sites.filter((site) => site.scope_company_id === companyId) : lookups.sites,
    [companyId, lookups.sites],
  );
  const pendingApproval = result && ["submitted", "level_1_approved", "level_2_approved"].includes(result.period?.status);

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

  async function load() {
    if (!companyId || !siteId || !month) {
      setMessage("Select company, site and month.");
      return;
    }
    setLoading(true);
    setMessage("");
    setSuccess("");
    try {
      const data = await apiFetch(`/api/hr/attendance/monthly?company_id=${companyId}&site_id=${siteId}&month=${month}-01`);
      setResult(data);
    } catch (error: any) {
      setMessage(error.message || "Failed to load monthly attendance.");
    } finally {
      setLoading(false);
    }
  }

  async function periodAction(action: "send-back" | "finalize" | "reopen") {
    if (!result?.period?.id) return;
    const needsReason = action === "send-back" || action === "reopen";
    const reason = needsReason ? window.prompt(action === "send-back" ? "Enter send-back reason:" : "Enter reopen reason:") : "";
    if (needsReason && !reason?.trim()) return;
    try {
      await apiFetch(`/api/hr/attendance/periods/${result.period.id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setSuccess("Attendance period updated.");
      await load();
    } catch (error: any) {
      setMessage(error.message || "Failed to update attendance period.");
    }
  }

  async function deleteAttendancePeriod() {
    if (!result?.period?.id) return;
    if (!window.confirm("Delete this attendance permanently?\n\nThis action cannot be undone.")) return;
    const reason = window.prompt("Enter deletion reason of at least 10 characters:")?.trim() || "";
    if (reason.length < 10) {
      setMessage("Deletion reason must be at least 10 characters.");
      return;
    }
    try {
      await apiFetch(`/api/hr/attendance/periods/${result.period.id}`, {
        method: "DELETE",
        body: JSON.stringify({ reason }),
      });
      setSuccess("Attendance period deleted.");
      setResult(null);
    } catch (error: any) {
      setMessage(error.message || "Failed to delete attendance period.");
    }
  }

  function exportCsv() {
    if (!companyId || !siteId || !month) return;
    window.location.href = `/api/hr/attendance/export?company_id=${companyId}&site_id=${siteId}&month=${month}-01`;
  }

  if (!canView) {
    return <div className="rounded-2xl border bg-white p-8 text-sm text-slate-500 shadow-sm">Attendance is not available for your permissions.</div>;
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">Attendance Register</h1>
          <p className="text-sm text-slate-500">Review staff attendance totals and period finalization status.</p>
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
          <Select label="Company" value={companyId} onChange={(value) => { setCompanyId(value); setSiteId(""); }} options={lookups.companies} />
          <Select label="Site" value={siteId} onChange={setSiteId} options={visibleSites} />
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Month</span>
            <input type="month" value={month} max={currentIndiaDate().slice(0, 7)} onChange={(event) => setMonth(event.target.value)} className="h-10 w-full rounded-xl border px-3 text-sm" />
          </label>
          <div className="flex items-end gap-2">
            <button type="button" onClick={load} disabled={loading} className="h-10 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60">
              {loading ? "Loading..." : "Load"}
            </button>
          </div>
        </div>
      </section>

      {result && (
        <>
          <div className="grid gap-3 md:grid-cols-6">
            <Summary label="Employees" value={result.employees?.length || 0} />
            <Summary label="Recorded" value={result.summary?.total_recorded || 0} />
            <Summary label="Missing" value={result.summary?.missing || 0} />
            <Summary label="Period" value={result.period?.status || "draft"} />
            <Summary label="Working Day" value={`${result.policy?.standard_working_hours || EMPLOYEE_STANDARD_WORKING_HOURS} hrs`} />
            <Summary label="Locked Days" value={result.day_locks?.length || 0} />
          </div>

          <section className="rounded-2xl border bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
              <div>
                <h2 className="font-semibold text-slate-950">Period Controls</h2>
                <p className="text-sm text-slate-500">Daily entry remains the editing surface; this page is for review and period actions.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canExport && <button type="button" onClick={exportCsv} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50"><Download className="h-4 w-4" />Export CSV</button>}
                {canReject && pendingApproval && <button type="button" onClick={() => periodAction("send-back")} className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50">Send Back</button>}
                {canApprove && pendingApproval && <button type="button" onClick={() => periodAction("finalize")} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Approve</button>}
                {isAdminRecovery && result.period?.status === "finalized" && <button type="button" onClick={() => periodAction("reopen")} className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50">Reopen</button>}
                {isPlatformOwner && result.period?.id && <button type="button" onClick={deleteAttendancePeriod} className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"><Trash2 className="h-4 w-4" />Delete</button>}
              </div>
            </div>
          </section>

          <section className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
            <table className="min-w-[1400px] w-full text-left text-xs">
              <thead className="border-b bg-slate-50 uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="sticky left-0 z-10 bg-slate-50 px-3 py-3">Employee</th>
                  {result.dates.map((date: string) => <th key={date} className="px-2 py-3 text-center">{date.slice(-2)}</th>)}
                  {ATTENDANCE_STATUSES.map((status) => <th key={status} className="px-2 py-3 text-center">{ATTENDANCE_STATUS_CODES[status]}</th>)}
                  <th className="px-2 py-3 text-center">Missing</th>
                  <th className="px-2 py-3 text-center">Recorded</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.rows.map((row: any) => (
                  <tr key={row.employee.id}>
                    <td className="sticky left-0 z-10 bg-white px-3 py-3">
                      <p className="font-semibold text-slate-950">{row.employee.employee_name}</p>
                      <p className="text-slate-500">{row.employee.employee_code}</p>
                    </td>
                    {row.days.map((day: any, index: number) => (
                      <td key={`${row.employee.id}-${index}`} className="px-2 py-3 text-center">
                        {day ? ATTENDANCE_STATUS_CODES[day.status as keyof typeof ATTENDANCE_STATUS_CODES] : "-"}
                      </td>
                    ))}
                    {ATTENDANCE_STATUSES.map((status) => <td key={status} className="px-2 py-3 text-center font-semibold">{row.summary?.[status] || 0}</td>)}
                    <td className="px-2 py-3 text-center font-semibold">{row.summary?.missing || 0}</td>
                    <td className="px-2 py-3 text-center font-semibold">{row.summary?.total_recorded || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </section>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { id: string; label: string }[] }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-xl border px-3 text-sm">
        <option value="">Select {label}</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  );
}

function Summary({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-2xl border bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-xl font-bold text-slate-950">{value}</p></div>;
}
