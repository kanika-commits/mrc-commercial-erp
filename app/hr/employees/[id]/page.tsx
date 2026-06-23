"use client";

import Link from "next/link";
import { ArrowLeft, Pencil, Trash2, UsersRound } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import AlertMessage from "@/components/AlertMessage";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import type { HrEmployee, ReimbursementClaim } from "@/types/hr";
import StatusBadge from "@/components/hr/StatusBadge";
import ReimbursementTable from "@/components/hr/ReimbursementTable";
import { apiFetch, formatDate, labelize } from "@/components/hr/hrClient";
import { useHrLookups } from "@/components/hr/useHrLookups";

export default function EmployeeDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const canEdit = can(permissions, "hr_employees", "edit");
  const canDelete = can(permissions, "hr_employees", "delete");
  const lookups = useHrLookups();
  const [employee, setEmployee] = useState<HrEmployee | null>(null);
  const [claims, setClaims] = useState<ReimbursementClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const [employeeResult, claimsResult] = await Promise.all([
        apiFetch(`/api/hr/employees/${params.id}`),
        apiFetch(`/api/hr/reimbursements?employee_id=${params.id}`),
      ]);
      setEmployee(employeeResult.employee);
      setClaims(claimsResult.reimbursements || []);
    } catch (error: any) {
      setMessage(error.message || "Failed to load employee.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const labels = useMemo(() => {
    const company = lookups.companies.find((item) => item.id === employee?.company_id)?.label || "-";
    const site = lookups.sites.find((item) => item.id === employee?.site_id)?.label || "-";
    const department = lookups.departments.find((item) => item.id === employee?.department_id)?.department_name || "-";
    const designation = lookups.designations.find((item) => item.id === employee?.designation_id)?.designation_name || "-";
    const manager = lookups.employees.find((item) => item.id === employee?.reporting_manager_id);
    return { company, site, department, designation, manager: manager ? `${manager.employee_name} (${manager.employee_code})` : "-" };
  }, [employee, lookups]);

  async function deleteEmployee() {
    if (!employee || !window.confirm(`Delete employee "${employee.employee_name}"?`)) return;
    try {
      await apiFetch(`/api/hr/employees/${employee.id}`, { method: "DELETE" });
      router.push("/hr/employees");
    } catch (error: any) {
      setMessage(error.message || "Failed to delete employee.");
    }
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
            <UsersRound className="h-3.5 w-3.5" />
            HR
          </div>
          <h1 className="text-3xl font-bold text-slate-950">{employee?.employee_name || "Employee"}</h1>
          <p className="text-sm text-slate-500">{employee?.employee_code || ""}</p>
        </div>
        <div className="flex gap-2">
          {canEdit && employee && <Link href={`/hr/employees/${employee.id}/edit`} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"><Pencil className="h-4 w-4" />Edit</Link>}
          {canDelete && employee && <button type="button" onClick={deleteEmployee} className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" />Delete</button>}
          <Link href="/hr/employees" className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"><ArrowLeft className="h-4 w-4" />Back</Link>
        </div>
      </header>

      <AlertMessage type="error" message={message || lookups.error} onClose={() => setMessage("")} />

      {loading || lookups.loading ? (
        <div className="rounded-2xl border bg-white p-8 text-sm text-slate-500 shadow-sm">Loading employee...</div>
      ) : employee ? (
        <>
          <section className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-950">Basic Information</h2>
            <div className="mt-5 grid gap-5 md:grid-cols-3">
              <Info label="Employee Code" value={employee.employee_code} />
              <Info label="Employee Name" value={employee.employee_name} />
              <Info label="Status" value={<StatusBadge status={employee.status} />} />
              <Info label="Email" value={employee.email || "-"} />
              <Info label="Phone" value={employee.phone || "-"} />
              <Info label="Employee Type" value={labelize(employee.employment_type)} />
              <Info label="Company" value={labels.company} />
              <Info label="Site" value={labels.site} />
              <Info label="Joining Date" value={formatDate(employee.date_of_joining)} />
              <Info label="Department" value={labels.department} />
              <Info label="Designation" value={labels.designation} />
              <Info label="Reporting Manager" value={labels.manager} />
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-950">Reimbursement History</h2>
            <ReimbursementTable claims={claims} employees={lookups.employees} companies={lookups.companies} sites={lookups.sites} canEdit={false} canDelete={false} onDelete={() => {}} />
          </section>
        </>
      ) : null}
    </section>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 text-base font-semibold text-slate-950">{value}</div>
    </div>
  );
}
