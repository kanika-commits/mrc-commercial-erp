"use client";

import { useEffect, useState } from "react";
import type { HrDepartment, HrDesignation, HrEmployee, LookupOption } from "@/types/hr";

type EmployeeFormValues = {
  employee_code: string;
  employee_name: string;
  email: string;
  phone: string;
  company_id: string;
  site_id: string;
  department_id: string;
  designation_id: string;
  reporting_manager_id: string;
  employment_type: string;
  date_of_joining: string;
  status: string;
};

type Props = {
  initialEmployee?: HrEmployee | null;
  companies: LookupOption[];
  sites: LookupOption[];
  departments: HrDepartment[];
  designations: HrDesignation[];
  managers: HrEmployee[];
  saving: boolean;
  onSubmit: (values: EmployeeFormValues) => void;
};

const emptyValues: EmployeeFormValues = {
  employee_code: "",
  employee_name: "",
  email: "",
  phone: "",
  company_id: "",
  site_id: "",
  department_id: "",
  designation_id: "",
  reporting_manager_id: "",
  employment_type: "full_time",
  date_of_joining: "",
  status: "active",
};

export default function EmployeeForm({
  initialEmployee,
  companies,
  sites,
  departments,
  designations,
  managers,
  saving,
  onSubmit,
}: Props) {
  const [form, setForm] = useState<EmployeeFormValues>(emptyValues);

  useEffect(() => {
    if (!initialEmployee) return;
    setForm({
      employee_code: initialEmployee.employee_code || "",
      employee_name: initialEmployee.employee_name || "",
      email: initialEmployee.email || "",
      phone: initialEmployee.phone || "",
      company_id: initialEmployee.company_id || "",
      site_id: initialEmployee.site_id || "",
      department_id: initialEmployee.department_id || "",
      designation_id: initialEmployee.designation_id || "",
      reporting_manager_id: initialEmployee.reporting_manager_id || "",
      employment_type: initialEmployee.employment_type || "full_time",
      date_of_joining: initialEmployee.date_of_joining || "",
      status: initialEmployee.status || "active",
    });
  }, [initialEmployee]);

  function handleChange(event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = event.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
      ...(name === "company_id" ? { site_id: "" } : {}),
    }));
  }

  const visibleSites = form.company_id
    ? sites.filter((site) => !site.meta || site.meta === form.company_id)
    : sites;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(form);
      }}
      className="space-y-6"
    >
      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-950">Employee Information</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Field label="Employee Code *">
            <input name="employee_code" value={form.employee_code} onChange={handleChange} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400" />
          </Field>
          <Field label="Employee Name *">
            <input name="employee_name" value={form.employee_name} onChange={handleChange} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400" />
          </Field>
          <Field label="Email">
            <input name="email" value={form.email} onChange={handleChange} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400" />
          </Field>
          <Field label="Phone">
            <input name="phone" value={form.phone} onChange={handleChange} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400" />
          </Field>
          <Field label="Company *">
            <select name="company_id" value={form.company_id} onChange={handleChange} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400">
              <option value="">Select company</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>{company.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Site">
            <select name="site_id" value={form.site_id} onChange={handleChange} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400">
              <option value="">No site</option>
              {visibleSites.map((site) => (
                <option key={site.id} value={site.id}>{site.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Department">
            <select name="department_id" value={form.department_id} onChange={handleChange} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400">
              <option value="">Select department</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>{department.department_name}</option>
              ))}
            </select>
          </Field>
          <Field label="Designation">
            <select name="designation_id" value={form.designation_id} onChange={handleChange} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400">
              <option value="">Select designation</option>
              {designations.map((designation) => (
                <option key={designation.id} value={designation.id}>{designation.designation_name}</option>
              ))}
            </select>
          </Field>
          <Field label="Employee Type">
            <select name="employment_type" value={form.employment_type} onChange={handleChange} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400">
              <option value="full_time">Full Time</option>
              <option value="contract">Contract</option>
              <option value="consultant">Consultant</option>
              <option value="intern">Intern</option>
            </select>
          </Field>
          <Field label="Joining Date">
            <input name="date_of_joining" type="date" value={form.date_of_joining} onChange={handleChange} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400" />
          </Field>
          <Field label="Reporting Manager">
            <select name="reporting_manager_id" value={form.reporting_manager_id} onChange={handleChange} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400">
              <option value="">No reporting manager</option>
              {managers
                .filter((manager) => manager.id !== initialEmployee?.id)
                .map((manager) => (
                  <option key={manager.id} value={manager.id}>
                    {manager.employee_name} ({manager.employee_code})
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Status">
            <select name="status" value={form.status} onChange={handleChange} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>
        </div>
      </section>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Employee"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-slate-700">{label}</span>
      {children}
    </label>
  );
}
