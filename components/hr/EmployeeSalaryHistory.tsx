"use client";

import { useMemo, useState } from "react";
import type { EmployeeSalaryHistory } from "@/types/hr";
import {
  SALARY_AMOUNT_FIELDS,
  SALARY_FIELD_LABELS,
  SALARY_REVISION_TYPES,
  salaryRevisionLabel,
} from "@/lib/hr/salaryHistory";
import { apiFetch, formatCurrency, formatDate, labelize } from "./hrClient";

type Props = {
  employeeId: string;
  history: EmployeeSalaryHistory[];
  setHistory: (history: EmployeeSalaryHistory[]) => void;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onError: (message: string) => void;
};

const initialForm = {
  revision_type: "joining_salary",
  effective_from: "",
  basic_salary: "",
  gross_salary: "",
  net_salary: "",
  ctc: "",
  employee_pf: "",
  employer_pf: "",
  employee_esic: "",
  employer_esic: "",
  professional_tax: "",
  tds: "",
  other_salary_deductions: "",
  bonus: "",
  reason: "",
  remarks: "",
};

export default function EmployeeSalaryHistory({
  employeeId,
  history,
  setHistory,
  canAdd,
  canEdit,
  canDelete,
  onError,
}: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(initialForm);

  const currentSalary = useMemo(
    () => history.find((row) => row.status === "current") || history[0] || null,
    [history],
  );

  function update(name: string, value: string) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function startEdit(row: EmployeeSalaryHistory) {
    setEditingId(row.id);
    setShowForm(true);
    setForm({
      revision_type: row.revision_type || "joining_salary",
      effective_from: row.effective_from || "",
      basic_salary: amountInput(row.basic_salary),
      gross_salary: amountInput(row.gross_salary),
      net_salary: amountInput(row.net_salary),
      ctc: amountInput(row.ctc),
      employee_pf: amountInput(row.employee_pf),
      employer_pf: amountInput(row.employer_pf),
      employee_esic: amountInput(row.employee_esic),
      employer_esic: amountInput(row.employer_esic),
      professional_tax: amountInput(row.professional_tax),
      tds: amountInput(row.tds),
      other_salary_deductions: amountInput(row.other_salary_deductions),
      bonus: amountInput(row.bonus),
      reason: row.reason || "",
      remarks: row.remarks || "",
    });
  }

  function resetForm() {
    setEditingId(null);
    setShowForm(false);
    setForm(initialForm);
  }

  async function saveSalary() {
    setSaving(true);
    onError("");
    try {
      const path = editingId
        ? `/api/hr/employees/${employeeId}/salary-history/${editingId}`
        : `/api/hr/employees/${employeeId}/salary-history`;
      const result = await apiFetch(path, {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify(form),
      });

      const saved = result.salary as EmployeeSalaryHistory;
      const next = editingId
        ? history.map((row) => (row.id === saved.id ? saved : row))
        : [saved].concat(history.map((row) => (row.status === "current" ? { ...row, status: "historical" } : row)));
      setHistory(sortHistory(next));
      resetForm();
    } catch (error: any) {
      onError(error.message || "Failed to save salary revision.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSalary(row: EmployeeSalaryHistory) {
    if (!window.confirm(`Delete salary revision #${row.revision_no}?`)) return;
    onError("");
    try {
      await apiFetch(`/api/hr/employees/${employeeId}/salary-history/${row.id}`, { method: "DELETE" });
      setHistory(history.filter((item) => item.id !== row.id));
    } catch (error: any) {
      onError(error.message || "Failed to delete salary revision.");
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Salary History</h2>
          <p className="mt-1 text-sm text-slate-500">Contractual and payroll salary revisions only. Reimbursements are managed separately.</p>
        </div>
        {canAdd && (
          <button
            type="button"
            onClick={() => setShowForm((prev) => !prev)}
            className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            + Add Salary Revision
          </button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <SummaryCard label="Current Basic" value={moneyOrDash(currentSalary?.basic_salary)} />
        <SummaryCard label="Current Gross" value={moneyOrDash(currentSalary?.gross_salary)} />
        <SummaryCard label="Current Net" value={moneyOrDash(currentSalary?.net_salary)} />
        <SummaryCard label="Current CTC" value={moneyOrDash(currentSalary?.ctc)} />
        <SummaryCard label="Last Revision" value={formatDate(currentSalary?.effective_from)} />
      </div>

      {showForm && (canAdd || (editingId && canEdit)) && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-950">{editingId ? "Edit Salary Revision" : "Add Salary Revision"}</h3>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <Field label="Revision Type *">
              <select value={form.revision_type} onChange={(event) => update("revision_type", event.target.value)} className={inputClass}>
                {SALARY_REVISION_TYPES.map((type) => (
                  <option key={type.code} value={type.code}>{type.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Effective From *">
              <input type="date" value={form.effective_from} onChange={(event) => update("effective_from", event.target.value)} className={inputClass} />
            </Field>
            <Field label="Reason">
              <input value={form.reason} onChange={(event) => update("reason", event.target.value)} className={inputClass} />
            </Field>
            {SALARY_AMOUNT_FIELDS.map((field) => (
              <Field key={field} label={SALARY_FIELD_LABELS[field]}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form[field]}
                  onChange={(event) => update(field, event.target.value)}
                  className={inputClass}
                />
              </Field>
            ))}
          </div>
          <div className="mt-4">
            <Field label="Remarks">
              <textarea value={form.remarks} onChange={(event) => update("remarks", event.target.value)} className={textareaClass} />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={resetForm} className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50">Cancel</button>
            <button type="button" disabled={saving} onClick={saveSalary} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {saving ? "Saving..." : "Save Salary Revision"}
            </button>
          </div>
        </div>
      )}

      {history.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          No salary revisions found.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Revision</th>
                <th className="px-4 py-3">Effective</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Basic</th>
                <th className="px-4 py-3 text-right">Gross</th>
                <th className="px-4 py-3 text-right">Net</th>
                <th className="px-4 py-3 text-right">CTC</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Status</th>
                {(canEdit || canDelete) && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 font-semibold text-slate-950">#{row.revision_no}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatDate(row.effective_from)}
                    {row.effective_to ? ` to ${formatDate(row.effective_to)}` : ""}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{salaryRevisionLabel(row.revision_type)}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{moneyOrDash(row.basic_salary)}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{moneyOrDash(row.gross_salary)}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{moneyOrDash(row.net_salary)}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{moneyOrDash(row.ctc)}</td>
                  <td className="px-4 py-3 text-slate-600">{row.reason || "-"}</td>
                  <td className="px-4 py-3 text-slate-600">{labelize(row.source)}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{labelize(row.status)}</span>
                  </td>
                  {(canEdit || canDelete) && (
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {canEdit && (
                          <button type="button" onClick={() => startEdit(row)} className="rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">Edit</button>
                        )}
                        {canDelete && row.status !== "current" && (
                          <button type="button" onClick={() => deleteSalary(row)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">Delete</button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function amountInput(value: number | string | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function moneyOrDash(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "-";
  return formatCurrency(value);
}

function sortHistory(history: EmployeeSalaryHistory[]) {
  return [...history].sort((left, right) => {
    const leftDate = left.effective_from || "";
    const rightDate = right.effective_from || "";
    if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
    return Number(right.revision_no || 0) - Number(left.revision_no || 0);
  });
}

const inputClass = "w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400";
const textareaClass = `${inputClass} min-h-24`;
