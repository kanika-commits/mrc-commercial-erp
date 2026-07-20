"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileText, Plus, Search, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import { formatIstTimestamp } from "@/lib/dateTime";

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
}

function formatDateTime(value: string | null | undefined) {
  return formatIstTimestamp(value);
}

function auditName(name?: string | null, email?: string | null) {
  return name || email || "-";
}

function statusClass(value?: string | null) {
  const status = String(value || "").toLowerCase();

  if (status === "claimed") return "border-green-200 bg-green-50 text-green-700";
  if (status === "pending") return "border-yellow-200 bg-yellow-50 text-yellow-700";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-700";

  return "border-slate-200 bg-slate-50 text-slate-700";
}

const PAGE_SIZE = 50;

export default function InvoicesPage() {
  const { access, loading: accessLoading } = useAccessContext();
  const searchParams = useSearchParams();
  const query = String(searchParams.get("q") || "").trim();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [rejectedInvoices, setRejectedInvoices] = useState<any[]>([]);
  const [totalInvoices, setTotalInvoices] = useState(0);
  const [rejectedTotal, setRejectedTotal] = useState(0);
  const [summary, setSummary] = useState({
    active_invoice_count: 0,
    pending_itc_count: 0,
    claimed_itc_count: 0,
    pending_itc_value: 0,
    rejected_invoice_count: 0,
  });
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState("");
  const [deleteInvoice, setDeleteInvoice] = useState<any | null>(null);
  const [deletionReason, setDeletionReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [activePage, setActivePage] = useState(1);

  useEffect(() => {
    setActivePage(1);
  }, [query]);

  useEffect(() => {
    if (!accessLoading && access) {
      loadInvoices();
    }
  }, [access, accessLoading, activePage, query]);

  const canDelete = can(access?.permissions || [], "invoices", "delete");

  async function loadInvoices() {
    try {
      if (invoices.length === 0) {
        setLoading(true);
      } else {
        setUpdating(true);
      }
      setMessage("");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const params = new URLSearchParams({
        page: String(activePage),
        page_size: String(PAGE_SIZE),
      });

      if (query) params.set("search", query);

      const response = await fetch(`/api/invoices/register?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to load invoices.");
      }

      setInvoices(result.rows || []);
      setRejectedInvoices(result.rejected_rows || []);
      setTotalInvoices(Number(result.total || 0));
      setRejectedTotal(Number(result.rejected_total || 0));
      setSummary({
        active_invoice_count: Number(result.summary?.active_invoice_count || 0),
        pending_itc_count: Number(result.summary?.pending_itc_count || 0),
        claimed_itc_count: Number(result.summary?.claimed_itc_count || 0),
        pending_itc_value: Number(result.summary?.pending_itc_value || 0),
        rejected_invoice_count: Number(result.summary?.rejected_invoice_count || 0),
      });
    } catch (error: any) {
      setMessage(error.message || "Failed to load invoices.");
    } finally {
      setLoading(false);
      setUpdating(false);
    }
  }

  async function confirmDelete() {
    if (!deleteInvoice) return;

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
        throw new Error("Please sign in again to delete this invoice.");
      }

      const response = await fetch(
        `/api/invoices?invoice_id=${encodeURIComponent(deleteInvoice.id)}`,
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
        throw new Error(result.error || "Failed to delete invoice.");
      }

      setInvoices((prev) =>
        prev.filter((invoice) => invoice.id !== deleteInvoice.id)
      );
      setDeleteInvoice(null);
      setDeletionReason("");
      setMessage("Invoice deleted successfully.");
      await loadInvoices();
    } catch (error: any) {
      setMessage(error.message || "Failed to delete invoice.");
    } finally {
      setDeleting(false);
    }
  }

  const activeTotalPages = Math.max(1, Math.ceil(totalInvoices / PAGE_SIZE));
  const currentActivePage = Math.min(activePage, activeTotalPages);
  const activeStartIndex = (currentActivePage - 1) * PAGE_SIZE;
  const activeEndIndex = Math.min(
    activeStartIndex + PAGE_SIZE,
    totalInvoices
  );
  const paginatedActiveInvoices = invoices;
  const activeRangeStart = totalInvoices === 0 ? 0 : activeStartIndex + 1;

  useEffect(() => {
    if (activePage > activeTotalPages) {
      setActivePage(activeTotalPages);
    }
  }, [activePage, activeTotalPages]);

  if (loading) {
    return <p className="text-sm text-slate-500">Loading invoices...</p>;
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
            <FileText className="h-3.5 w-3.5" />
            Invoice Coordination
          </div>

          <h1 className="text-3xl font-bold text-slate-950">Invoices</h1>
          <p className="text-sm text-slate-500">
            Approved invoices are shown separately from rejected invoices.
          </p>
        </div>

        <Link
          href="/invoices/new"
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
          New Invoice
        </Link>
      </div>

      {message && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {message}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Summary title="Active Invoices" value={String(summary.active_invoice_count)} />
        <Summary title="Pending ITC" value={String(summary.pending_itc_count)} />
        <Summary title="ITC Claimed" value={String(summary.claimed_itc_count)} />
        <Summary title="Pending ITC Value" value={money(summary.pending_itc_value)} />
      </div>

      {updating && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-medium text-blue-800">
          Updating invoices...
        </div>
      )}

      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="border-b p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-950">
                Invoice Register
              </h2>
              <p className="text-xs text-slate-500">
                Active invoice status and audit trail.
              </p>
            </div>

            <form className="flex flex-wrap items-center gap-2">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  name="q"
                  defaultValue={query}
                  className="h-10 w-72 rounded-xl border bg-white pl-9 pr-3 text-sm outline-none focus:border-slate-400"
                  placeholder="Search invoice no, WO, vendor..."
                />
              </label>
              <button
                type="submit"
                className="h-10 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Apply
              </button>
              {query && (
                <Link
                  href="/invoices"
                  className="inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <X className="h-4 w-4" />
                  Clear
                </Link>
              )}
            </form>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1420px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3 text-left">Invoice Number</th>
                <th className="p-3 text-left">WO Number</th>
                <th className="p-3 text-left">Vendor</th>
                <th className="p-3 text-left">Invoice Date</th>
                <th className="p-3 text-right">Taxable</th>
                <th className="p-3 text-right">GST</th>
                <th className="p-3 text-right">Total</th>
                <th className="p-3 text-left">ITC Status</th>
                <th className="p-3 text-left">Created By</th>
                <th className="p-3 text-left">Created At</th>
                <th className="p-3 text-left">ITC Claimed By</th>
                <th className="p-3 text-left">ITC Claimed At</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>

            <tbody>
              {paginatedActiveInvoices.map((invoice: any) => {
                const itcStatus = invoice.itc_status || "Pending";

                return (
                  <tr
                    key={invoice.id}
                    className="border-t align-top hover:bg-slate-50"
                  >
                    <td className="p-3 font-semibold text-slate-950">
                      {invoice.invoice_number}
                    </td>

                    <td className="p-3">
                      {invoice.work_order_id ? (
                        <Link
                          href={`/work-orders/${invoice.work_order_id}`}
                          className="text-blue-600 hover:underline"
                        >
                          {invoice.wo_number || "-"}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>

                    <td className="p-3">{invoice.vendor_name || "-"}</td>
                    <td className="p-3">{invoice.invoice_date || "-"}</td>

                    <td className="p-3 text-right font-semibold">
                      {money(invoice.taxable_amount)}
                    </td>

                    <td className="p-3 text-right">
                      {money(invoice.gst_amount)}
                    </td>

                    <td className="p-3 text-right font-semibold">
                      {money(invoice.invoice_amount)}
                    </td>

                    <td className="p-3">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(
                          itcStatus
                        )}`}
                      >
                        {itcStatus}
                      </span>
                    </td>

                    <td className="p-3">
                      <div className="max-w-[180px] truncate font-medium">
                        {auditName(
                          invoice.created_by_name,
                          invoice.created_by_email
                        )}
                      </div>
                      {invoice.created_by_name &&
                        invoice.created_by_email &&
                        invoice.created_by_name !== invoice.created_by_email && (
                          <div className="max-w-[180px] truncate text-xs text-slate-500">
                            {invoice.created_by_email}
                          </div>
                        )}
                    </td>

                    <td className="p-3 text-slate-700">
                      {formatDateTime(invoice.created_at)}
                    </td>

                    <td className="p-3">
                      <div className="max-w-[180px] truncate font-medium">
                        {auditName(
                          invoice.itc_claimed_by_name,
                          invoice.itc_claimed_by_email
                        )}
                      </div>
                      {invoice.itc_claimed_by_name &&
                        invoice.itc_claimed_by_email &&
                        invoice.itc_claimed_by_name !==
                          invoice.itc_claimed_by_email && (
                          <div className="max-w-[180px] truncate text-xs text-slate-500">
                            {invoice.itc_claimed_by_email}
                          </div>
                        )}
                    </td>

                    <td className="p-3 text-slate-700">
                      {formatDateTime(invoice.itc_claimed_at)}
                    </td>

                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="inline-flex justify-center rounded-xl border px-3 py-2 text-xs font-medium hover:bg-slate-50"
                        >
                          View
                        </Link>

                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteInvoice(invoice);
                              setDeletionReason("");
                              setMessage("");
                            }}
                            className="inline-flex items-center gap-1 rounded-xl border border-red-200 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50"
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

              {paginatedActiveInvoices.length === 0 && (
                <tr>
                  <td colSpan={13} className="p-8 text-center text-slate-500">
                    No active invoices found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <div>
            Showing {activeRangeStart}–{activeEndIndex} of {totalInvoices}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActivePage((page) => Math.max(1, page - 1))}
              disabled={currentActivePage <= 1}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() =>
                setActivePage((page) => Math.min(activeTotalPages, page + 1))
              }
              disabled={currentActivePage >= activeTotalPages}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {rejectedInvoices.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-white shadow-sm">
          <div className="border-b border-red-100 p-4">
            <h2 className="font-semibold text-red-700">
              Rejected Invoices ({rejectedTotal})
            </h2>
            <p className="text-xs text-slate-500">
              Rejected invoices are shown separately and are not included in
              invoice totals.
              {rejectedTotal > rejectedInvoices.length
                ? ` Showing latest ${rejectedInvoices.length}.`
                : ""}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-red-50 text-xs uppercase text-red-700">
                <tr>
                  <th className="p-3 text-left">Invoice Number</th>
                  <th className="p-3 text-left">WO Number</th>
                  <th className="p-3 text-left">Vendor</th>
                  <th className="p-3 text-left">Invoice Date</th>
                  <th className="p-3 text-right">Total</th>
                  <th className="p-3 text-left">Rejection Reason</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>

              <tbody>
                {rejectedInvoices.map((invoice: any) => {
                  return (
                    <tr key={invoice.id} className="border-t border-red-100">
                      <td className="p-3 font-semibold">
                        {invoice.invoice_number}
                      </td>
                      <td className="p-3">{invoice.wo_number || "-"}</td>
                      <td className="p-3">{invoice.vendor_name || "-"}</td>
                      <td className="p-3">{invoice.invoice_date || "-"}</td>
                      <td className="p-3 text-right font-semibold">
                        {money(invoice.invoice_amount)}
                      </td>
                      <td className="p-3">
                        <div className="max-w-[360px] rounded-lg bg-red-50 px-3 py-2 text-red-700">
                          {invoice.itc_rejection_reason || "-"}
                        </div>
                      </td>
                      <td className="p-3 text-right">
                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="inline-flex justify-center rounded-xl border px-3 py-2 text-xs font-medium hover:bg-slate-50"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {deleteInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-950">
                  Delete Invoice
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  This will hard delete invoice{" "}
                  <span className="font-semibold text-slate-950">
                    {deleteInvoice.invoice_number || "-"}
                  </span>{" "}
                  after saving an audit snapshot.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setDeleteInvoice(null);
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
                placeholder="Enter why this invoice is being deleted..."
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
                  setDeleteInvoice(null);
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
                {deleting ? "Deleting..." : "Delete Invoice"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Summary({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {title}
      </p>
      <p className="mt-2 text-xl font-bold text-slate-950">{value}</p>
    </div>
  );
}
