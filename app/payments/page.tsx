"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CreditCard, Plus, Search, Trash2, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { can, getCurrentUserAccess } from "@/lib/accessControl";

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
}

function accountLabel(account: any) {
  if (!account) return "-";

  const accountNumber = account.account_number ? String(account.account_number) : "";
  const last4 = accountNumber
    ? accountNumber.slice(-4)
    : "----";

  return `${account.bank_name || "Bank"} • ****${last4}`;
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

export default function PaymentsPage() {
  const searchParams = useSearchParams();
  const search = String(searchParams.get("q") || "").trim();
  const normalizedSearch = search.toLowerCase();
  const [payments, setPayments] = useState<any[]>([]);
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [canDelete, setCanDelete] = useState(false);
  const [deletePayment, setDeletePayment] = useState<any | null>(null);
  const [deletionReason, setDeletionReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadAccess();
    loadPayments();
  }, []);

  async function loadAccess() {
    const access = await getCurrentUserAccess();
    setCanDelete(can(access.permissions, "payments", "delete"));
  }

  async function loadPayments() {
    try {
      setLoading(true);
      setError("");
      setMessage("");

      const { data: paymentData, error: paymentError } = await supabase
        .from("payments")
        .select(`
          id,
          organization_id,
          company_id,
          work_order_id,
          invoice_id,
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
          created_at_user,
          created_at
        `)
        .order("payment_date", { ascending: false });

      if (paymentError) throw paymentError;

      const loadedPayments = paymentData || [];
      setPayments(loadedPayments);

      const workOrderIds = Array.from(
        new Set(loadedPayments.map((p: any) => p.work_order_id).filter(Boolean))
      );
      const vendorIds = Array.from(
        new Set(loadedPayments.map((p: any) => p.vendor_id).filter(Boolean))
      );
      const invoiceIds = Array.from(
        new Set(loadedPayments.map((p: any) => p.invoice_id).filter(Boolean))
      );
      const accountIds = Array.from(
        new Set(
          loadedPayments
            .map((p: any) => p.company_bank_account_id)
            .filter(Boolean)
        )
      );

      const [
        { data: workOrderData },
        { data: invoiceData },
        { data: vendorData },
      ] =
        await Promise.all([
          workOrderIds.length
            ? supabase
                .from("work_orders")
                .select("id, wo_number, company_id, site_id")
                .in("id", workOrderIds)
            : Promise.resolve({ data: [] }),
          invoiceIds.length
            ? supabase
                .from("invoices")
                .select("id, invoice_number")
                .in("id", invoiceIds)
            : Promise.resolve({ data: [] }),
          vendorIds.length
            ? supabase
                .from("vendors")
                .select("id, vendor_name")
                .in("id", vendorIds)
            : Promise.resolve({ data: [] }),
        ]);

      let accountData: any[] = [];

      if (accountIds.length) {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session?.access_token) {
          const response = await fetch(
            "/api/company-bank-accounts?include_deleted=true",
            {
              headers: {
                Authorization: `Bearer ${session.access_token}`,
              },
            }
          );

          if (response.ok) {
            const result = await response.json();
            const accountIdSet = new Set(accountIds);
            accountData = (result.accounts || []).filter((account: any) =>
              accountIdSet.has(account.id)
            );
          }
        }

        if (!accountData.length) {
          const { data: browserAccountData } = await supabase
            .from("company_bank_accounts")
            .select("id, bank_name, account_number")
            .in("id", accountIds);

          accountData = browserAccountData || [];
        }
      }

      setWorkOrders(workOrderData || []);
      setInvoices(invoiceData || []);
      setVendors(vendorData || []);
      setAccounts(accountData || []);
    } catch (loadError: any) {
      setError(loadError.message || "Failed to load payments.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmDelete() {
    if (!deletePayment) return;

    const reason = deletionReason.trim();

    if (reason.length < 10) {
      setMessage("Deletion reason must be at least 10 characters.");
      return;
    }

    try {
      setDeleting(true);
      setMessage("");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Please sign in again to delete this payment.");
      }

      const response = await fetch(
        `/api/payments?payment_id=${encodeURIComponent(deletePayment.id)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ deletion_reason: reason }),
        }
      );
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to delete payment.");
      }

      setPayments((prev) =>
        prev.filter((payment) => payment.id !== deletePayment.id)
      );
      setDeletePayment(null);
      setDeletionReason("");
      setMessage("Payment deleted successfully.");
    } catch (deleteError: any) {
      setMessage(deleteError.message || "Failed to delete payment.");
    } finally {
      setDeleting(false);
    }
  }

  const enrichedPayments = useMemo(() => {
    const woMap = new Map((workOrders || []).map((wo: any) => [wo.id, wo]));
    const invoiceMap = new Map(
      (invoices || []).map((invoice: any) => [invoice.id, invoice])
    );
    const vendorMap = new Map(
      (vendors || []).map((vendor: any) => [vendor.id, vendor.vendor_name])
    );
    const accountMap = new Map(
      (accounts || []).map((account: any) => [account.id, account])
    );

    return payments.map((payment: any) => {
      const wo = payment.work_order_id ? woMap.get(payment.work_order_id) : null;
      const invoice = payment.invoice_id
        ? invoiceMap.get(payment.invoice_id)
        : null;
      const vendorName = payment.vendor_id
        ? vendorMap.get(payment.vendor_id)
        : "-";
      const account = payment.company_bank_account_id
        ? accountMap.get(payment.company_bank_account_id)
        : null;
      const reference =
        payment.payment_type === "Work Order"
          ? wo?.wo_number || payment.reference_number || "-"
          : payment.payment_type === "Invoice"
          ? invoice?.invoice_number || payment.reference_number || "-"
          : payment.reference_number || "-";
      const party =
        payment.payment_type === "Internal Transfer"
          ? "Internal Transfer"
          : vendorName || "-";
      const accountName = accountLabel(account);
      const searchText = [
        party,
        reference,
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
  }, [accounts, invoices, normalizedSearch, payments, vendors, workOrders]);

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

  if (loading) {
    return <p className="text-sm text-slate-500">Loading payments...</p>;
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Failed to load payments: {error}
      </div>
    );
  }

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

      {message && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm font-medium text-sky-800">
          {message}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">
                Payment Register
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Date-wise payments with payment reference, party and account.
              </p>
            </div>

            <form className="relative" action="/payments">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                name="q"
                defaultValue={search}
                className="h-10 w-80 rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white"
                placeholder="Search vendor, reference, payment no, account..."
              />
            </form>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1350px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">S. No.</th>
                <th className="px-4 py-3 text-left font-semibold">Payment Date</th>
                <th className="px-4 py-3 text-left font-semibold">Payment Type</th>
                <th className="px-4 py-3 text-left font-semibold">Reference</th>
                <th className="px-4 py-3 text-left font-semibold">Vendor / Party</th>
                <th className="px-4 py-3 text-left font-semibold">From Account</th>
                <th className="px-4 py-3 text-right font-semibold">Total Payment</th>
                <th className="px-4 py-3 text-right font-semibold">TDS</th>
                <th className="px-4 py-3 text-right font-semibold">Transferred</th>
                <th className="px-4 py-3 text-left font-semibold">Created By</th>
                <th className="px-4 py-3 text-left font-semibold">Created At</th>
                <th className="px-4 py-3 text-center font-semibold">Action</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {visiblePayments.map(({ payment, reference, party, accountName }, index) => {
                const createdBy =
                  payment.created_by_email || payment.created_by_name || "-";
                return (
                  <tr key={payment.id} className="transition hover:bg-slate-50">
                    <td className="px-4 py-4 font-medium text-slate-950">
                      {index + 1}
                    </td>
                    <td className="px-4 py-4 text-slate-700">
                      {payment.payment_date || "-"}
                    </td>
                    <td className="px-4 py-4 text-slate-700">
                      {payment.payment_type || "-"}
                    </td>
                    <td className="px-4 py-4 text-slate-700">{reference}</td>
                    <td className="px-4 py-4 text-slate-700">{party}</td>
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
                    <td className="px-4 py-4 text-slate-700">{createdBy}</td>
                    <td className="px-4 py-4 text-slate-700">
                      {formatDateTime(payment.created_at_user || payment.created_at)}
                    </td>
                    <td className="px-4 py-4 text-center">
                      <div className="flex justify-center gap-2">
                        <Link
                          href={`/payments/${payment.id}`}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                        >
                          View
                        </Link>

                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => {
                              setDeletePayment(payment);
                              setDeletionReason("");
                              setMessage("");
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {visiblePayments.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-slate-500">
                    No payments found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {deletePayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-950">
                  Delete Payment
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  This will hard delete payment{" "}
                  <span className="font-semibold text-slate-950">
                    {deletePayment.payment_number ||
                      deletePayment.reference_number ||
                      deletePayment.utr_number ||
                      "-"}
                  </span>{" "}
                  after saving an audit snapshot.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setDeletePayment(null);
                  setDeletionReason("");
                }}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                disabled={deleting}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mt-5 block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Deletion Reason
              </span>
              <textarea
                value={deletionReason}
                onChange={(event) => setDeletionReason(event.target.value)}
                className="min-h-28 w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
                placeholder="Enter why this payment is being deleted..."
                disabled={deleting}
              />
            </label>

            <p className="mt-2 text-xs text-slate-500">
              Minimum 10 characters required.
            </p>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setDeletePayment(null);
                  setDeletionReason("");
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting || deletionReason.trim().length < 10}
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete Payment"}
              </button>
            </div>
          </div>
        </div>
      )}
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
