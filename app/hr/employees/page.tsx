"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileSpreadsheet, Plus, Search, UsersRound } from "lucide-react";
import AlertMessage from "@/components/AlertMessage";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import type { HrEmployee } from "@/types/hr";
import EmployeeTable from "@/components/hr/EmployeeTable";
import HrSectionNav from "@/components/hr/HrSectionNav";
import { apiFetch, labelize } from "@/components/hr/hrClient";
import { useHrLookups } from "@/components/hr/useHrLookups";

const pageSizeOptions = [25, 50, 100];
const employeeTypes = ["full_time", "contract", "consultant", "intern"];

export default function EmployeesPage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const canView = can(permissions, "hr_employees", "view");
  const canAdd = can(permissions, "hr_employees", "add");
  const canEdit = can(permissions, "hr_employees", "edit");
  const canDelete = can(permissions, "hr_employees", "delete");
  const canImport = can(permissions, "hr_employee_import", "view") || can(permissions, "hr_employee_import", "upload");
  const lookups = useHrLookups({ includeEmployees: false });
  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [designationFilter, setDesignationFilter] = useState("");
  const [employeeTypeFilter, setEmployeeTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState("");

  async function loadEmployees() {
    if (employees.length === 0) {
      setLoading(true);
    } else {
      setUpdating(true);
    }
    setMessage("");
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("page_size", String(pageSize));
      if (search.trim()) params.set("search", search.trim());
      if (companyFilter) params.set("company_id", companyFilter);
      if (siteFilter) params.set("site_id", siteFilter);
      if (departmentFilter) params.set("department_id", departmentFilter);
      if (designationFilter) params.set("designation_id", designationFilter);
      if (employeeTypeFilter) params.set("employment_type", employeeTypeFilter);
      if (statusFilter) params.set("status", statusFilter);
      const result = await apiFetch(`/api/hr/employees?${params.toString()}`);
      setEmployees(result.employees || []);
      setTotal(Number(result.total || 0));
    } catch (error: any) {
      setMessage(error.message || "Failed to load employees.");
    } finally {
      setLoading(false);
      setUpdating(false);
    }
  }

  useEffect(() => {
    loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyFilter, siteFilter, departmentFilter, designationFilter, employeeTypeFilter, statusFilter, page, pageSize, reloadKey]);

  const visibleSites = useMemo(
    () => companyFilter ? lookups.sites.filter((site) => !site.meta || site.meta === companyFilter) : lookups.sites,
    [companyFilter, lookups.sites],
  );
  const hasActiveFilters = Boolean(search.trim() || companyFilter || siteFilter || departmentFilter || designationFilter || employeeTypeFilter || statusFilter);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRow = Math.min(total, (page - 1) * pageSize + employees.length);

  function setFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  function resetFilters() {
    setSearch("");
    setCompanyFilter("");
    setSiteFilter("");
    setDepartmentFilter("");
    setDesignationFilter("");
    setEmployeeTypeFilter("");
    setStatusFilter("");
    setPage(1);
    setReloadKey((prev) => prev + 1);
  }

  function applyFilters() {
    if (page === 1) {
      setReloadKey((prev) => prev + 1);
      return;
    }

    setPage(1);
  }

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
          <h1 className="text-3xl font-bold text-slate-950">Employee Directory</h1>
          <p className="max-w-3xl text-sm text-slate-500">Manage and monitor employees, assignments, roles and workforce details across companies and sites.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canImport && (
            <Link href="/hr/employees/import" className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">
              <FileSpreadsheet className="h-4 w-4" />
              Import
            </Link>
          )}
          {canAdd && (
            <Link href="/hr/employees/new" className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
              <Plus className="h-4 w-4" />
              Add Employee
            </Link>
          )}
        </div>
      </header>
      <HrSectionNav />

      <AlertMessage type="error" message={message || lookups.error} onClose={() => setMessage("")} />

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    applyFilters();
                  }
                }}
                className="h-10 w-full rounded-xl border pl-9 pr-3 text-sm outline-none focus:border-slate-400"
                placeholder="Search by employee code, name, work/personal email or mobile"
              />
            </div>
          </div>
          <Select label="Company" value={companyFilter} onChange={(value) => { setFilter(setCompanyFilter, value); setSiteFilter(""); }} options={lookups.companies} />
          <Select label="Site" value={siteFilter} onChange={(value) => setFilter(setSiteFilter, value)} options={visibleSites} />
          <Select label="Department" value={departmentFilter} onChange={(value) => setFilter(setDepartmentFilter, value)} options={lookups.departments.map((d) => ({ id: d.id, label: d.department_name }))} />
          <Select label="Designation" value={designationFilter} onChange={(value) => setFilter(setDesignationFilter, value)} options={lookups.designations.map((d) => ({ id: d.id, label: d.designation_name }))} />
          <Select label="Employee Type" value={employeeTypeFilter} onChange={(value) => setFilter(setEmployeeTypeFilter, value)} options={employeeTypes.map((type) => ({ id: type, label: labelize(type) }))} />
          <Select label="Status" value={statusFilter} onChange={(value) => setFilter(setStatusFilter, value)} options={[{ id: "active", label: "Active" }, { id: "inactive", label: "Inactive" }]} />
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {hasActiveFilters && (
            <button type="button" onClick={resetFilters} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">Reset Filters</button>
          )}
          <button type="button" onClick={applyFilters} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">Apply</button>
        </div>
      </section>

      {loading || lookups.loading ? (
        <div className="rounded-2xl border bg-white p-8 text-sm text-slate-500 shadow-sm">Loading employees...</div>
      ) : (
        <>
          {updating && <p className="text-xs font-semibold text-slate-500">Refreshing directory...</p>}
          <EmployeeTable employees={employees} companies={lookups.companies} sites={lookups.sites} departments={lookups.departments} designations={lookups.designations} canView={canView} canEdit={canEdit} canDelete={canDelete} onDelete={deleteEmployee} startIndex={(page - 1) * pageSize} />
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white px-4 py-3 text-sm shadow-sm">
            <p className="font-medium text-slate-600">
              {total === 0 ? "Showing 0 employees" : `Showing ${startRow}-${endRow} of ${total} employees`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
                className="h-9 rounded-xl border px-3 text-sm"
              >
                {pageSizeOptions.map((size) => <option key={size} value={size}>{size} / page</option>)}
              </select>
              <button type="button" disabled={page <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))} className="h-9 rounded-xl border px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">Previous</button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, index) => {
                const start = Math.min(Math.max(1, page - 2), Math.max(1, totalPages - 4));
                const pageNumber = start + index;
                if (pageNumber > totalPages) return null;
                return (
                  <button
                    key={pageNumber}
                    type="button"
                    onClick={() => setPage(pageNumber)}
                    className={`h-9 min-w-9 rounded-xl border px-3 text-sm font-semibold ${pageNumber === page ? "bg-slate-950 text-white" : "bg-white hover:bg-slate-50"}`}
                  >
                    {pageNumber}
                  </button>
                );
              })}
              <button type="button" disabled={page >= totalPages} onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} className="h-9 rounded-xl border px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">Next</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { id: string; label: string }[] }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-10 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400">
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
