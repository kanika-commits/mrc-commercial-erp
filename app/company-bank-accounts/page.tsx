"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Building2, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import { companySortPriority } from "@/lib/companyOrdering";

function maskAccount(value?: string | null) {
  if (!value) return "-";
  return `****${value.slice(-4)}`;
}

export default function CompanyBankAccountsPage() {
  const { access } = useAccessContext();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const permissions = access?.permissions || [];
  const canAdd = can(permissions, "company_bank_accounts", "add");
  const canEdit = can(permissions, "company_bank_accounts", "edit");
  const canDelete = can(permissions, "company_bank_accounts", "delete");

  useEffect(() => {
    loadAccounts();
  }, []);

  async function authToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("Your session expired. Please log in again.");
    }

    return session.access_token;
  }

  async function loadAccounts() {
    try {
      setLoading(true);
      setMessage("");

      const token = await authToken();
      const response = await fetch("/api/company-bank-accounts", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to load bank accounts.");
      }

      const loadedAccounts = result.accounts || [];
      setAccounts(loadedAccounts);

      const companyIds = Array.from(
        new Set(loadedAccounts.map((a: any) => a.company_id).filter(Boolean))
      );

      if (companyIds.length) {
        const { data, error } = await supabase
          .from("companies")
          .select("id, company_name, company_code")
          .in("id", companyIds);

        if (error) throw error;
        setCompanies(data || []);
      } else {
        setCompanies([]);
      }
    } catch (error: any) {
      setMessage(error.message || "Failed to load bank accounts.");
    } finally {
      setLoading(false);
    }
  }

  async function deleteAccount(account: any) {
    const confirmed = window.confirm(
      `Delete bank account "${account.bank_name || "Bank Account"}"? It will be marked as deleted and hidden from active use.`
    );

    if (!confirmed) return;

    try {
      setMessage("");
      const token = await authToken();
      const response = await fetch(`/api/company-bank-accounts/${account.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to delete bank account.");
      }

      setAccounts((prev) => prev.filter((item) => item.id !== account.id));
      setMessage("Bank account deleted successfully.");
    } catch (error: any) {
      setMessage(error.message || "Failed to delete bank account.");
    }
  }

  const companyMap = useMemo(
    () => new Map(companies.map((company: any) => [company.id, company])),
    [companies]
  );

  const sortedAccounts = useMemo(
    () =>
      [...accounts].sort((a: any, b: any) => {
        const companyA = a.company_id ? companyMap.get(a.company_id) : null;
        const companyB = b.company_id ? companyMap.get(b.company_id) : null;
        const companyDiff =
          companySortPriority(companyA || {}) - companySortPriority(companyB || {});

        if (companyDiff !== 0) return companyDiff;

        return String(a.bank_name || "").localeCompare(String(b.bank_name || ""));
      }),
    [accounts, companyMap]
  );

  const activeCount = sortedAccounts.filter(
    (item: any) => item.status === "active"
  ).length;
  const defaultCount = sortedAccounts.filter(
    (item: any) => item.is_default === true
  ).length;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <Building2 className="h-3.5 w-3.5" />
            Master Setup
          </div>

          <h1 className="text-3xl font-bold text-slate-950">
            Company Bank Accounts
          </h1>
          <p className="text-sm text-slate-500">
            Manage company-wise bank accounts used for payments.
          </p>
        </div>

        {canAdd && (
          <Link
            href="/company-bank-accounts/new"
            className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            New Bank Account
          </Link>
        )}
      </div>

      {message && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800">
          {message}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Summary title="Total Accounts" value={String(sortedAccounts.length)} />
        <Summary title="Active Accounts" value={String(activeCount)} />
        <Summary title="Default Accounts" value={String(defaultCount)} />
      </div>

      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="border-b p-4">
          <h2 className="font-semibold text-slate-950">Bank Account Register</h2>
          <p className="text-xs text-slate-500">
            Company-wise account list for payment entry dropdowns.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3 text-left">Company</th>
                <th className="p-3 text-left">Bank</th>
                <th className="p-3 text-left">Account No</th>
                <th className="p-3 text-left">IFSC</th>
                <th className="p-3 text-left">Default</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    Loading bank accounts...
                  </td>
                </tr>
              ) : sortedAccounts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    No bank accounts found.
                  </td>
                </tr>
              ) : (
                sortedAccounts.map((account: any) => {
                  const company = account.company_id
                    ? companyMap.get(account.company_id)
                    : null;

                  return (
                    <tr key={account.id} className="border-t hover:bg-slate-50">
                      <td className="p-3">
                        <div className="font-medium text-slate-950">
                          {company?.company_name || "-"}
                        </div>
                        <div className="text-xs text-slate-500">
                          {company?.company_code || ""}
                        </div>
                      </td>

                      <td className="p-3 font-medium">{account.bank_name || "-"}</td>
                      <td className="p-3">{maskAccount(account.account_number)}</td>
                      <td className="p-3">{account.ifsc || "-"}</td>
                      <td className="p-3">{account.is_default ? "Yes" : "No"}</td>
                      <td className="p-3">{account.status || "active"}</td>

                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/company-bank-accounts/${account.id}`}
                            className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
                          >
                            View
                          </Link>
                          {canEdit && (
                            <Link
                              href={`/company-bank-accounts/${account.id}/edit`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded border text-sky-700 hover:bg-sky-50"
                              title="Edit bank account"
                            >
                              <Pencil className="h-4 w-4" />
                            </Link>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => deleteAccount(account)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded border border-red-200 text-red-700 hover:bg-red-50"
                              title="Delete bank account"
                            >
                              <Trash2 className="h-4 w-4" />
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
      </div>
    </section>
  );
}

function Summary({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {title}
      </p>
      <p className="mt-2 text-xl font-bold text-slate-950">{value}</p>
    </div>
  );
}
