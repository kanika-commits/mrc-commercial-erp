import Link from "next/link";
import { CreditCard, Plus, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
}

function accountLabel(account: any) {
  if (!account) return "-";

  const last4 = account.account_number
    ? account.account_number.slice(-4)
    : "----";

  return `${account.bank_name || "Bank"} | ${last4}`;
}

export default async function PaymentsPage() {
  const { data: payments, error } = await supabase
    .from("payments")
    .select(`
      id,
      organization_id,
      company_id,
      work_order_id,
      vendor_id,
      company_bank_account_id,
      payment_number,
      payment_date,
      payment_type,
      reference_number,
      total_payment,
      tds_amount,
      transferred_amount,
      payment_amount,
      payment_mode,
      utr_number,
      status,
      remarks,
      created_at
    `)
    .order("payment_date", { ascending: false });

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Failed to load payments: {error.message}
      </div>
    );
  }

  const workOrderIds = Array.from(
    new Set((payments || []).map((p: any) => p.work_order_id).filter(Boolean))
  );

  const vendorIds = Array.from(
    new Set((payments || []).map((p: any) => p.vendor_id).filter(Boolean))
  );

  const companyIds = Array.from(
    new Set((payments || []).map((p: any) => p.company_id).filter(Boolean))
  );

  const accountIds = Array.from(
    new Set(
      (payments || [])
        .map((p: any) => p.company_bank_account_id)
        .filter(Boolean)
    )
  );

  const { data: workOrders } = workOrderIds.length
    ? await supabase
        .from("work_orders")
        .select("id, wo_number, company_id, site_id")
        .in("id", workOrderIds)
    : { data: [] };

  const { data: vendors } = vendorIds.length
    ? await supabase
        .from("vendors")
        .select("id, vendor_name")
        .in("id", vendorIds)
    : { data: [] };

  const { data: companies } = companyIds.length
    ? await supabase
        .from("companies")
        .select("id, company_name, company_code")
        .in("id", companyIds)
    : { data: [] };

  const { data: accounts } = accountIds.length
    ? await supabase
        .from("company_bank_accounts")
        .select("id, bank_name, account_number")
        .in("id", accountIds)
    : { data: [] };

  const woMap = new Map((workOrders || []).map((wo: any) => [wo.id, wo]));
  const vendorMap = new Map(
    (vendors || []).map((vendor: any) => [vendor.id, vendor.vendor_name])
  );
  const companyMap = new Map(
    (companies || []).map((company: any) => [company.id, company])
  );
  const accountMap = new Map(
    (accounts || []).map((account: any) => [account.id, account])
  );

  const paymentCount = payments?.length || 0;

  const totalPaid = (payments || []).reduce(
    (sum: number, p: any) => sum + Number(p.total_payment || 0),
    0
  );

  const totalTds = (payments || []).reduce(
    (sum: number, p: any) => sum + Number(p.tds_amount || 0),
    0
  );

  const totalTransferred = (payments || []).reduce(
    (sum: number, p: any) =>
      sum + Number(p.transferred_amount || p.payment_amount || 0),
    0
  );

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <CreditCard className="h-3.5 w-3.5" />
            Payment Register
          </div>

          <h1 className="text-3xl font-bold text-slate-950">Payments</h1>
          <p className="text-sm text-slate-500">
            Company-wise payment register for daily accounts tracking.
          </p>
        </div>

        <Link
          href="/payments/new"
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
          New Payment
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Summary title="Payments Count" value={String(paymentCount)} />
        <Summary title="Total Paid" value={money(totalPaid)} />
        <Summary title="Total TDS" value={money(totalTds)} />
        <Summary title="Net Transferred" value={money(totalTransferred)} />
      </div>

      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="border-b p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-950">
                Payment Register
              </h2>
              <p className="text-xs text-slate-500">
                Date-wise payments with company, reference, party and account.
              </p>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                className="h-10 w-72 rounded-xl border bg-white pl-9 pr-3 text-sm outline-none focus:border-slate-400"
                placeholder="Search company, vendor, payment..."
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3 text-left">Date</th>
                <th className="p-3 text-left">Company</th>
                <th className="p-3 text-left">Type</th>
                <th className="p-3 text-left">Reference</th>
                <th className="p-3 text-left">Vendor / Party</th>
                <th className="p-3 text-left">From Account</th>
                <th className="p-3 text-right">Total</th>
                <th className="p-3 text-right">TDS</th>
                <th className="p-3 text-right">Transferred</th>
                <th className="p-3 text-center">Action</th>
              </tr>
            </thead>

            <tbody>
              {payments?.map((payment: any) => {
                const wo = payment.work_order_id
                  ? woMap.get(payment.work_order_id)
                  : null;

                const vendorName = payment.vendor_id
                  ? vendorMap.get(payment.vendor_id)
                  : "-";

                const company = payment.company_id
                  ? companyMap.get(payment.company_id)
                  : null;

                const account = payment.company_bank_account_id
                  ? accountMap.get(payment.company_bank_account_id)
                  : null;

                const reference =
                  payment.payment_type === "Work Order"
                    ? wo?.wo_number || payment.reference_number || "-"
                    : payment.reference_number || "-";

                const party =
                  payment.payment_type === "Internal Transfer"
                    ? "Internal Transfer"
                    : vendorName || "-";

                return (
                  <tr key={payment.id} className="border-t hover:bg-slate-50">
                    <td className="p-3">{payment.payment_date || "-"}</td>

                    <td className="p-3">
                      <div className="font-medium text-slate-950">
                        {company?.company_name || "-"}
                      </div>
                      <div className="text-xs text-slate-500">
                        {company?.company_code || ""}
                      </div>
                    </td>

                    <td className="p-3">{payment.payment_type || "-"}</td>

                    <td className="p-3 font-medium">
                      {payment.work_order_id ? (
                        <Link
                          href={`/work-orders/${payment.work_order_id}`}
                          className="text-blue-600 hover:underline"
                        >
                          {reference}
                        </Link>
                      ) : (
                        reference
                      )}
                    </td>

                    <td className="p-3">{party}</td>

                    <td className="p-3">{accountLabel(account)}</td>

                    <td className="p-3 text-right font-semibold">
                      {money(payment.total_payment)}
                    </td>

                    <td className="p-3 text-right">
                      {money(payment.tds_amount)}
                    </td>

                    <td className="p-3 text-right font-semibold">
                      {money(
                        payment.transferred_amount || payment.payment_amount
                      )}
                    </td>

                    <td className="p-3 text-center">
                      <Link
                        href={`/payments/${payment.id}`}
                        className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}

              {payments?.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-500">
                    No payments found.
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