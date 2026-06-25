"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CreditCard, Plus, Search, Trash2, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import { formatIstTimestamp } from "@/lib/dateTime";

const PAGE_SIZE = 50;

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
}

function formatDateTime(value: string | null | undefined) {
  return formatIstTimestamp(value);
}

export default function PaymentsPage() {
  const { access } = useAccessContext();
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

  const canDelete = can(access?.permissions || [], "payments", "delete");

  useEffect(() => {
    loadPayments();
  }, [page, search]);

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
                Showing {rangeStart}–{rangeEnd} of {total}
              </p>
            </div>

            <form className="relative" action="/payments">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                name="q"
                defaultValue={search}
                className="h-10 w-80 rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white"
                placeholder="Search payments..."
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
              {payments.map((payment, index) => {
                const createdBy =
                  payment.created_by_email || payment.created_by_name || "-";

                return (
                  <tr key={payment.id} className="transition hover:bg-slate-50">
                    <td className="px-4 py-4 font-medium text-slate-950">
                      {page * PAGE_SIZE + index + 1}
                    </td>
                    <td className="px-4 py-4 text-slate-700">
                      {payment.payment_date || "-"}
                    </td>
                    <td className="px-4 py-4 text-slate-700">
                      {payment.payment_type || "-"}
                    </td>
                    <td className="px-4 py-4 text-slate-700">{payment.reference || "-"}</td>
                    <td className="px-4 py-4 text-slate-700">{payment.party || "-"}</td>
                    <td className="px-4 py-4 text-slate-700">{payment.account_name || "-"}</td>
                    <td className="px-4 py-4 text-right font-semibold text-slate-950">
                      {money(payment.total_payment)}
                    </td>
                    <td className="px-4 py-4 text-right text-slate-700">
                      {money(payment.tds_amount)}
                    </td>
                    <td className="px-4 py-4 text-right font-semibold text-slate-950">
                      {money(payment.transferred_amount || payment.payment_amount)}
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

              {payments.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-slate-500">
                    No payments found.
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
