"use client";

import Link from "next/link";
import { Eye, Mail, Pencil, Phone, Trash2 } from "lucide-react";
import type { HrDepartment, HrDesignation, HrEmployee, LookupOption } from "@/types/hr";
import StatusBadge from "./StatusBadge";
import { formatDate, labelize } from "./hrClient";
import EmployeePhoto from "./EmployeePhoto";
import { recordClientAuditEvent } from "@/lib/clientAudit";

type Props = {
  employees: HrEmployee[];
  companies: LookupOption[];
  sites: LookupOption[];
  departments: HrDepartment[];
  designations: HrDesignation[];
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onDelete: (employee: HrEmployee) => void;
  startIndex?: number;
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
  canView,
  canEdit,
  canDelete,
  onDelete,
  startIndex = 0,
}: Props) {
  const departmentMap = new Map(departments.map((item) => [item.id, item.department_name]));
  const designationMap = new Map(designations.map((item) => [item.id, item.designation_name]));

  return (
    <>
      <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm lg:block">
        <table className="min-w-[1180px] w-full text-left text-sm">
          <thead className="border-b bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-16 px-4 py-3">S. No.</th>
              <th className="w-16 px-3 py-3">Photo</th>
              <th className="px-3 py-3">Employee Code</th>
              <th className="px-3 py-3">Employee</th>
              <th className="px-3 py-3">Company / Site</th>
              <th className="px-3 py-3">Department / Designation</th>
              <th className="px-3 py-3">Employee Type</th>
              <th className="px-3 py-3">Contact Details</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {employees.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center">
                  <p className="font-semibold text-slate-900">No employees found</p>
                  <p className="mt-1 text-sm text-slate-500">No records match the current filters.</p>
                </td>
              </tr>
            ) : (
              employees.map((employee, index) => (
                <tr key={employee.id} className="align-middle transition hover:bg-slate-50/80">
                  <td className="px-4 py-3 text-slate-500">{startIndex + index + 1}</td>
                  <td className="px-3 py-3">
                    <EmployeePhoto name={employee.employee_name} photoUrl={employee.photo_signed_url} size="sm" />
                  </td>
                  <td className="px-3 py-3">
                    <Link href={`/hr/employees/${employee.id}`} className="font-semibold text-sky-700 hover:underline" onClick={() => recordClientAuditEvent({ eventType: "view_record", entityType: "employee", recordId: employee.id, source: "employees_register" })}>
                      {employee.employee_code}
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <Link href={`/hr/employees/${employee.id}`} className="font-semibold text-slate-950 hover:text-sky-700" onClick={() => recordClientAuditEvent({ eventType: "view_record", entityType: "employee", recordId: employee.id, source: "employees_register" })}>
                      {employee.employee_name}
                    </Link>
                    {employee.date_of_joining && (
                      <p className="mt-0.5 text-xs text-slate-500">Joined {formatDate(employee.date_of_joining)}</p>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <p className="font-medium text-slate-900">{lookup(companies, employee.company_id)}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{lookup(sites, employee.site_id)}</p>
                  </td>
                  <td className="px-3 py-3">
                    <p className="font-medium text-slate-900">{departmentMap.get(employee.department_id || "") || "-"}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{designationMap.get(employee.designation_id || "") || "-"}</p>
                  </td>
                  <td className="px-3 py-3">
                    <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                      {labelize(employee.employment_type)}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {employee.phone || employee.email || employee.personal_phone || employee.personal_email ? (
                      <div className="max-w-[220px] space-y-1 text-xs text-slate-600">
                        {employee.phone && <p className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-slate-400" />Work: {employee.phone}</p>}
                        {employee.personal_phone && <p className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-slate-400" />Personal: {employee.personal_phone}</p>}
                        {employee.email && <p className="flex items-center gap-1.5 break-all"><Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />Work: {employee.email}</p>}
                        {employee.personal_email && <p className="flex items-center gap-1.5 break-all"><Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />Personal: {employee.personal_email}</p>}
                      </div>
                    ) : "-"}
                  </td>
                  <td className="px-3 py-3"><StatusBadge status={employee.status} /></td>
                  <td className="px-4 py-3">
                    <Actions employee={employee} canView={canView} canEdit={canEdit} canDelete={canDelete} onDelete={onDelete} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 lg:hidden">
        {employees.length === 0 ? (
          <div className="rounded-2xl border bg-white p-8 text-center shadow-sm">
            <p className="font-semibold text-slate-900">No employees found</p>
            <p className="mt-1 text-sm text-slate-500">No records match the current filters.</p>
          </div>
        ) : (
          employees.map((employee, index) => (
            <article key={employee.id} className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <EmployeePhoto name={employee.employee_name} photoUrl={employee.photo_signed_url} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-500">#{startIndex + index + 1} · {employee.employee_code}</p>
                  <Link href={`/hr/employees/${employee.id}`} className="mt-1 block font-semibold text-slate-950" onClick={() => recordClientAuditEvent({ eventType: "view_record", entityType: "employee", recordId: employee.id, source: "employees_register" })}>
                    {employee.employee_name}
                  </Link>
                  <p className="mt-1 text-sm text-slate-600">{lookup(companies, employee.company_id)}</p>
                  <p className="text-xs text-slate-500">{lookup(sites, employee.site_id)}</p>
                </div>
                <StatusBadge status={employee.status} />
              </div>
              <div className="mt-3 grid gap-2 text-xs text-slate-600">
                <p><span className="font-semibold text-slate-700">Department:</span> {departmentMap.get(employee.department_id || "") || "-"}</p>
                <p><span className="font-semibold text-slate-700">Designation:</span> {designationMap.get(employee.designation_id || "") || "-"}</p>
                <p><span className="font-semibold text-slate-700">Type:</span> {labelize(employee.employment_type)}</p>
                {(employee.phone || employee.email || employee.personal_phone || employee.personal_email) && (
                  <p className="break-all">
                    <span className="font-semibold text-slate-700">Contact:</span>{" "}
                    {[
                      employee.phone ? `Work phone: ${employee.phone}` : "",
                      employee.personal_phone ? `Personal phone: ${employee.personal_phone}` : "",
                      employee.email ? `Work email: ${employee.email}` : "",
                      employee.personal_email ? `Personal email: ${employee.personal_email}` : "",
                    ].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
              <div className="mt-4">
                <Actions employee={employee} canView={canView} canEdit={canEdit} canDelete={canDelete} onDelete={onDelete} />
              </div>
            </article>
          ))
        )}
      </div>
    </>
  );
}

function Actions({
  employee,
  canView,
  canEdit,
  canDelete,
  onDelete,
}: {
  employee: HrEmployee;
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onDelete: (employee: HrEmployee) => void;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {canView && (
        <Link
          href={`/hr/employees/${employee.id}`}
          title="View employee"
          className="inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-slate-50"
        >
          <Eye className="h-3.5 w-3.5" />
          View
        </Link>
      )}
      {canEdit && (
        <Link
          href={`/hr/employees/${employee.id}/edit`}
          title="Edit employee"
          className="inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-slate-50"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Link>
      )}
      {canDelete && (
        <button
          type="button"
          title="Delete employee"
          onClick={() => onDelete(employee)}
          className="inline-flex items-center gap-1 rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
      )}
    </div>
  );
}
