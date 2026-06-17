"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Building2, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { can, getCurrentUserAccess } from "@/lib/accessControl";

function maskAccount(value?: string | null) {
  if (!value) return "-";
  return `XXXX${value.slice(-4)}`;
}

export default function CompanyBankAccountDetailPage() {
  const params = useParams();
  const accountId = params.id as string;

  const [account, setAccount] = useState<any>(null);
  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);

  useEffect(() => {
    loadAccount();
  }, [accountId]);

  async function loadAccount() {
    try {
      setLoading(true);
      setMessage("");

      const access = await getCurrentUserAccess();
      setCanEdit(can(access.permissions, "company_bank_accounts", "edit"));
      setCanDelete(can(access.permissions, "company_bank_accounts", "delete"));

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const response = await fetch(`/api/company-bank-accounts/${accountId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to load bank account.");
      }

      const accountData = result.account;

      setAccount(accountData);

      if (accountData.company_id) {
        const { data: companyData, error: companyError } = await supabase
          .from("companies")
          .select("id, company_name, company_code")
          .eq("id", accountData.company_id)
          .maybeSingle();

        if (companyError) throw companyError;

        setCompany(companyData);
      }
    } catch (error: any) {
      setMessage(error.message || "Failed to load bank account.");
    } finally {
      setLoading(false);
    }
  }

  async function deleteAccount() {
    const confirmed = window.confirm(
      `Delete bank account "${account?.bank_name || "Bank Account"}"? It will be marked as deleted and hidden from active use.`
    );

    if (!confirmed) return;

    try {
      setMessage("");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const response = await fetch(`/api/company-bank-accounts/${accountId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to delete bank account.");
      }

      window.location.href = "/company-bank-accounts";
    } catch (error: any) {
      setMessage(error.message || "Failed to delete bank account.");
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading bank account...</p>;
  }

  if (message) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {message}
      </div>
    );
  }

  if (!account) {
    return <p className="text-red-600">Bank account not found.</p>;
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <Building2 className="h-3.5 w-3.5" />
            Master Setup
          </div>

          <h1 className="text-3xl font-bold text-slate-950">
            {account.bank_name}
          </h1>
          <p className="text-sm text-slate-500">
            Company bank account details.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/company-bank-accounts"
            className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          {canEdit && (
            <Link
              href={`/company-bank-accounts/${account.id}/edit`}
              className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-white px-4 py-2 text-sm font-medium text-sky-700 hover:bg-sky-50"
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Link>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={deleteAccount}
              className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          )}
        </div>
      </div>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold text-slate-950">
          Account Information
        </h2>

        <div className="grid gap-4 md:grid-cols-3">
          <Info label="Company" value={company?.company_name || "-"} />
          <Info label="Company Code" value={company?.company_code || "-"} />
          <Info label="Bank Name" value={account.bank_name || "-"} />
          <Info label="Account Number" value={maskAccount(account.account_number)} />
          <Info label="IFSC" value={account.ifsc || "-"} />
          <Info label="Default Account" value={account.is_default ? "Yes" : "No"} />
          <Info label="Status" value={account.status || "active"} />
          <Info
            label="Created At"
            value={
              account.created_at
                ? new Date(account.created_at).toLocaleString()
                : "-"
            }
          />
        </div>
      </section>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 font-medium text-slate-950">{value}</p>
    </div>
  );
}
