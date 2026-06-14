"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Building2, Download, Pencil } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getCurrentUserAccess, can } from "@/lib/accessControl";

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
}

export default function VendorDetailPage() {
  const params = useParams();
  const vendorId = params.id as string;

  const [vendor, setVendor] = useState<any>(null);
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [raBills, setRaBills] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [debitNotes, setDebitNotes] = useState<any[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const loadVendorLedger = useCallback(async () => {
    try {
      setLoading(true);
      setMessage("");

      const access = await getCurrentUserAccess();
      setCanEdit(can(access.permissions, "vendors", "edit"));

      const { data: vendorData, error: vendorError } = await supabase
        .from("vendors")
        .select("*")
        .eq("id", vendorId)
        .single();

      if (vendorError) throw vendorError;
      setVendor(vendorData);

      const { data: woLinkData, error: woLinkError } = await supabase
        .from("work_order_vendors")
        .select("work_order_id, vendor_role, is_primary")
        .eq("vendor_id", vendorId);

      if (woLinkError) throw woLinkError;

      const workOrderIds = Array.from(
        new Set(
          (woLinkData || [])
            .map((item: any) => item.work_order_id)
            .filter(Boolean)
        )
      );

      const { data: woData, error: woError } = workOrderIds.length
        ? await supabase
            .from("work_orders")
            .select("id, wo_number, wo_date, wo_value, status, approval_status")
            .in("id", workOrderIds)
        : { data: [], error: null };

      if (woError) throw woError;
      setWorkOrders(woData || []);

      const { data: raData, error: raError } = await supabase
        .from("ra_bills")
        .select("*")
        .eq("vendor_id", vendorId)
        .order("ra_date", { ascending: true });

      if (raError) throw raError;
      setRaBills(raData || []);

      const { data: invoiceData, error: invoiceError } = await supabase
        .from("invoices")
        .select("*")
        .eq("vendor_id", vendorId)
        .order("invoice_date", { ascending: true });

      if (invoiceError) throw invoiceError;
      setInvoices(invoiceData || []);

      const { data: paymentData, error: paymentError } = await supabase
        .from("payments")
        .select("*")
        .eq("vendor_id", vendorId)
        .order("payment_date", { ascending: true });

      if (paymentError) throw paymentError;
      setPayments(paymentData || []);

      const { data: debitData, error: debitError } = await supabase
        .from("debit_notes")
        .select("*")
        .eq("vendor_id", vendorId)
        .order("debit_note_date", { ascending: true });

      if (debitError) throw debitError;
      setDebitNotes(debitData || []);
    } catch (error: any) {
      setMessage(error.message || "Failed to load vendor ledger.");
    } finally {
      setLoading(false);
    }
  }, [vendorId]);

  useEffect(() => {
    loadVendorLedger();
  }, [loadVendorLedger]);

  const totals = useMemo(() => {
    const totalWO = workOrders.reduce(
      (sum, item) => sum + Number(item.wo_value || 0),
      0
    );

    const totalRA = raBills
      .filter(
        (item) =>
          String(item.approval_status || "").toLowerCase() === "approved"
      )
      .reduce((sum, item) => sum + Number(item.net_amount || 0), 0);

    const totalInvoices = invoices.reduce(
      (sum, item) => sum + Number(item.invoice_amount || 0),
      0
    );

    const totalPayments = payments.reduce(
      (sum, item) =>
        sum + Number(item.transferred_amount || item.payment_amount || 0),
      0
    );

    const totalDebitNotes = debitNotes
      .filter(
        (item) =>
          String(item.approval_status || "").toLowerCase() === "approved"
      )
      .reduce((sum, item) => sum + Number(item.total_amount || 0), 0);

    return {
      totalWO,
      totalRA,
      totalInvoices,
      totalPayments,
      totalDebitNotes,
      outstanding: totalInvoices - totalPayments - totalDebitNotes,
    };
  }, [workOrders, raBills, invoices, payments, debitNotes]);

  const woMap = useMemo(() => {
    return new Map(workOrders.map((wo: any) => [wo.id, wo.wo_number]));
  }, [workOrders]);

  const ledgerRows = useMemo(() => {
    const rows: any[] = [];

    invoices.forEach((invoice) => {
      rows.push({
        date: invoice.invoice_date || invoice.created_at,
        type: "Invoice",
        woNumber: woMap.get(invoice.work_order_id) || "-",
        reference: invoice.invoice_number,
        debit: Number(invoice.invoice_amount || 0),
        credit: 0,
      });
    });

    payments.forEach((payment) => {
      rows.push({
        date: payment.payment_date || payment.created_at,
        type: "Payment",
        woNumber: woMap.get(payment.work_order_id) || "-",
        reference: payment.reference_number || payment.payment_number,
        debit: 0,
        credit: Number(payment.transferred_amount || payment.payment_amount || 0),
      });
    });

    debitNotes
      .filter(
        (item) =>
          String(item.approval_status || "").toLowerCase() === "approved"
      )
      .forEach((note) => {
        rows.push({
          date: note.debit_note_date || note.created_at,
          type: "Debit Note",
          woNumber: woMap.get(note.work_order_id) || "-",
          reference: note.debit_note_number,
          debit: 0,
          credit: Number(note.total_amount || 0),
        });
      });

    rows.sort(
      (a, b) =>
        new Date(a.date || 0).getTime() -
        new Date(b.date || 0).getTime()
    );

    let balance = 0;

    return rows.map((row) => {
      balance = balance + row.debit - row.credit;
      return { ...row, balance };
    });
  }, [invoices, payments, debitNotes, woMap]);

  function downloadVendorLedger() {
    const headers = [
      "Date",
      "Type",
      "WO Number",
      "Reference",
      "Debit",
      "Credit",
      "Balance",
    ];

    const rows = ledgerRows.map((row) => [
      row.date ? String(row.date).slice(0, 10) : "-",
      row.type,
      row.woNumber || "-",
      row.reference || "-",
      row.debit || 0,
      row.credit || 0,
      row.balance || 0,
    ]);

    const csv = [headers, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const safeName = String(vendor?.vendor_name || "Vendor")
      .replace(/[^a-z0-9]/gi, "-")
      .toLowerCase();

    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeName}-ledger.csv`;
    link.click();

    URL.revokeObjectURL(url);
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading vendor ledger...</p>;
  }

  if (message) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {message}
      </div>
    );
  }

  if (!vendor) return <p className="text-red-600">Vendor not found.</p>;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <Building2 className="h-3.5 w-3.5" />
            Vendor Ledger
          </div>

          <h1 className="text-3xl font-bold text-slate-950">
            {vendor.vendor_name}
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            PAN: {vendor.pan || "-"} · GSTIN: {vendor.gstin || "-"} · Status:{" "}
            {vendor.status || "-"}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          {canEdit && (
            <Link
              href={`/vendors/${vendorId}/edit`}
              className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
            >
              <Pencil className="h-4 w-4" />
              Edit Vendor
            </Link>
          )}

          <button
            type="button"
            onClick={downloadVendorLedger}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            <Download className="h-4 w-4" />
            Download Ledger
          </button>

          <Link
            href="/vendors"
            className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Vendors
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-6">
        <Summary title="WO Value" value={money(totals.totalWO)} />
        <Summary title="RA Bills" value={money(totals.totalRA)} />
        <Summary title="Invoices" value={money(totals.totalInvoices)} />
        <Summary title="Payments" value={money(totals.totalPayments)} />
        <Summary title="Debit Notes" value={money(totals.totalDebitNotes)} />
        <Summary title="Outstanding" value={money(totals.outstanding)} />
      </div>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold text-slate-950">
          Commercial Ledger
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[950px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3 text-left">Date</th>
                <th className="p-3 text-left">Type</th>
                <th className="p-3 text-left">WO Number</th>
                <th className="p-3 text-left">Reference</th>
                <th className="p-3 text-right">Debit</th>
                <th className="p-3 text-right">Credit</th>
                <th className="p-3 text-right">Balance</th>
              </tr>
            </thead>

            <tbody>
              {ledgerRows.map((row, index) => (
                <tr key={index} className="border-t">
                  <td className="p-3">
                    {row.date ? String(row.date).slice(0, 10) : "-"}
                  </td>
                  <td className="p-3">{row.type}</td>
                  <td className="p-3">{row.woNumber || "-"}</td>
                  <td className="p-3 font-medium">{row.reference || "-"}</td>
                  <td className="p-3 text-right">
                    {row.debit ? money(row.debit) : "-"}
                  </td>
                  <td className="p-3 text-right">
                    {row.credit ? money(row.credit) : "-"}
                  </td>
                  <td className="p-3 text-right font-semibold">
                    {money(row.balance)}
                  </td>
                </tr>
              ))}

              {ledgerRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    No ledger transactions found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <SimpleTable
        title="Work Orders"
        columns={["WO No", "Date", "Value", "Status", "Approval"]}
        rows={workOrders.map((wo) => [
          wo.wo_number || "-",
          wo.wo_date || "-",
          money(wo.wo_value),
          wo.status || "-",
          wo.approval_status || "-",
        ])}
      />

      <SimpleTable
        title="RA Bills"
        columns={["RA No", "Date", "Gross", "GST", "Net", "Approval"]}
        rows={raBills.map((bill) => [
          bill.ra_number || "-",
          bill.ra_date || "-",
          money(bill.gross_amount),
          money(bill.gst_amount),
          money(bill.net_amount),
          bill.approval_status || "-",
        ])}
      />

      <SimpleTable
        title="Invoices"
        columns={["Invoice No", "Date", "Taxable", "GST", "Total", "ITC"]}
        rows={invoices.map((invoice) => [
          invoice.invoice_number || "-",
          invoice.invoice_date || "-",
          money(invoice.taxable_amount),
          money(invoice.gst_amount),
          money(invoice.invoice_amount),
          invoice.itc_status || "Pending",
        ])}
      />

      <SimpleTable
        title="Payments"
        columns={["Date", "Type", "Reference", "Total", "TDS", "Transferred"]}
        rows={payments.map((payment) => [
          payment.payment_date || "-",
          payment.payment_type || "-",
          payment.reference_number || "-",
          money(payment.total_payment),
          money(payment.tds_amount),
          money(payment.transferred_amount || payment.payment_amount),
        ])}
      />

      <SimpleTable
        title="Debit Notes"
        columns={["DN No", "Date", "Type", "Amount", "Reason", "Approval"]}
        rows={debitNotes.map((note) => [
          note.debit_note_number || "-",
          note.debit_note_date || "-",
          note.debit_note_type || "-",
          money(note.total_amount),
          note.reason || "-",
          note.approval_status || "-",
        ])}
      />
    </section>
  );
}

function Summary({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {title}
      </p>
      <p className="mt-2 text-lg font-bold text-slate-950">{value}</p>
    </div>
  );
}

function SimpleTable({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: string[];
  rows: string[][];
}) {
  return (
    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-xl font-semibold text-slate-950">{title}</h2>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              {columns.map((column) => (
                <th key={column} className="p-3 text-left">
                  {column}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="p-8 text-center text-slate-500"
                >
                  No records found.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={index} className="border-t">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="p-3">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
