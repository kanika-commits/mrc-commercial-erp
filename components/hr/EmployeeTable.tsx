"use client";

import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import type { HrDepartment, HrDesignation, HrEmployee, LookupOption } from "@/types/hr";
import StatusBadge from "./StatusBadge";
import { labelize } from "./hrClient";

type Props = {
  employees: HrEmployee[];
  companies: LookupOption[];
  sites: LookupOption[];
  departments: HrDepartment[];
  designations: HrDesignation[];
  canEdit: boolean;
  canDelete: boolean;
  onDelete: (employee: HrEmployee) => void;
};

function lookup(options: LookupOption[], id?: string | null) {
  return options.find((option) => option.id === id)?.label || "-";
}

export default function EmployeeTable({
  employees,
  companies,
  sites,
  departments,
  designations,
  canEdit,
  canDelete,
  onDelete,
}: Props) {
  const departmentMap = new Map(departments.map((item) => [item.id, item.department_name]));
  const designationMap = new Map(designations.map((item) => [item.id, item.designation_name]));

  return (
    <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
      <table className="min-w-[1100px] w-full text-left text-sm">
        <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">S. No.</th>
            <th className="px-4 py-3">Employee Code</th>
            <th className="px-4 py-3">Employee Name</th>
            <th className="px-4 py-3">Company</th>
            <th className="px-4 py-3">Site</th>
            <th className="px-4 py-3">Department</th>
            <th className="px-4 py-3">Designation</th>
            <th className="px-4 py-3">Employee Type</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {employees.length === 0 ? (
            <tr>
              <td colSpan={10} className="px-4 py-10 text-center text-slate-500">
                No employees found.
              </td>
            </tr>
          ) : (
            employees.map((employee, index) => (
              <tr key={employee.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-500">{index + 1}</td>
                <td className="px-4 py-3">
                  <Link href={`/hr/employees/${employee.id}`} className="font-semibold text-sky-700 hover:underline">
                    {employee.employee_code}
                  </Link>
                </td>
                <td className="px-4 py-3 font-medium text-slate-900">{employee.employee_name}</td>
                <td className="px-4 py-3">{lookup(companies, employee.company_id)}</td>
                <td className="px-4 py-3">{lookup(sites, employee.site_id)}</td>
                <td className="px-4 py-3">{departmentMap.get(employee.department_id || "") || "-"}</td>
                <td className="px-4 py-3">{designationMap.get(employee.designation_id || "") || "-"}</td>
                <td className="px-4 py-3">{labelize(employee.employment_type)}</td>
                <td className="px-4 py-3"><StatusBadge status={employee.status} /></td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {canEdit && (
                      <Link
                        href={`/hr/employees/${employee.id}/edit`}
                        className="inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-slate-50"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </Link>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => onDelete(employee)}
                        className="inline-flex items-center gap-1 rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
