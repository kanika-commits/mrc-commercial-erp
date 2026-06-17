"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Building2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { sortCompanies } from "@/lib/companyOrdering";
import { can, getCurrentUserAccess } from "@/lib/accessControl";

export default function NewCompanyBankAccountPage() {
  const router = useRouter();

  const [companies, setCompanies] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);

  const [form, setForm] = useState({
    company_id: "",
    bank_name: "",
    account_number: "",
    ifsc: "",
    is_default: false,
    status: "active",
  });

  useEffect(() => {
    loadCompanies();
  }, []);

  async function loadCompanies() {
    const access = await getCurrentUserAccess();

    if (!can(access.permissions, "company_bank_accounts", "add")) {
      setAccessDenied(true);
      setMessage("You do not have permission to add company bank accounts.");
      return;
    }

    const { data, error } = await supabase
      .from("companies")
      .select("id, company_name, company_code")
      .eq("status", "active")
      .order("company_name");

    if (error) {
      setMessage(error.message);
      return;
    }

    setCompanies(sortCompanies(data || []));
  }

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    const target = e.target as HTMLInputElement;
    const { name, value, type, checked } = target;

    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    if (!form.company_id) {
      setMessage("Company is required.");
      return;
    }

    if (!form.bank_name.trim()) {
      setMessage("Bank name is required.");
      return;
    }

    if (!form.account_number.trim()) {
      setMessage("Account number is required.");
      return;
    }

    if (!form.ifsc.trim()) {
      setMessage("IFSC is required.");
      return;
    }

    try {
      setSaving(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const response = await fetch("/api/company-bank-accounts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          company_id: form.company_id,
          bank_name: form.bank_name.trim(),
          account_number: form.account_number.trim(),
          ifsc: form.ifsc.trim().toUpperCase(),
          is_default: form.is_default,
          status: form.status,
        }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to create bank account.");
      }

      router.push("/company-bank-accounts");
    } catch (error: any) {
      setMessage(error.message || "Failed to create bank account.");
    } finally {
      setSaving(false);
    }
  }

  if (accessDenied) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <h1 className="text-lg font-semibold">Access Denied</h1>
        <p className="mt-1 text-sm">
          You do not have permission to add company bank accounts.
        </p>
        <Link
          href="/company-bank-accounts"
          className="mt-4 inline-flex rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
        >
          Back to Bank Accounts
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <Building2 className="h-3.5 w-3.5" />
            Master Setup
          </div>

          <h1 className="text-3xl font-bold text-slate-950">
            New Company Bank Account
          </h1>
          <p className="text-sm text-slate-500">
            Add bank account owned by a company.
          </p>
        </div>

        <Link
          href="/company-bank-accounts"
          className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      </div>

      {message && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {message}
        </div>
      )}

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-950">
          Bank Account Details
        </h2>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Company *">
            <select
              name="company_id"
              value={form.company_id}
              onChange={handleChange}
              className="h-11 w-full rounded-xl border px-3 text-sm"
            >
              <option value="">Select Company</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.company_name}{" "}
                  {company.company_code ? `(${company.company_code})` : ""}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Bank Name *">
            <input
              name="bank_name"
              value={form.bank_name}
              onChange={handleChange}
              className="h-11 w-full rounded-xl border px-3 text-sm"
              placeholder="HDFC Bank"
            />
          </Field>

          <Field label="Account Number *">
            <input
              name="account_number"
              value={form.account_number}
              onChange={handleChange}
              className="h-11 w-full rounded-xl border px-3 text-sm"
            />
          </Field>

          <Field label="IFSC *">
            <input
              name="ifsc"
              value={form.ifsc}
              onChange={handleChange}
              className="h-11 w-full rounded-xl border px-3 text-sm uppercase"
              placeholder="HDFC0001234"
            />
          </Field>

          <Field label="Status">
            <select
              name="status"
              value={form.status}
              onChange={handleChange}
              className="h-11 w-full rounded-xl border px-3 text-sm"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>

          <label className="flex items-center gap-3 pt-7">
            <input
              type="checkbox"
              name="is_default"
              checked={form.is_default}
              onChange={handleChange}
              className="h-4 w-4"
            />
            <span className="text-sm font-medium text-slate-700">
              Set as default account for this company
            </span>
          </label>
        </div>
      </section>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-slate-950 px-6 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Bank Account"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </span>
      {children}
    </label>
  );
}
