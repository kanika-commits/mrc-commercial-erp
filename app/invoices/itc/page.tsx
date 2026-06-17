"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle,
  ExternalLink,
  FileText,
  Search,
  Trash2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
}

export default function ITCReviewPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [workOrders, setWorkOrders] = useState<Map<string, any>>(new Map());
  const [vendors, setVendors] = useState<Map<string, any>>(new Map());
  const [documents, setDocuments] = useState<Map<string, any>>(new Map());
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadInvoices();
  }, []);

  async function loadInvoices() {
    try {
      setLoading(true);
      setMessage("");

      const { data: invoiceData, error: invoiceError } = await supabase
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
          itc_status,
          remarks,
          created_at
        `)
        .or("itc_status.is.null,itc_status.ilike.pending")
        .order("invoice_date", { ascending: false });

      if (invoiceError) throw invoiceError;

      setInvoices(invoiceData || []);

      const workOrderIds = Array.from(
        new Set((invoiceData || []).map((i: any) => i.work_order_id).filter(Boolean))
      );

      const vendorIds = Array.from(
        new Set((invoiceData || []).map((i: any) => i.vendor_id).filter(Boolean))
      );

      const [{ data: woData }, { data: vendorData }] = await Promise.all([
        workOrderIds.length
          ? supabase
              .from("work_orders")
              .select("id, wo_number")
              .in("id", workOrderIds)
          : Promise.resolve({ data: [] }),

        vendorIds.length
          ? supabase
              .from("vendors")
              .select("id, vendor_name")
              .in("id", vendorIds)
          : Promise.resolve({ data: [] }),
      ]);

      setWorkOrders(new Map((woData || []).map((wo: any) => [wo.id, wo])));
      setVendors(new Map((vendorData || []).map((vendor: any) => [vendor.id, vendor])));
      await loadDocuments((invoiceData || []).map((invoice: any) => invoice.id));
    } catch (error: any) {
      setMessage(error.message || "Failed to load ITC review.");
    } finally {
      setLoading(false);
    }
  }

  async function loadDocuments(invoiceIds: string[]) {
    if (invoiceIds.length === 0) {
      setDocuments(new Map());
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setDocuments(new Map());
      return;
    }

    const response = await fetch(
      `/api/invoices/documents?invoice_ids=${encodeURIComponent(
        invoiceIds.join(",")
      )}`,
      {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      }
    );

    const result = await response.json();

    if (!response.ok) {
      setMessage(result.error || "Failed to load invoice documents.");
      setDocuments(new Map());
      return;
    }

    const documentMap = new Map<string, any>();
    (result.documents || []).forEach((document: any) => {
      if (!documentMap.has(document.invoice_id)) {
        documentMap.set(document.invoice_id, document);
      }
    });

    setDocuments(documentMap);
  }

  async function getCurrentUserNameEmail() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const name =
      user?.user_metadata?.full_name ||
      user?.user_metadata?.name ||
      user?.email ||
      "Unknown User";

    return {
      name,
      email: user?.email || "",
    };
  }

  async function claimITC(invoiceId: string) {
    try {
      setMessage("");

      const user = await getCurrentUserNameEmail();

      const { error } = await supabase
        .from("invoices")
        .update({
          itc_status: "Claimed",
          itc_claimed_by_name: user.name,
          itc_claimed_by_email: user.email,
          itc_claimed_at: new Date().toISOString(),
        })
        .eq("id", invoiceId);

      if (error) throw error;

      setInvoices((prev) => prev.filter((invoice) => invoice.id !== invoiceId));
      setMessage("ITC claimed successfully.");
    } catch (error: any) {
      setMessage(error.message || "Failed to claim ITC.");
    }
  }

  async function deleteInvoice(invoiceId: string) {
    try {
      setMessage("");
      setSavingId(invoiceId);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Please sign in again to delete the invoice.");
      }

      const response = await fetch(
        `/api/invoices?invoice_id=${encodeURIComponent(invoiceId)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to delete invoice.");
      }

      setInvoices((prev) => prev.filter((invoice) => invoice.id !== invoiceId));
      setDocuments((prev) => {
        const next = new Map(prev);
        next.delete(invoiceId);
        return next;
      });
      setMessage("Invoice deleted successfully.");
    } catch (error: any) {
      setMessage(error.message || "Failed to delete invoice.");
    } finally {
      setSavingId("");
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading ITC review...</p>;
  }

  const filteredInvoices = invoices.filter((invoice) => {
    const wo = invoice.work_order_id ? workOrders.get(invoice.work_order_id) : null;
    const vendor = invoice.vendor_id ? vendors.get(invoice.vendor_id) : null;
    const query = search.trim().toLowerCase();

    if (!query) return true;

    return [
      invoice.invoice_number,
      invoice.invoice_date,
      wo?.wo_number,
      vendor?.vendor_name,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });

  function openDocument(document: any) {
    if (!document?.signed_url) {
      setMessage(document?.signed_url_error || "Invoice file is not available.");
      return;
    }

    window.open(document.signed_url, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
            <FileText className="h-3.5 w-3.5" />
            ITC Review
          </div>

          <h1 className="text-3xl font-bold text-slate-950">
            Pending ITC Review
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Review pending invoices and mark ITC as claimed or delete incorrect entries.
          </p>
        </div>

        <Link
          href="/invoices"
          className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Invoices
        </Link>
      </div>

      {message && (
        <div className="rounded-2xl border bg-yellow-50 p-4 text-sm text-yellow-800">
          {message}
        </div>
      )}

      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Search
        </h2>
        <div className="mt-3 flex max-w-xl items-center gap-2 rounded-xl border bg-white px-3">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Contractor name, invoice number or WO number"
            className="h-11 w-full border-0 p-0 text-sm focus:ring-0"
          />
        </div>
      </div>

      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="border-b p-4">
          <h2 className="font-semibold text-slate-950">Pending ITC Queue</h2>
          <p className="text-xs text-slate-500">
            Invoices shown here are pending ITC review.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1350px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3 text-left">Contractor/Vendor Name</th>
                <th className="p-3 text-left">WO Number</th>
                <th className="p-3 text-left">Invoice Number</th>
                <th className="p-3 text-left">Invoice Date</th>
                <th className="p-3 text-right">Taxable Amount</th>
                <th className="p-3 text-right">GST Rate</th>
                <th className="p-3 text-right">GST Amount</th>
                <th className="p-3 text-right">Total Amount</th>
                <th className="p-3 text-center">File</th>
                <th className="p-3 text-left">Remarks</th>
                <th className="p-3 text-center">Action</th>
              </tr>
            </thead>

            <tbody>
              {filteredInvoices.map((invoice) => {
                const wo = invoice.work_order_id
                  ? workOrders.get(invoice.work_order_id)
                  : null;

                const vendor = invoice.vendor_id
                  ? vendors.get(invoice.vendor_id)
                  : null;
                const document = documents.get(invoice.id);

                return (
                  <tr key={invoice.id} className="border-t hover:bg-slate-50">
                    <td className="p-3 font-medium text-slate-900">
                      {vendor?.vendor_name || "-"}
                    </td>

                    <td className="p-3 font-medium">
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

                    <td className="p-3 font-medium">
                      <Link
                        href={`/invoices/${invoice.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        {invoice.invoice_number || "-"}
                      </Link>
                    </td>

                    <td className="p-3">{invoice.invoice_date || "-"}</td>

                    <td className="p-3 text-right">
                      {money(invoice.taxable_amount)}
                    </td>

                    <td className="p-3 text-right">
                      {Number(invoice.gst_rate || 0)}%
                    </td>

                    <td className="p-3 text-right">
                      {money(invoice.gst_amount)}
                    </td>

                    <td className="p-3 text-right font-semibold">
                      {money(invoice.invoice_amount)}
                    </td>

                    <td className="p-3 text-center">
                      {document ? (
                        <button
                          type="button"
                          onClick={() => openDocument(document)}
                          className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">No file</span>
                      )}
                    </td>

                    <td className="p-3">
                      <div className="max-w-[240px] text-sm text-slate-600">
                        {invoice.remarks || "-"}
                      </div>
                    </td>

                    <td className="p-3">
                      <div className="flex flex-col justify-center gap-2">
                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          View
                        </Link>

                        <button
                          type="button"
                          disabled={savingId === invoice.id}
                          onClick={() => claimITC(invoice.id)}
                          className="inline-flex items-center justify-center gap-1 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-60"
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                          ITC Claimed
                        </button>

                        <button
                          type="button"
                          disabled={savingId === invoice.id}
                          onClick={() => deleteInvoice(invoice.id)}
                          className="inline-flex items-center justify-center gap-1 rounded-lg bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-60"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredInvoices.length === 0 && (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-slate-500">
                    No pending ITC invoices found.
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
