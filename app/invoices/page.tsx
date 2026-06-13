"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileText, Plus, Search, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
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
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState("");
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

  async function claimITC(invoiceId: string) {
    setMessage("");
    setSavingId(invoiceId);

    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email || "";
    const name =
      userData.user?.user_metadata?.full_name ||
      userData.user?.email ||
      "Accounts User";

    const { error } = await supabase
      .from("invoices")
      .update({
        itc_status: "Claimed",
        itc_claimed_by_name: name,
        itc_claimed_by_email: email,
        itc_claimed_at: new Date().toISOString(),
      })
      .eq("id", invoiceId);

    if (error) {
      setMessage(error.message);
      setSavingId("");
      return;
    }

    setInvoices((prev) =>
      prev.map((invoice) =>
        invoice.id === invoiceId
          ? { ...invoice, itc_status: "Claimed" }
          : invoice
      )
    );

    setSavingId("");
  }

  async function rejectAndDeleteInvoice(invoiceId: string) {
    setMessage("");

    const reason = remarks[invoiceId]?.trim() || "";

    if (!reason) {
      setMessage("Reason is required for Reject & Delete.");
      return;
    }

    setSavingId(invoiceId);

    const { error: documentError } = await supabase
      .from("invoice_documents")
      .delete()
      .eq("invoice_id", invoiceId);

    if (documentError) {
      setMessage(documentError.message);
      setSavingId("");
      return;
    }

    const { error: invoiceError } = await supabase
      .from("invoices")
      .delete()
      .eq("id", invoiceId);

    if (invoiceError) {
      setMessage(invoiceError.message);
      setSavingId("");
      return;
    }

    setInvoices((prev) =>
      prev.filter((invoice) => invoice.id !== invoiceId)
    );

    setSavingId("");
  }

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
            Vendor invoices and ITC claim tracking.
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
                Claim ITC or reject and delete incorrect invoices.
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
          <table className="w-full min-w-[1350px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3 text-left">Invoice No</th>
                <th className="p-3 text-left">Date</th>
                <th className="p-3 text-left">Site</th>
                <th className="p-3 text-left">Vendor</th>
                <th className="p-3 text-left">WO Number</th>
                <th className="p-3 text-right">Taxable</th>
                <th className="p-3 text-right">GST</th>
                <th className="p-3 text-right">Total</th>
                <th className="p-3 text-left">ITC Status</th>
                <th className="p-3 text-left">Reject Reason</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>

            <tbody>
              {invoices.map((invoice: any) => {
                const wo = maps.woMap.get(invoice.work_order_id);
                const vendor = maps.vendorMap.get(invoice.vendor_id);
                const site = wo?.site_id ? maps.siteMap.get(wo.site_id) : null;
                const company = wo?.company_id
                  ? maps.companyMap.get(wo.company_id)
                  : null;

                const itcStatus = invoice.itc_status || "Pending";
                const isPending =
                  String(itcStatus).toLowerCase() === "pending";

                return (
                  <tr key={invoice.id} className="border-t align-top hover:bg-slate-50">
                    <td className="p-3 font-semibold text-slate-950">
                      {invoice.invoice_number}
                    </td>

                    <td className="p-3">{invoice.invoice_date || "-"}</td>

                    <td className="p-3">
                      <div className="font-medium">{site?.site_name || "-"}</div>
                      <div className="text-xs text-slate-500">
                        {company?.company_name || "-"}
                      </div>
                    </td>

                    <td className="p-3">{vendor?.vendor_name || "-"}</td>

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
                      {isPending ? (
                        <textarea
                          value={remarks[invoice.id] || ""}
                          onChange={(e) =>
                            setRemarks((prev) => ({
                              ...prev,
                              [invoice.id]: e.target.value,
                            }))
                          }
                          className="min-h-20 w-56 rounded-xl border px-3 py-2 text-xs outline-none focus:border-slate-400"
                          placeholder="Required for Reject & Delete"
                        />
                      ) : (
                        <span className="text-xs text-slate-500">-</span>
                      )}
                    </td>

                    <td className="p-3 text-right">
                      <div className="flex flex-col items-end gap-2">
                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="inline-flex w-32 justify-center rounded-xl border px-3 py-2 text-xs font-medium hover:bg-slate-50"
                        >
                          View
                        </Link>

                        {isPending && (
                          <>
                            <button
                              type="button"
                              disabled={savingId === invoice.id}
                              onClick={() => claimITC(invoice.id)}
                              className="inline-flex w-32 items-center justify-center gap-1 rounded-xl bg-green-600 px-3 py-2 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Claim ITC
                            </button>

                            <button
                              type="button"
                              disabled={savingId === invoice.id}
                              onClick={() =>
                                rejectAndDeleteInvoice(invoice.id)
                              }
                              className="inline-flex w-32 items-center justify-center gap-1 rounded-xl bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Reject & Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {invoices.length === 0 && (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-slate-500">
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