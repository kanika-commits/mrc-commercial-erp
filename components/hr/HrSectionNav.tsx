"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { usePathname } from "next/navigation";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";

function navClass(active: boolean) {
  return [
    "inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold transition",
    active ? "bg-slate-950 text-white" : "border bg-white text-slate-700 hover:bg-slate-50",
  ].join(" ");
}

export default function HrSectionNav() {
  const pathname = usePathname();
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const canViewEmployees = can(permissions, "hr_employees", "view");
  const canViewReimbursements = can(permissions, "reimbursements", "view");
  const canViewMasters = canViewEmployees;
  const isMastersActive = pathname.startsWith("/hr/departments") || pathname.startsWith("/hr/designations");

  if (!canViewEmployees && !canViewReimbursements) return null;

  return (
    <nav className="flex flex-wrap items-center gap-2">
      {canViewEmployees && (
        <Link href="/hr/employees" className={navClass(pathname.startsWith("/hr/employees"))}>
          Employees
        </Link>
      )}
      {canViewReimbursements && (
        <Link href="/hr/reimbursements" className={navClass(pathname.startsWith("/hr/reimbursements"))}>
          Reimbursements
        </Link>
      )}
      {canViewMasters && (
        <details className="group relative">
          <summary className={`${navClass(isMastersActive)} cursor-pointer list-none gap-2`}>
            Masters
            <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
          </summary>
          <div className="absolute left-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border bg-white p-1 shadow-lg">
            <Link href="/hr/departments" className="block rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Departments
            </Link>
            <Link href="/hr/designations" className="block rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Designations
            </Link>
          </div>
        </details>
      )}
    </nav>
  );
}
