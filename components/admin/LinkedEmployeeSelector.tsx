"use client";

import { useMemo } from "react";

type EmployeeOption = {
  id: string;
  employee_code?: string | null;
  employee_name?: string | null;
  site_name?: string | null;
  department_name?: string | null;
  already_linked?: boolean;
  selectable?: boolean;
};

type Props = {
  employees: EmployeeOption[];
  value: string;
  onChange: (value: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  required?: boolean;
  allowUnlink?: boolean;
  disabled?: boolean;
};

function optionLabel(employee: EmployeeOption) {
  return [employee.employee_name || employee.employee_code || "Unnamed Employee", employee.site_name, employee.department_name]
    .filter((part) => part && String(part).trim())
    .join(" — ");
}

export default function LinkedEmployeeSelector({
  employees,
  value,
  onChange,
  search,
  onSearchChange,
  required = false,
  allowUnlink = false,
  disabled = false,
}: Props) {
  const normalizedSearch = search.trim().toLowerCase();
  const filteredEmployees = useMemo(() => {
    if (!normalizedSearch) return employees.slice(0, 50);
    return employees
      .filter((employee) =>
        [
          employee.employee_name,
          employee.employee_code,
          employee.department_name,
        ]
          .filter(Boolean)
          .some((part) => String(part).toLowerCase().includes(normalizedSearch)),
      )
      .slice(0, 50);
  }, [employees, normalizedSearch]);

  const selected = employees.find((employee) => employee.id === value);

  return (
    <section className="rounded-lg border bg-white p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Linked Employee {required ? "*" : ""}</h2>
          <p className="text-sm text-gray-500">Select an existing active employee for this ERP login.</p>
        </div>
        {selected && (
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
            Linked
          </span>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Search Employee</span>
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            disabled={disabled}
            className="w-full rounded-lg border px-3 py-2 disabled:bg-gray-100"
            placeholder="Search by name, code or department"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Employee</span>
          <select
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
            className="w-full rounded-lg border px-3 py-2 disabled:bg-gray-100"
            required={required}
          >
            <option value="">{allowUnlink ? "No employee linked" : "Select employee"}</option>
            {filteredEmployees.map((employee) => {
              const disabledOption = employee.already_linked && employee.id !== value;
              return (
                <option key={employee.id} value={employee.id} disabled={disabledOption}>
                  {optionLabel(employee)}
                  {disabledOption ? " - Already linked" : ""}
                </option>
              );
            })}
          </select>
        </label>
      </div>

      {selected && (
        <p className="mt-3 text-sm text-gray-600">
          Selected: <span className="font-semibold">{optionLabel(selected)}</span>
        </p>
      )}
    </section>
  );
}
