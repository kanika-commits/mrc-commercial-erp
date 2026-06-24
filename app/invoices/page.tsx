"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FileText, Plus, Search, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAccessContext } from "@/components/AccessContext";
import { can, hasSiteRestriction } from "@/lib/accessControl";

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
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
  const [invoices, setInvoices] = useState<any[]>([]);
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [deleteInvoice, setDeleteInvoice] = useState<any | null>(null);
  const [deletionReason, setDeletionReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [activePage, setActivePage] = useState(1);


  useEffect(() => {
    if (!accessLoading && access) {
      loadInvoices();
    }
  }, [access, accessLoading]);

  const canDelete = can(access?.permissions || [], "invoices", "delete");

  async function loadInvoices() {
  setLoading(true);
  setMessage("");

  const restrictedSiteIds = access && hasSiteRestriction(access) ? access.sites : [];

  let workOrderQuery = supabase
    .from("work_orders")
    .select("id, wo_number, company_id, site_id");

  if (restrictedSiteIds.length > 0) {
    workOrderQuery = workOrderQuery.in("site_id", restrictedSiteIds);
  }

  const { data: allowedWorkOrders, error: woLoadError } = await workOrderQuery;

  if (woLoadError) {
    setMessage(woLoadError.message);
    setLoading(false);
    return;
  }

  const allowedWorkOrderIds = (allowedWorkOrders || []).map((wo: any) => wo.id);

  if (restrictedSiteIds.length > 0 && allowedWorkOrderIds.length === 0) {
    setInvoices([]);
    setWorkOrders([]);
    setVendors([]);
    setSites([]);
    setCompanies([]);
    setLoading(false);
    return;
  }

  let invoiceQuery = supabase
    .from("invoices")
    .select(`
      id,
      work_order_id,
      vendor_id,
      invoice_number,
      invoice_date,
      taxable_amount,
      gst_rate,
      gst_amount,
      invoice_amount,
      status,
      approval_status,
      itc_status,
      created_by_name,
      created_by_email,
      itc_claimed_by_name,
      itc_claimed_by_email,
      itc_claimed_at,
      itc_rejected_by_name,
      itc_rejected_by_email,
      itc_rejected_at,
      itc_rejection_reason,
      created_at
    `)
    .order("created_at", { ascending: false });

  if (restrictedSiteIds.length > 0) {
    invoiceQuery = invoiceQuery.in("work_order_id", allowedWorkOrderIds);
  }

  const { data: invoiceData, error } = await invoiceQuery;

  if (error) {
    setMessage(error.message);
    setLoading(false);
    return;
  }

  const items = invoiceData || [];
  setInvoices(items);

  const workOrderIds = Array.from(
    new Set(items.map((i: any) => i.work_order_id).filter(Boolean))
  );

  const vendorIds = Array.from(
    new Set(items.map((i: any) => i.vendor_id).filter(Boolean))
  );

  const visibleWorkOrders =
    restrictedSiteIds.length > 0
      ? (allowedWorkOrders || []).filter((wo: any) => workOrderIds.includes(wo.id))
      : workOrderIds.length
      ? (
          await supabase
            .from("work_orders")
            .select("id, wo_number, company_id, site_id")
            .in("id", workOrderIds)
        ).data || []
      : [];

  const siteIds = Array.from(
    new Set(visibleWorkOrders.map((wo: any) => wo.site_id).filter(Boolean))
  );

  const companyIds = Array.from(
    new Set(visibleWorkOrders.map((wo: any) => wo.company_id).filter(Boolean))
  );

  const { data: vendorData } = vendorIds.length
    ? await supabase.from("vendors").select("id, vendor_name").in("id", vendorIds)
    : { data: [] };

  const { data: siteData } = siteIds.length
    ? await supabase.from("sites").select("id, site_name, site_code").in("id", siteIds)
    : { data: [] };

  const { data: companyData } = companyIds.length
    ? await supabase
        .from("companies")
        .select("id, company_name, company_code")
        .in("id", companyIds)
    : { data: [] };

  setWorkOrders(visibleWorkOrders || []);
  setVendors(vendorData || []);
  setSites(siteData || []);
  setCompanies(companyData || []);
  setLoading(false);
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
    } catch (error: any) {
      setMessage(error.message || "Failed to delete invoice.");
    } finally {
      setDeleting(false);
    }
  }

  const maps = useMemo(() => {
    return {
      woMap: new Map(workOrders.map((item) => [item.id, item])),
      vendorMap: new Map(vendors.map((item) => [item.id, item])),
      siteMap: new Map(sites.map((item) => [item.id, item])),
      companyMap: new Map(companies.map((item) => [item.id, item])),
    };
  }, [workOrders, vendors, sites, companies]);

  const activeInvoices = invoices.filter(
    (invoice) =>
      String(invoice.approval_status || "").toLowerCase() !== "rejected"
  );

  const rejectedInvoices = invoices.filter(
    (invoice) =>
      String(invoice.approval_status || "").toLowerCase() === "rejected"
  );

  const activeTotalPages = Math.max(1, Math.ceil(activeInvoices.length / PAGE_SIZE));
  const currentActivePage = Math.min(activePage, activeTotalPages);
  const activeStartIndex = (currentActivePage - 1) * PAGE_SIZE;
  const activeEndIndex = Math.min(
    activeStartIndex + PAGE_SIZE,
    activeInvoices.length
  );
  const paginatedActiveInvoices = activeInvoices.slice(
    activeStartIndex,
    activeEndIndex
  );
  const activeRangeStart = activeInvoices.length === 0 ? 0 : activeStartIndex + 1;

  useEffect(() => {
    if (activePage > activeTotalPages) {
      setActivePage(activeTotalPages);
    }
  }, [activePage, activeTotalPages]);

  const totalInvoices = activeInvoices.length;

  const pendingITC = activeInvoices.filter(
    (invoice) =>
      String(invoice.itc_status || "Pending").toLowerCase() === "pending"
  ).length;

  const claimedITC = activeInvoices.filter(
    (invoice) => String(invoice.itc_status || "").toLowerCase() === "claimed"
  ).length;

  const pendingITCValue = activeInvoices
    .filter(
      (invoice) =>
        String(invoice.itc_status || "Pending").toLowerCase() === "pending"
    )
    .reduce((sum, invoice) => sum + Number(invoice.gst_amount || 0), 0);

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
        <Summary title="Active Invoices" value={String(totalInvoices)} />
        <Summary title="Pending ITC" value={String(pendingITC)} />
        <Summary title="ITC Claimed" value={String(claimedITC)} />
        <Summary title="Pending ITC Value" value={money(pendingITCValue)} />
      </div>

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

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                className="h-10 w-72 rounded-xl border bg-white pl-9 pr-3 text-sm outline-none focus:border-slate-400"
                placeholder="Search invoice no, WO, vendor..."
              />
            </div>
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
                const wo = maps.woMap.get(invoice.work_order_id);
                const vendor = maps.vendorMap.get(invoice.vendor_id);
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
                          {wo?.wo_number || "-"}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>

                    <td className="p-3">{vendor?.vendor_name || "-"}</td>
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

              {activeInvoices.length === 0 && (
                <tr>
                  <td colSpan={15} className="p-8 text-center text-slate-500">
                    No active invoices found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <div>
            Showing {activeRangeStart}–{activeEndIndex} of {activeInvoices.length}
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
            <h2 className="font-semibold text-red-700">Rejected Invoices</h2>
            <p className="text-xs text-slate-500">
              Rejected invoices are shown separately and are not included in
              invoice totals.
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
                  const wo = maps.woMap.get(invoice.work_order_id);
                  const vendor = maps.vendorMap.get(invoice.vendor_id);

                  return (
                    <tr key={invoice.id} className="border-t border-red-100">
                      <td className="p-3 font-semibold">
                        {invoice.invoice_number}
                      </td>
                      <td className="p-3">{wo?.wo_number || "-"}</td>
                      <td className="p-3">{vendor?.vendor_name || "-"}</td>
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
