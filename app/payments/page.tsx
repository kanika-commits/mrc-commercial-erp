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

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";

  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  const params = searchParams ? await searchParams : {};
  const search = String(params.q || "").trim();
  const normalizedSearch = search.toLowerCase();

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
      created_by_name,
      created_by_email,
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

  const enrichedPayments = (payments || []).map((payment: any) => {
    const wo = payment.work_order_id ? woMap.get(payment.work_order_id) : null;
    const vendorName = payment.vendor_id
      ? vendorMap.get(payment.vendor_id)
      : "-";
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
    const accountName = accountLabel(account);
    const searchText = [
      party,
      reference,
      payment.utr_number,
      payment.reference_number,
      payment.payment_number,
      accountName,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return {
      payment,
      reference,
      party,
      accountName,
      visible: !normalizedSearch || searchText.includes(normalizedSearch),
    };
  });

  const visiblePayments = enrichedPayments.filter((row) => row.visible);

  const paymentCount = visiblePayments.length;

  const totalPaid = visiblePayments.reduce(
    (sum: number, row: any) => sum + Number(row.payment.total_payment || 0),
    0
  );

  const totalTds = visiblePayments.reduce(
    (sum: number, row: any) => sum + Number(row.payment.tds_amount || 0),
    0
  );

  const totalTransferred = visiblePayments.reduce(
    (sum: number, row: any) =>
      sum +
      Number(row.payment.transferred_amount || row.payment.payment_amount || 0),
    0
  );

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
            <CreditCard className="h-3.5 w-3.5" />
            Payment Register
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-slate-950">
            Payments
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Company-wise payment register for daily accounts tracking.
          </p>
        </div>

        <Link
          href="/payments/new"
          className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
          New Payment
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Summary title="Total Payments" value={money(totalPaid)} />
        <Summary title="Total TDS" value={money(totalTds)} />
        <Summary title="Total Transferred" value={money(totalTransferred)} />
        <Summary title="Payment Count" value={String(paymentCount)} />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">
                Payment Register
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Date-wise payments with company, reference, party and account.
              </p>
            </div>

            <form className="relative" action="/payments">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                name="q"
                defaultValue={search}
                className="h-10 w-80 rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white"
                placeholder="Search vendor, reference, UTR, account..."
              />
            </form>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1500px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Payment Date</th>
                <th className="px-4 py-3 text-left font-semibold">Reference / UTR</th>
                <th className="px-4 py-3 text-left font-semibold">Vendor / Party</th>
                <th className="px-4 py-3 text-left font-semibold">Invoice / Reference</th>
                <th className="px-4 py-3 text-left font-semibold">From Account</th>
                <th className="px-4 py-3 text-right font-semibold">Total Payment</th>
                <th className="px-4 py-3 text-right font-semibold">TDS Amount</th>
                <th className="px-4 py-3 text-right font-semibold">Transferred Amount</th>
                <th className="px-4 py-3 text-left font-semibold">Payment Mode</th>
                <th className="px-4 py-3 text-left font-semibold">Remarks</th>
                <th className="px-4 py-3 text-left font-semibold">Created By</th>
                <th className="px-4 py-3 text-left font-semibold">Created At</th>
                <th className="px-4 py-3 text-center font-semibold">Action</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {visiblePayments.map(({ payment, reference, party, accountName }) => {
                const createdBy =
                  payment.created_by_name || payment.created_by_email || "-";
                return (
                  <tr key={payment.id} className="transition hover:bg-slate-50">
                    <td className="px-4 py-4 text-slate-700">
                      {payment.payment_date || "-"}
                    </td>
                    <td className="px-4 py-4 font-medium text-slate-950">
                      {payment.utr_number || payment.reference_number || "-"}
                    </td>
                    <td className="px-4 py-4 text-slate-700">{party}</td>
                    <td className="px-4 py-4 text-slate-700">
                      {reference}
                    </td>
                    <td className="px-4 py-4 text-slate-700">
                      {accountName}
                    </td>
                    <td className="px-4 py-4 text-right font-semibold text-slate-950">
                      {money(payment.total_payment)}
                    </td>
                    <td className="px-4 py-4 text-right text-slate-700">
                      {money(payment.tds_amount)}
                    </td>
                    <td className="px-4 py-4 text-right font-semibold text-slate-950">
                      {money(
                        payment.transferred_amount || payment.payment_amount
                      )}
                    </td>
                    <td className="px-4 py-4 text-slate-700">
                      {payment.payment_mode || "-"}
                    </td>
                    <td className="max-w-[220px] px-4 py-4 text-slate-700">
                      <div className="line-clamp-2">{payment.remarks || "-"}</div>
                    </td>
                    <td className="px-4 py-4 text-slate-700">{createdBy}</td>
                    <td className="px-4 py-4 text-slate-700">
                      {formatDateTime(payment.created_at)}
                    </td>
                    <td className="px-4 py-4 text-center">
                      <Link
                        href={`/payments/${payment.id}`}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}

              {visiblePayments.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-4 py-12 text-center text-slate-500">
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
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </p>
      <p className="mt-2 text-2xl font-bold tracking-tight text-slate-950">
        {value}
      </p>
    </div>
  );
}
