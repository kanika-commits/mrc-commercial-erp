"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Building2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

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

  useEffect(() => {
    loadAccount();
  }, [accountId]);

  async function loadAccount() {
    try {
      setLoading(true);
      setMessage("");

      const { data: accountData, error: accountError } = await supabase
        .from("company_bank_accounts")
        .select("*")
        .eq("id", accountId)
        .single();

      if (accountError) throw accountError;

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

        <Link
          href="/company-bank-accounts"
          className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
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