"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, ReceiptText } from "lucide-react";
import AlertMessage from "@/components/AlertMessage";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import type { ReimbursementClaim } from "@/types/hr";
import ReimbursementTable from "@/components/hr/ReimbursementTable";
import { apiFetch, formatCurrency, labelize } from "@/components/hr/hrClient";
import { useHrLookups } from "@/components/hr/useHrLookups";

const statuses = ["draft", "pending", "approved", "rejected", "paid"];

export default function ReimbursementsPage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const canAdd = can(permissions, "reimbursements", "add");
  const canEdit = can(permissions, "reimbursements", "edit");
  const canDelete = can(permissions, "reimbursements", "delete");
  const lookups = useHrLookups();
  const [claims, setClaims] = useState<ReimbursementClaim[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function loadClaims() {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (employeeFilter) params.set("employee_id", employeeFilter);
      const result = await apiFetch(`/api/hr/reimbursements?${params.toString()}`);
      setClaims(result.reimbursements || []);
    } catch (error: any) {
      setMessage(error.message || "Failed to load reimbursements.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadClaims();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, employeeFilter]);

  const visibleClaims = useMemo(() => {
    return claims.filter((claim) => {
      if (typeFilter && claim.claim_type !== typeFilter) return false;
      if (fromDate && claim.claim_date < fromDate) return false;
      if (toDate && claim.claim_date > toDate) return false;
      return true;
    });
  }, [claims, fromDate, toDate, typeFilter]);

  const counts = useMemo(() => {
    return statuses.reduce<Record<string, number>>((acc, status) => {
      acc[status] = claims.filter((claim) => String(claim.status).toLowerCase() === status).length;
      return acc;
    }, {});
  }, [claims]);

  async function deleteClaim(claim: ReimbursementClaim) {
    if (!window.confirm(`Delete reimbursement claim "${claim.claim_number}"?`)) return;
    try {
      await apiFetch(`/api/hr/reimbursements/${claim.id}`, { method: "DELETE" });
      setClaims((prev) => prev.filter((item) => item.id !== claim.id));
    } catch (error: any) {
      setMessage(error.message || "Failed to delete reimbursement.");
    }
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <ReceiptText className="h-3.5 w-3.5" />
            HR
          </div>
          <h1 className="text-3xl font-bold text-slate-950">Reimbursements</h1>
          <p className="text-sm text-slate-500">Track employee reimbursement claims.</p>
        </div>
        {canAdd && (
          <Link href="/hr/reimbursements/new" className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
            <Plus className="h-4 w-4" />
            New Claim
          </Link>
        )}
      </header>

      <AlertMessage type="error" message={message || lookups.error} onClose={() => setMessage("")} />

      <div className="grid gap-4 md:grid-cols-5">
        {statuses.map((status) => (
          <button key={status} type="button" onClick={() => setStatusFilter(statusFilter === status ? "" : status)} className={`rounded-2xl border bg-white p-4 text-left shadow-sm ${statusFilter === status ? "ring-2 ring-slate-900" : ""}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{labelize(status)}</p>
            <p className="mt-2 text-2xl font-bold text-slate-950">{counts[status] || 0}</p>
          </button>
        ))}
      </div>

      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-5">
          <Select label="Status" value={statusFilter} onChange={setStatusFilter} options={statuses.map((status) => ({ id: status, label: labelize(status) }))} />
          <Select label="Employee" value={employeeFilter} onChange={setEmployeeFilter} options={lookups.employees.map((employee) => ({ id: employee.id, label: `${employee.employee_name} (${employee.employee_code})` }))} />
          <Select label="Type" value={typeFilter} onChange={setTypeFilter} options={["travel", "food", "fuel", "office", "medical", "other"].map((type) => ({ id: type, label: labelize(type) }))} />
          <Field label="From Date"><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field>
          <Field label="To Date"><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field>
        </div>
        <div className="mt-4 text-sm font-semibold text-slate-600">Visible total: {formatCurrency(visibleClaims.reduce((sum, claim) => sum + Number(claim.total_amount || 0), 0))}</div>
      </section>

      {loading || lookups.loading ? (
        <div className="rounded-2xl border bg-white p-8 text-sm text-slate-500 shadow-sm">Loading reimbursements...</div>
      ) : (
        <ReimbursementTable claims={visibleClaims} employees={lookups.employees} companies={lookups.companies} sites={lookups.sites} canEdit={canEdit} canDelete={canDelete} onDelete={deleteClaim} />
      )}
    </section>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { id: string; label: string }[] }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-full rounded-xl border px-3 text-sm">
        <option value="">All</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </Field>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-semibold text-slate-700">{label}</span>{children}</label>;
}
