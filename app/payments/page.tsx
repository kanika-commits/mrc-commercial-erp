"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CreditCard, Plus, Search, Trash2, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import { formatIstTimestamp } from "@/lib/dateTime";
import { recordClientAuditEvent } from "@/lib/clientAudit";
import type { PaymentRegisterFilters } from "@/lib/payments/paymentGrid";
import { formatPaymentDate } from "@/lib/payments/formatPaymentDate";

const PAGE_SIZE = 50;
const EMPTY_FILTER_OPTIONS = { companies: [], paymentTypes: [], parties: [], accounts: [], creators: [] };

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
}

function formatDateTime(value: string | null | undefined) {
  return formatIstTimestamp(value);
}

export default function PaymentsPage() {
  const { access } = useAccessContext();
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = String(searchParams.get("q") || "").trim();

  const [payments, setPayments] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [deletePayment, setDeletePayment] = useState<any | null>(null);
  const [deletionReason, setDeletionReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [filters, setFilters] = useState<PaymentRegisterFilters>({});
  const [filterOptions, setFilterOptions] = useState<any>(EMPTY_FILTER_OPTIONS);

  const canDelete = can(access?.permissions || [], "payments", "delete");

  useEffect(() => {
    loadPayments();
  }, [page, search, filters]);

  async function loadPayments() {
    try {
      setLoading(true);
      setError("");
      setMessage("");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Please sign in again to view payments.");
      }

      const params = new URLSearchParams({
        page: String(page + 1),
        page_size: String(PAGE_SIZE),
      });

      if (search) {
        params.set("search", search);
      }
      if (filters.companyId) params.set("company_id", filters.companyId);
      if (filters.paymentType) params.set("payment_type", filters.paymentType);
      if (filters.party) params.set("party", filters.party);
      if (filters.fromAccount) params.set("from_account", filters.fromAccount);
      if (filters.dateFrom) params.set("date_from", filters.dateFrom);
      if (filters.dateTo) params.set("date_to", filters.dateTo);
      if (filters.createdBy) params.set("created_by", filters.createdBy);

      const response = await fetch(`/api/payments/register?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to load payments.");
      }

      setPayments(result.rows || []);
      setTotal(Number(result.total || 0));
      setFilterOptions(result.filter_options || EMPTY_FILTER_OPTIONS);
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

      await loadPayments();
      setDeletePayment(null);
      setDeletionReason("");
      setMessage("Payment deleted successfully.");
    } catch (deleteError: any) {
      setMessage(deleteError.message || "Failed to delete payment.");
    } finally {
      setDeleting(false);
    }
  }

  const hasNextPage = (page + 1) * PAGE_SIZE < total;
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE + payments.length, total);
  const visiblePayments = payments;

  function updateFilter<Key extends keyof PaymentRegisterFilters>(key: Key, value: PaymentRegisterFilters[Key]) {
    setPage(0);
    setFilters((current) => ({ ...current, [key]: value || undefined }));
  }

  function clearFilters() {
    setFilters({});
    setPage(0);
    if (search) router.replace("/payments");
  }

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
                Showing {rangeStart}–{rangeEnd} of {total} matching payments
              </p>
            </div>

            <form className="relative" action="/payments">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                name="q"
                defaultValue={search}
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white sm:w-80"
                placeholder="Search payments..."
              />
            </form>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-7">
            <label className="text-xs font-semibold text-slate-600">
              Company
              <select value={filters.companyId || ""} onChange={(event) => updateFilter("companyId", event.target.value)} className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-normal text-slate-800 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-100">
                <option value="">All Companies</option>
                {filterOptions.companies.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Payment Against
              <select value={filters.paymentType || ""} onChange={(event) => updateFilter("paymentType", event.target.value)} className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-normal text-slate-800 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-100">
                <option value="">All Types</option>
                {filterOptions.paymentTypes.map((value: string) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Vendor / Party
              <select value={filters.party || ""} onChange={(event) => updateFilter("party", event.target.value)} className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-normal text-slate-800 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-100">
                <option value="">All Parties</option>
                {filterOptions.parties.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600">
              From Account
              <select value={filters.fromAccount || ""} onChange={(event) => updateFilter("fromAccount", event.target.value)} className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-normal text-slate-800 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-100">
                <option value="">All Accounts</option>
                {filterOptions.accounts.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600">Date From<input type="date" value={filters.dateFrom || ""} onChange={(event) => updateFilter("dateFrom", event.target.value)} className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-normal text-slate-800 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-100" /></label>
            <label className="text-xs font-semibold text-slate-600">Date To<input type="date" value={filters.dateTo || ""} onChange={(event) => updateFilter("dateTo", event.target.value)} className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-normal text-slate-800 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-100" /></label>
            <label className="text-xs font-semibold text-slate-600">
              Created By
              <select value={filters.createdBy || ""} onChange={(event) => updateFilter("createdBy", event.target.value)} className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-normal text-slate-800 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-100">
                <option value="">All Users</option>
                {filterOptions.creators.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <div className="flex items-end xl:col-span-7 xl:justify-end">
              <button type="button" onClick={clearFilters} className="h-9 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Clear Filters</button>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">Search and filters apply across all matching payments within your accessible organization scope.</p>
        </div>

        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full min-w-[1350px] text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_#e2e8f0]">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">S. No.</th>
                <th className="px-4 py-3 text-left font-semibold">Payment Date</th>
                <th className="px-4 py-3 text-left font-semibold">Payment Against</th>
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
              {visiblePayments.map((payment, index) => {
                const createdBy = payment.created_by_display || payment.created_by_name || payment.created_by_email || "-";

                return (
                  <tr key={payment.id} className={`transition hover:bg-sky-50/60 ${index % 2 ? "bg-slate-50/50" : "bg-white"}`}>
                    <td className="whitespace-nowrap border-r border-slate-100 px-3 py-2.5 font-medium text-slate-950">
                      {page * PAGE_SIZE + index + 1}
                    </td>
                    <td className="whitespace-nowrap border-r border-slate-100 px-3 py-2.5 text-slate-700">
                      {formatPaymentDate(payment.payment_date)}
                    </td>
                    <td className="border-r border-slate-100 px-3 py-2.5 text-slate-700">
                      {payment.payment_type || "-"}
                    </td>
                    <td className="max-w-64 border-r border-slate-100 px-3 py-2.5 text-slate-700" title={payment.reference || "-"}>
                      <div className="truncate">{payment.reference || "-"}</div>
                      {payment.payment_type === "Purchase Order" && (
                        <div className="mt-0.5 truncate text-[11px] text-slate-500" title={payment.site_name || "Site not recorded"}>
                          {payment.purchase_order_source || "Purchase Order"}{payment.site_name ? ` · ${payment.site_code ? `${payment.site_code} — ` : ""}${payment.site_name}` : ""}
                        </div>
                      )}
                    </td>
                    <td className="max-w-56 truncate border-r border-slate-100 px-3 py-2.5 text-slate-700" title={payment.party || "-"}>{payment.party || "-"}</td>
                    <td className="max-w-52 truncate border-r border-slate-100 px-3 py-2.5 text-slate-700" title={payment.account_name || "-"}>{payment.account_name || "-"}</td>
                    <td className="whitespace-nowrap border-r border-slate-100 px-3 py-2.5 text-right font-semibold tabular-nums text-slate-950">
                      {money(payment.total_payment)}
                    </td>
                    <td className="whitespace-nowrap border-r border-slate-100 px-3 py-2.5 text-right tabular-nums text-slate-700">
                      {money(payment.tds_amount)}
                    </td>
                    <td className="whitespace-nowrap border-r border-slate-100 px-3 py-2.5 text-right font-semibold tabular-nums text-slate-950">
                      {money(payment.transferred_amount || payment.payment_amount)}
                    </td>
                    <td className="border-r border-slate-100 px-3 py-2.5 text-slate-700">{createdBy}</td>
                    <td className="whitespace-nowrap border-r border-slate-100 px-3 py-2.5 text-slate-700">
                      {formatDateTime(payment.created_at_user || payment.created_at)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-center">
                      <div className="flex justify-center gap-2">
                        <Link
                          href={`/payments/${payment.id}`}
                          onClick={() => recordClientAuditEvent({ eventType: "view_record", entityType: "payment", recordId: payment.id, source: "payments_register" })}
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
                    No payments on this page match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={() => setPage((prev) => Math.max(prev - 1, 0))}
            disabled={page === 0}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>

          <p className="text-sm text-slate-500">Page {page + 1}</p>

          <button
            type="button"
            onClick={() => setPage((prev) => prev + 1)}
            disabled={!hasNextPage}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
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
