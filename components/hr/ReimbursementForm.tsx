"use client";

import { useEffect, useMemo, useState } from "react";
import type { HrEmployee, ReimbursementClaim } from "@/types/hr";
import { formatCurrency } from "./hrClient";

export type ReimbursementFormValues = {
  employee_id: string;
  claim_number: string;
  claim_date: string;
  claim_type: string;
  claim_for: string;
  description: string;
  amount: string;
  gst_amount: string;
};

type Props = {
  initialClaim?: ReimbursementClaim | null;
  employees: HrEmployee[];
  saving: boolean;
  onSubmit: (values: ReimbursementFormValues) => void;
};

const emptyValues: ReimbursementFormValues = {
  employee_id: "",
  claim_number: "",
  claim_date: "",
  claim_type: "travel",
  claim_for: "",
  description: "",
  amount: "",
  gst_amount: "0",
};

export default function ReimbursementForm({
  initialClaim,
  employees,
  saving,
  onSubmit,
}: Props) {
  const [form, setForm] = useState<ReimbursementFormValues>(emptyValues);

  useEffect(() => {
    if (!initialClaim) return;
    setForm({
      employee_id: initialClaim.employee_id || "",
      claim_number: initialClaim.claim_number || "",
      claim_date: initialClaim.claim_date || "",
      claim_type: initialClaim.claim_type || "travel",
      claim_for: initialClaim.description || "",
      description: initialClaim.description || "",
      amount: String(initialClaim.amount ?? ""),
      gst_amount: String(initialClaim.gst_amount ?? "0"),
    });
  }, [initialClaim]);

  const total = useMemo(() => {
    const amount = Number(form.amount || 0);
    const gst = Number(form.gst_amount || 0);
    return (Number.isFinite(amount) ? amount : 0) + (Number.isFinite(gst) ? gst : 0);
  }, [form.amount, form.gst_amount]);

  function handleChange(event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(form);
      }}
      className="space-y-6"
    >
      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-950">Claim Details</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Field label="Employee *">
            <select name="employee_id" value={form.employee_id} onChange={handleChange} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400">
              <option value="">Select employee</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.employee_name} ({employee.employee_code})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Claim Number *">
            <input name="claim_number" value={form.claim_number} onChange={handleChange} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400" />
          </Field>
          <Field label="Expense Date *">
            <input name="claim_date" type="date" value={form.claim_date} onChange={handleChange} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400" />
          </Field>
          <Field label="Type">
            <select name="claim_type" value={form.claim_type} onChange={handleChange} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400">
              <option value="travel">Travel</option>
              <option value="food">Food</option>
              <option value="fuel">Fuel</option>
              <option value="office">Office</option>
              <option value="medical">Medical</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Amount *">
            <input name="amount" type="number" min="0" step="0.01" value={form.amount} onChange={handleChange} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400" />
          </Field>
          <Field label="GST Amount">
            <input name="gst_amount" type="number" min="0" step="0.01" value={form.gst_amount} onChange={handleChange} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400" />
          </Field>
        </div>

        <div className="mt-4 rounded-2xl border bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Amount</p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{formatCurrency(total)}</p>
        </div>

        <div className="mt-4">
          <Field label="Claim For / Description">
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              rows={4}
              className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400 min-h-28 py-3"
            />
          </Field>
        </div>
      </section>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Claim"}
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
