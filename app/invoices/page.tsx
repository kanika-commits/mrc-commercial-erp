"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FileText, Plus, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";

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

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadInvoices();
  }, []);

  async function loadInvoices() {
    setLoading(true);
    setMessage("");

    const { data: invoiceData, error } = await supabase
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
        created_at
      `)
      .order("created_at", { ascending: false });

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

    const { data: woData } = workOrderIds.length
      ? await supabase
          .from("work_orders")
          .select("id, wo_number, company_id, site_id")
          .in("id", workOrderIds)
      : { data: [] };

    const siteIds = Array.from(
      new Set((woData || []).map((wo: any) => wo.site_id).filter(Boolean))
    );

    const companyIds = Array.from(
      new Set((woData || []).map((wo: any) => wo.company_id).filter(Boolean))
    );

    const { data: vendorData } = vendorIds.length
      ? await supabase
          .from("vendors")
          .select("id, vendor_name")
          .in("id", vendorIds)
      : { data: [] };

    const { data: siteData } = siteIds.length
      ? await supabase
          .from("sites")
          .select("id, site_name, site_code")
          .in("id", siteIds)
      : { data: [] };

    const { data: companyData } = companyIds.length
      ? await supabase
          .from("companies")
          .select("id, company_name, company_code")
          .in("id", companyIds)
      : { data: [] };

    setWorkOrders(woData || []);
    setVendors(vendorData || []);
    setSites(siteData || []);
    setCompanies(companyData || []);
    setLoading(false);
  }

  const maps = useMemo(() => {
    return {
      woMap: new Map(workOrders.map((item) => [item.id, item])),
      vendorMap: new Map(vendors.map((item) => [item.id, item])),
      siteMap: new Map(sites.map((item) => [item.id, item])),
      companyMap: new Map(companies.map((item) => [item.id, item])),
    };
  }, [workOrders, vendors, sites, companies]);

  const totalInvoices = invoices.length;

  const pendingITC = invoices.filter(
    (invoice) =>
      String(invoice.itc_status || "Pending").toLowerCase() === "pending"
  ).length;

  const claimedITC = invoices.filter(
    (invoice) => String(invoice.itc_status || "").toLowerCase() === "claimed"
  ).length;

  const pendingITCValue = invoices
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
            Invoice register with ITC status tracking.
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
        <Summary title="Total Invoices" value={String(totalInvoices)} />
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
                Read-only invoice status and audit trail.
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
              {invoices.map((invoice: any) => {
                const wo = maps.woMap.get(invoice.work_order_id);
                const vendor = maps.vendorMap.get(invoice.vendor_id);

                const itcStatus = invoice.itc_status || "Pending";

                return (
                  <tr key={invoice.id} className="border-t align-top hover:bg-slate-50">
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
                        {auditName(invoice.created_by_name, invoice.created_by_email)}
                      </div>
                      {invoice.created_by_name && invoice.created_by_email && invoice.created_by_name !== invoice.created_by_email && (
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
                        {auditName(invoice.itc_claimed_by_name, invoice.itc_claimed_by_email)}
                      </div>
                      {invoice.itc_claimed_by_name && invoice.itc_claimed_by_email && invoice.itc_claimed_by_name !== invoice.itc_claimed_by_email && (
                        <div className="max-w-[180px] truncate text-xs text-slate-500">
                          {invoice.itc_claimed_by_email}
                        </div>
                      )}
                    </td>

                    <td className="p-3 text-slate-700">
                      {formatDateTime(invoice.itc_claimed_at)}
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

              {invoices.length === 0 && (
                <tr>
                  <td colSpan={13} className="p-8 text-center text-slate-500">
                    No invoices found.
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
