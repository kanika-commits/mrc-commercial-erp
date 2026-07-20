"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search, UsersRound } from "lucide-react";
import AlertMessage from "@/components/AlertMessage";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import type { HrEmployee } from "@/types/hr";
import EmployeeTable from "@/components/hr/EmployeeTable";
import { apiFetch } from "@/components/hr/hrClient";
import { useHrLookups } from "@/components/hr/useHrLookups";

export default function EmployeesPage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const canAdd = can(permissions, "hr_employees", "add");
  const canEdit = can(permissions, "hr_employees", "edit");
  const canDelete = can(permissions, "hr_employees", "delete");
  const lookups = useHrLookups({ includeEmployees: false });
  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function loadEmployees() {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (companyFilter) params.set("company_id", companyFilter);
      if (siteFilter) params.set("site_id", siteFilter);
      if (statusFilter) params.set("status", statusFilter);
      const result = await apiFetch(`/api/hr/employees?${params.toString()}`);
      setEmployees(result.employees || []);
    } catch (error: any) {
      setMessage(error.message || "Failed to load employees.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyFilter, siteFilter, statusFilter]);

  const filteredEmployees = useMemo(
    () =>
      departmentFilter
        ? employees.filter((employee) => employee.department_id === departmentFilter)
        : employees,
    [departmentFilter, employees]
  );

  async function deleteEmployee(employee: HrEmployee) {
    if (!window.confirm(`Delete employee "${employee.employee_name}"?`)) return;
    try {
      await apiFetch(`/api/hr/employees/${employee.id}`, { method: "DELETE" });
      setEmployees((prev) => prev.filter((item) => item.id !== employee.id));
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
          <h1 className="text-3xl font-bold text-slate-950">Employee Master</h1>
          <p className="text-sm text-slate-500">Manage employees, reporting and employment details.</p>
        </div>
        {canAdd && (
          <Link href="/hr/employees/new" className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
            <Plus className="h-4 w-4" />
            Add Employee
          </Link>
        )}
      </header>

      <AlertMessage type="error" message={message || lookups.error} onClose={() => setMessage("")} />

      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-5">
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-semibold text-slate-700">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loadEmployees()} className="h-11 w-full rounded-xl border pl-9 pr-3 text-sm" placeholder="Code, name, email or phone" />
            </div>
          </div>
          <Select label="Company" value={companyFilter} onChange={setCompanyFilter} options={lookups.companies} />
          <Select label="Site" value={siteFilter} onChange={setSiteFilter} options={lookups.sites} />
          <Select label="Department" value={departmentFilter} onChange={setDepartmentFilter} options={lookups.departments.map((d) => ({ id: d.id, label: d.department_name }))} />
          <Select label="Status" value={statusFilter} onChange={setStatusFilter} options={[{ id: "active", label: "Active" }, { id: "inactive", label: "Inactive" }]} />
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={loadEmployees} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">Apply</button>
        </div>
      </section>

      {loading || lookups.loading ? (
        <div className="rounded-2xl border bg-white p-8 text-sm text-slate-500 shadow-sm">Loading employees...</div>
      ) : (
        <EmployeeTable employees={filteredEmployees} companies={lookups.companies} sites={lookups.sites} departments={lookups.departments} designations={lookups.designations} canEdit={canEdit} canDelete={canDelete} onDelete={deleteEmployee} />
      )}
    </section>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { id: string; label: string }[] }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-slate-700">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-full rounded-xl border px-3 text-sm">
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
