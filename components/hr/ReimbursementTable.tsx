"use client";

import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import type { HrEmployee, LookupOption, ReimbursementClaim } from "@/types/hr";
import StatusBadge from "./StatusBadge";
import { formatCurrency, formatDate, labelize } from "./hrClient";

type Props = {
  claims: ReimbursementClaim[];
  employees: HrEmployee[];
  companies: LookupOption[];
  sites: LookupOption[];
  canEdit: boolean;
  canDelete: boolean;
  onDelete: (claim: ReimbursementClaim) => void;
};

function canMutate(status: string) {
  const key = String(status || "").toLowerCase();
  return key === "draft" || key === "rejected";
}

function lookup(options: LookupOption[], id?: string | null) {
  return options.find((option) => option.id === id)?.label || "-";
}

export default function ReimbursementTable({
  claims,
  employees,
  companies,
  sites,
  canEdit,
  canDelete,
  onDelete,
}: Props) {
  const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));

  return (
    <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
      <table className="min-w-[1300px] w-full text-left text-sm">
        <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">S. No.</th>
            <th className="px-4 py-3">Claim Number</th>
            <th className="px-4 py-3">Employee</th>
            <th className="px-4 py-3">Company</th>
            <th className="px-4 py-3">Site</th>
            <th className="px-4 py-3">Expense Date</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Claim For</th>
            <th className="px-4 py-3 text-right">Amount</th>
            <th className="px-4 py-3 text-right">GST</th>
            <th className="px-4 py-3 text-right">Total</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {claims.length === 0 ? (
            <tr>
              <td colSpan={13} className="px-4 py-10 text-center text-slate-500">
                No reimbursement claims found.
              </td>
            </tr>
          ) : (
            claims.map((claim, index) => {
              const employee = employeeMap.get(claim.employee_id);
              return (
                <tr key={claim.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500">{index + 1}</td>
                  <td className="px-4 py-3">
                    <Link href={`/hr/reimbursements/${claim.id}`} className="font-semibold text-sky-700 hover:underline">
                      {claim.claim_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{employee?.employee_name || "-"}</td>
                  <td className="px-4 py-3">{lookup(companies, claim.company_id)}</td>
                  <td className="px-4 py-3">{lookup(sites, claim.site_id)}</td>
                  <td className="px-4 py-3">{formatDate(claim.claim_date)}</td>
                  <td className="px-4 py-3">{labelize(claim.claim_type)}</td>
                  <td className="px-4 py-3">{claim.description || "-"}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(claim.amount)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(claim.gst_amount)}</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatCurrency(claim.total_amount)}</td>
                  <td className="px-4 py-3"><StatusBadge status={claim.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {canEdit && canMutate(claim.status) && (
                        <Link href={`/hr/reimbursements/${claim.id}/edit`} className="inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-slate-50">
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Link>
                      )}
                      {canDelete && canMutate(claim.status) && (
                        <button type="button" onClick={() => onDelete(claim)} className="inline-flex items-center gap-1 rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50">
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
