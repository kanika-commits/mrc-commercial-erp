"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle, FileText, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
}

export default function ITCReviewPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [workOrders, setWorkOrders] = useState<Map<string, any>>(new Map());
  const [vendors, setVendors] = useState<Map<string, any>>(new Map());
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
          gst_amount,
          invoice_amount,
          itc_status,
          created_at
        `)
        .is("itc_status", null)
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
    } catch (error: any) {
      setMessage(error.message || "Failed to load ITC review.");
    } finally {
      setLoading(false);
    }
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

  async function rejectITC(invoiceId: string) {
    const reason = window.prompt("Enter ITC rejection reason:");

    if (!reason || !reason.trim()) {
      setMessage("Rejection reason is required.");
      return;
    }

    try {
      setMessage("");

      const user = await getCurrentUserNameEmail();

      const { error } = await supabase
        .from("invoices")
        .update({
          itc_status: "Rejected",
          itc_rejected_by_name: user.name,
          itc_rejected_by_email: user.email,
          itc_rejected_at: new Date().toISOString(),
          itc_rejection_reason: reason.trim(),
        })
        .eq("id", invoiceId);

      if (error) throw error;

      setInvoices((prev) => prev.filter((invoice) => invoice.id !== invoiceId));
      setMessage("ITC rejected successfully.");
    } catch (error: any) {
      setMessage(error.message || "Failed to reject ITC.");
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading ITC review...</p>;
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
            Review pending invoices and mark ITC as claimed or rejected.
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

      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="border-b p-4">
          <h2 className="font-semibold text-slate-950">Pending Invoice Queue</h2>
          <p className="text-xs text-slate-500">
            Invoices shown here have no ITC status yet.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3 text-left">Invoice No</th>
                <th className="p-3 text-left">Date</th>
                <th className="p-3 text-left">Work Order</th>
                <th className="p-3 text-left">Vendor</th>
                <th className="p-3 text-right">Taxable</th>
                <th className="p-3 text-right">GST</th>
                <th className="p-3 text-right">Total</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-center">Action</th>
              </tr>
            </thead>

            <tbody>
              {invoices.map((invoice) => {
                const wo = invoice.work_order_id
                  ? workOrders.get(invoice.work_order_id)
                  : null;

                const vendor = invoice.vendor_id
                  ? vendors.get(invoice.vendor_id)
                  : null;

                return (
                  <tr key={invoice.id} className="border-t hover:bg-slate-50">
                    <td className="p-3 font-medium">
                      <Link
                        href={`/invoices/${invoice.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        {invoice.invoice_number || "-"}
                      </Link>
                    </td>

                    <td className="p-3">{invoice.invoice_date || "-"}</td>

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

                    <td className="p-3 text-right">
                      {money(invoice.taxable_amount)}
                    </td>

                    <td className="p-3 text-right">
                      {money(invoice.gst_amount)}
                    </td>

                    <td className="p-3 text-right font-semibold">
                      {money(invoice.invoice_amount)}
                    </td>

                    <td className="p-3">Pending</td>

                    <td className="p-3">
                      <div className="flex justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => claimITC(invoice.id)}
                          className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                          Claim
                        </button>

                        <button
                          type="button"
                          onClick={() => rejectITC(invoice.id)}
                          className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {invoices.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-500">
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