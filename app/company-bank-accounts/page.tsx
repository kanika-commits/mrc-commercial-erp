export const dynamic = "force-dynamic";

import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import { companySortPriority } from "@/lib/companyOrdering";

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

function maskAccount(value?: string | null) {
  if (!value) return "-";
  const last4 = value.slice(-4);
  return `****${last4}`;
}

export default async function CompanyBankAccountsPage() {
  const supabase = adminClient();
  const { data: accounts, error } = await supabase
    .from("company_bank_accounts")
    .select(`
      id,
      company_id,
      bank_name,
      account_number,
      ifsc,
      is_default,
      status,
      created_at
    `)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Failed to load bank accounts: {error.message}
      </div>
    );
  }

  const companyIds = Array.from(
    new Set((accounts || []).map((a: any) => a.company_id).filter(Boolean))
  );

  const { data: companies } = companyIds.length
    ? await supabase
        .from("companies")
        .select("id, company_name, company_code")
        .in("id", companyIds)
    : { data: [] };

  const companyMap = new Map(
    (companies || []).map((company: any) => [company.id, company])
  );
  const sortedAccounts = [...(accounts || [])].sort((a: any, b: any) => {
    const companyA = a.company_id ? companyMap.get(a.company_id) : null;
    const companyB = b.company_id ? companyMap.get(b.company_id) : null;
    const companyDiff =
      companySortPriority(companyA || {}) - companySortPriority(companyB || {});

    if (companyDiff !== 0) return companyDiff;

    return String(a.bank_name || "").localeCompare(String(b.bank_name || ""));
  });

  const activeCount =
    sortedAccounts.filter((item: any) => item.status === "active").length || 0;

  const defaultCount =
    sortedAccounts.filter((item: any) => item.is_default === true).length || 0;

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

        <Link
          href="/company-bank-accounts/new"
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
          New Bank Account
        </Link>
      </div>

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
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>

            <tbody>
              {sortedAccounts.map((account: any) => {
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

                    <td className="p-3 font-medium">
                      {account.bank_name || "-"}
                    </td>

                    <td className="p-3">{maskAccount(account.account_number)}</td>
                    <td className="p-3">{account.ifsc || "-"}</td>
                    <td className="p-3">{account.is_default ? "Yes" : "No"}</td>
                    <td className="p-3">{account.status || "active"}</td>

                    <td className="p-3 text-right">
                      <Link
                        href={`/company-bank-accounts/${account.id}`}
                        className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}

              {sortedAccounts.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    No bank accounts found.
                  </td>
                </tr>
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
