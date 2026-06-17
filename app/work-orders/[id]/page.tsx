"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Download } from "lucide-react";
import { supabase } from "@/lib/supabase";

function money(value: any) {
  return `Rs. ${Number(value || 0).toLocaleString("en-IN")}`;
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

export default function WorkOrderDetailPage() {
  const params = useParams();
  const workOrderId = params.id as string;

  const [workOrder, setWorkOrder] = useState<any>(null);
  const [company, setCompany] = useState<any>(null);
  const [site, setSite] = useState<any>(null);
  const [vendors, setVendors] = useState<any[]>([]);
  const [raBills, setRaBills] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
const [debitNotes, setDebitNotes] = useState<any[]>([]);
const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadWorkOrder();
  }, [workOrderId]);

  async function loadWorkOrder() {
    try {
      setLoading(true);
      setMessage("");

      const { data: woData, error: woError } = await supabase
        .from("work_orders")
        .select("*")
        .eq("id", workOrderId)
        .single();

      if (woError) throw woError;

      setWorkOrder(woData);

      if (woData.company_id) {
        const { data } = await supabase
          .from("companies")
          .select("id, company_name, company_code")
          .eq("id", woData.company_id)
          .maybeSingle();

        setCompany(data);
      }

      if (woData.site_id) {
        const { data } = await supabase
          .from("sites")
          .select("id, site_name, site_code, location, state")
          .eq("id", woData.site_id)
          .maybeSingle();

        setSite(data);
      }

      const { data: vendorData, error: vendorError } = await supabase
        .from("work_order_vendors")
        .select(`
          id,
          vendor_role,
          is_primary,
          vendors (
            id,
            vendor_name,
            vendor_type,
            pan,
            gstin
          )
        `)
        .eq("work_order_id", workOrderId)
        .order("is_primary", { ascending: false });

      if (vendorError) throw vendorError;

      const { data: raData, error: raError } = await supabase
        .from("ra_bills")
        .select("id, ra_number, ra_date, gross_amount, net_amount, status, approval_status")
        .eq("work_order_id", workOrderId)
        .order("ra_date", { ascending: false });

      if (raError) throw raError;

      const { data: invoiceData, error: invoiceError } = await supabase
        .from("invoices")
        .select("id, invoice_number, invoice_date, taxable_amount, gst_amount, invoice_amount, status, approval_status, itc_status")
        .eq("work_order_id", workOrderId)
        .order("invoice_date", { ascending: false });

      if (invoiceError) throw invoiceError;

      const { data: paymentData, error: paymentError } = await supabase
  .from("payments")
  .select("id, payment_number, payment_date, payment_amount, payment_mode, utr_number, status, total_payment, tds_amount, transferred_amount, reference_number, created_at")
  .eq("work_order_id", workOrderId)
  .order("payment_date", { ascending: false });

if (paymentError) throw paymentError;

     const { data: debitNoteData, error: debitNoteError } = await supabase
  .from("debit_notes")
  .select(`
    id,
    debit_note_number,
    debit_note_date,
    debit_note_type,
    total_amount,
    reason,
    status,
    approval_status
  `)
  .eq("work_order_id", workOrderId)
  .order("debit_note_date", { ascending: false });

if (debitNoteError) throw debitNoteError;

     
const {
  data: { session },
} = await supabase.auth.getSession();
const token = session?.access_token;

if (!token) {
  throw new Error("Unable to load Work Order files: missing auth session.");
}

const documentResponse = await fetch(
  `/api/work-orders/documents?work_order_id=${encodeURIComponent(workOrderId)}`,
  {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }
);
const documentResult = await documentResponse.json();

if (!documentResponse.ok) {
  throw new Error(documentResult.error || "Failed to load Work Order files.");
}

setDocuments(documentResult.documents || []);
setVendors(vendorData || []);
setRaBills(raData || []);
setInvoices(invoiceData || []);
setPayments(paymentData || []);
setDebitNotes(debitNoteData || []);
    } catch (error: any) {
      setMessage(error.message || "Failed to load work order.");
    } finally {
      setLoading(false);
    }
  }

  function openDocument(document: any) {
    if (!document.signed_url) {
      setMessage(
        document.signed_url_error ||
          "Unable to open Work Order file. Signed URL was not available."
      );
      return;
    }

    window.open(document.signed_url, "_blank", "noopener,noreferrer");
  }

 const totals = useMemo(() => {
  const woValue = Number(workOrder?.wo_value || 0);

  const totalRa = raBills
    .filter((item) => String(item.approval_status || "").toLowerCase() === "approved")
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
    .filter((item) => String(item.approval_status || "").toLowerCase() === "approved")
    .reduce((sum, item) => sum + Number(item.total_amount || 0), 0);

  return {
    woValue,
    totalRa,
    totalInvoices,
    totalPayments,
    totalDebitNotes,
    balanceWoValue: woValue - totalRa,
    payableOutstanding: totalInvoices - totalPayments - totalDebitNotes,
    raMinusInvoices: totalRa - totalInvoices,
  };
}, [workOrder, raBills, invoices, payments, debitNotes]);
const woLedgerRows = useMemo(() => {
  const rows: any[] = [];

  if (workOrder) {
    rows.push({
      date: workOrder.wo_date || workOrder.created_at,
      type: "Work Order",
      reference: workOrder.wo_number,
      amount: Number(workOrder.wo_value || 0),
      status: workOrder.approval_status || workOrder.status || "-",
    });
  }

  raBills.forEach((bill) => {
    rows.push({
      date: bill.ra_date || bill.created_at,
      type: "RA Bill",
      reference: bill.ra_number,
      amount: Number(bill.net_amount || 0),
      status: bill.approval_status || bill.status || "-",
    });
  });

  invoices.forEach((invoice) => {
    rows.push({
      date: invoice.invoice_date || invoice.created_at,
      type: "Invoice",
      reference: invoice.invoice_number,
      amount: Number(invoice.invoice_amount || 0),
      status: invoice.approval_status || invoice.status || "-",
    });
  });

  payments.forEach((payment) => {
    rows.push({
      date: payment.payment_date || payment.created_at,
      type: "Payment",
      reference: payment.reference_number || payment.payment_number,
      amount: Number(payment.transferred_amount || payment.payment_amount || 0),
      status: payment.status || "-",
    });
  });

  debitNotes.forEach((note) => {
    rows.push({
      date: note.debit_note_date || note.created_at,
      type: "Debit Note",
      reference: note.debit_note_number,
      amount: Number(note.total_amount || 0),
      status: note.approval_status || "-",
    });
  });

  return rows.sort(
    (a, b) =>
      new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime()
  );
}, [workOrder, raBills, invoices, payments, debitNotes]);
function downloadWOLedger() {
  const headers = ["Date", "Type", "Reference", "Amount", "Status"];

  const rows = woLedgerRows.map((row) => [
    row.date ? String(row.date).slice(0, 10) : "-",
    row.type,
    row.reference || "-",
    row.amount || 0,
    row.status || "-",
  ]);

  const csv = [headers, ...rows]
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const safeName = String(workOrder?.wo_number || "Work-Order")
    .replace(/[^a-z0-9]/gi, "-")
    .toLowerCase();

  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeName}-ledger.csv`;
  link.click();

  URL.revokeObjectURL(url);
}
  if (loading) return <p className="text-gray-500">Loading work order...</p>;

  if (message) {
    return (
      <div className="rounded-lg border bg-red-50 p-4 text-red-700">
        {message}
      </div>
    );
  }

  if (!workOrder) return <p className="text-red-600">Work Order not found.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{workOrder.wo_number}</h1>
          <p className="mt-2 text-gray-500">
            Complete work order view with RA Bills, invoices, payments and vendors.
          </p>
        </div>

       <div className="flex gap-3">
  <button
    type="button"
    onClick={downloadWOLedger}
    className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-white hover:bg-slate-800"
  >
    <Download className="h-4 w-4" />
    Download Ledger
  </button>

  <Link href="/work-orders" className="rounded-lg border px-4 py-2">
    Back to Work Orders
  </Link>
</div>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <Summary title="Work Order Value" value={money(totals.woValue)} />
        <Summary title="Total RA Bills" value={money(totals.totalRa)} />
        <Summary title="Total Invoices" value={money(totals.totalInvoices)} />
        <Summary title="Total Payments" value={money(totals.totalPayments)} />
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <Summary title="RA Bills" value={String(raBills.length)} />
        <Summary title="Invoices" value={String(invoices.length)} />
        <Summary title="Payments" value={String(payments.length)} />
        <Summary title="Debit Notes" value={String(debitNotes.length)} />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
<Summary title="Balance WO Value" value={money(totals.balanceWoValue)} />
<Summary title="RA Bills Minus Invoices" value={money(totals.raMinusInvoices)} />
<Summary title="Payable Outstanding" value={money(totals.payableOutstanding)} />
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Work Order Information</h2>

        <div className="grid gap-4 md:grid-cols-3">
          <Info label="WO Number" value={workOrder.wo_number} />
          <Info label="Company" value={company?.company_name || "-"} />
          <Info label="Site" value={site?.site_name || "-"} />
          <Info label="Site Location" value={site?.location || "-"} />
          <Info label="WO Date" value={workOrder.wo_date || "-"} />
          <Info label="WO Type" value={workOrder.wo_type || "-"} />
          <Info label="Status" value={workOrder.status || "-"} />
          <Info label="Approval Status" value={workOrder.approval_status || "-"} />
          <Info label="WO Value" value={money(workOrder.wo_value)} />
          <Info label="GST Percent" value={workOrder.gst_percent ? `${workOrder.gst_percent}%` : "-"} />
          <Info label="Department" value={workOrder.department || "-"} />
          <Info label="Cost Code" value={workOrder.cost_code || "-"} />
          <Info label="Created By" value={workOrder.created_by_name || workOrder.created_by_email || "-"} />
          <Info label="Created At" value={formatDateTime(workOrder.created_at_user || workOrder.created_at)} />
          <Info label="Approved By" value={workOrder.approved_by_name || workOrder.approved_by_email || "-"} />
          <Info label="Approved At" value={formatDateTime(workOrder.approved_at)} />
        </div>
<div className="mt-6 border-t pt-4">
  <h3 className="mb-3 font-semibold">
    Work Order Files
  </h3>

  {documents.length === 0 ? (
    <p className="text-gray-500">
      No files attached.
    </p>
  ) : (
    <div className="space-y-2">
      {documents.map((doc) => (
        <div
          key={doc.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-slate-50 p-3"
        >
          <div>
            <p className="font-medium text-slate-950">
              {doc.file_name || "Work Order file"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {doc.file_path || "-"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => openDocument(doc)}
            className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800"
          >
            Open
          </button>
        </div>
      ))}
    </div>
  )}
</div>
        {workOrder.description && (
          <div className="mt-4">
            <p className="text-xs font-medium uppercase text-gray-500">Description</p>
            <p className="mt-1 text-gray-900">{workOrder.description}</p>
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">
          Linked Vendors ({vendors.length})
        </h2>

        {vendors.length === 0 ? (
          <p className="text-gray-500">No vendors linked.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {vendors.map((row) => (
              <div key={row.id} className="rounded-lg border p-4">
                <strong>{row.vendors?.vendor_name || "-"}</strong>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <Info label="Role" value={row.vendor_role || "-"} />
                  <Info label="Primary" value={row.is_primary ? "Yes" : "No"} />
                  <Info label="Type" value={row.vendors?.vendor_type || "-"} />
                  <Info label="PAN" value={row.vendors?.pan || "-"} />
                  <Info label="GSTIN" value={row.vendors?.gstin || "-"} />
                </div>

                {row.vendors?.id && (
                  <Link
                    href={`/vendors/${row.vendors.id}`}
                    className="mt-3 inline-block rounded border px-3 py-1 text-sm"
                  >
                    View Vendor
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

    <DataTable
      title={`Linked RA Bills (${raBills.length})`}
      empty="No RA Bills found."
      headers={[
        "RA Number",
        "RA Date",
        "Amount",
        "Status",
        "Approval Status",
        "Action",
      ]}
      rows={raBills.map((item) => [
        item.ra_number,
        item.ra_date || "-",
        money(item.net_amount),
        item.status || "Draft",
        item.approval_status || "Pending",
        <Link
          key={item.id}
          href={`/ra-bills/${item.id}`}
          className="rounded border px-3 py-1"
        >
          View
        </Link>,
      ])}
    />

    <DataTable
      title={`Linked Invoices (${invoices.length})`}
      empty="No invoices found."
      headers={[
        "Invoice Number",
        "Invoice Date",
        "Invoice Amount",
        "ITC Status",
        "Action",
      ]}
      rows={invoices.map((item) => [
        item.invoice_number,
        item.invoice_date || "-",
        money(item.invoice_amount),
        item.itc_status || "-",
        <Link
          key={item.id}
          href={`/invoices/${item.id}`}
          className="rounded border px-3 py-1"
        >
          View
        </Link>,
      ])}
    />

    <DataTable
      title={`Linked Payments (${payments.length})`}
      empty="No payments found."
      headers={[
        "Payment Number",
        "Payment Date",
        "Amount",
        "UTR Number",
      ]}
      rows={payments.map((item) => [
        item.payment_number,
        item.payment_date || "-",
        money(item.transferred_amount || item.payment_amount || item.total_payment),
        item.utr_number || item.reference_number || "-",
      ])}
    />

    <DataTable
  title="WO Ledger"
  empty="No ledger records found."
  headers={["Date", "Type", "Reference", "Amount", "Status"]}
  rows={woLedgerRows.map((item) => [
    item.date ? String(item.date).slice(0, 10) : "-",
    item.type,
    item.reference || "-",
    money(item.amount),
    item.status || "-",
  ])}
/>

<DataTable
  title={`Linked Debit Notes (${debitNotes.length})`}
  empty="No debit notes found."
  headers={["Debit Note Number", "Date", "Amount", "Status", "Action"]}
  rows={debitNotes.map((item) => [
    item.debit_note_number || "-",
    item.debit_note_date || "-",
    money(item.total_amount),
    item.status || item.approval_status || "-",
    <Link
      key={item.id}
      href={`/debit-notes/${item.id}`}
      className="rounded border px-3 py-1"
    >
      View
    </Link>,
  ])}
/>
        
    </div>
  );
}

function Summary({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-sm text-gray-500">{title}</p>
      <p className="mt-2 text-xl font-bold">{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-gray-500">{label}</p>
      <p className="mt-1 font-medium text-gray-900">{value}</p>
    </div>
  );
}

function DataTable({
  title,
  headers,
  rows,
  empty,
}: {
  title: string;
  headers: string[];
  rows: any[][];
  empty: string;
}) {
  return (
    <section className="rounded-lg border bg-white p-6">
      <h2 className="mb-4 text-xl font-semibold">{title}</h2>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-gray-100">
            <tr>
              {headers.map((header) => (
                <th key={header} className="p-3 text-left">
                  {header}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={headers.length} className="p-6 text-center text-gray-500">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t">
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
