"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  FileText,
  Paperclip,
} from "lucide-react";
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

export default function InvoiceDetailPage() {
  const params = useParams();
  const invoiceId = params.id as string;

  const [invoice, setInvoice] = useState<any>(null);
  const [workOrder, setWorkOrder] = useState<any>(null);
  const [company, setCompany] = useState<any>(null);
  const [site, setSite] = useState<any>(null);
  const [vendor, setVendor] = useState<any>(null);
  const [document, setDocument] = useState<any>(null);

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadInvoice();
  }, [invoiceId]);

  async function loadInvoice() {
    try {
      setLoading(true);
      setMessage("");

      const { data: invoiceData, error: invoiceError } = await supabase
        .from("invoices")
        .select("*")
        .eq("id", invoiceId)
        .single();

      if (invoiceError) throw invoiceError;

      setInvoice(invoiceData);

      if (invoiceData.work_order_id) {
        const { data: woData, error: woError } = await supabase
          .from("work_orders")
          .select("id, wo_number, wo_value, wo_date, company_id, site_id")
          .eq("id", invoiceData.work_order_id)
          .maybeSingle();

        if (woError) throw woError;

        setWorkOrder(woData);

        if (woData?.company_id) {
          const { data: companyData } = await supabase
            .from("companies")
            .select("id, company_name, company_code")
            .eq("id", woData.company_id)
            .maybeSingle();

          setCompany(companyData);
        }

        if (woData?.site_id) {
          const { data: siteData } = await supabase
            .from("sites")
            .select("id, site_name, site_code")
            .eq("id", woData.site_id)
            .maybeSingle();

          setSite(siteData);
        }
      }

      if (invoiceData.vendor_id) {
        const { data: vendorData, error: vendorError } = await supabase
          .from("vendors")
          .select("id, vendor_name, pan, gstin")
          .eq("id", invoiceData.vendor_id)
          .maybeSingle();

        if (vendorError) throw vendorError;

        setVendor(vendorData);
      }

      const { data: documentData, error: documentError } = await supabase
        .from("invoice_documents")
        .select("*")
        .eq("invoice_id", invoiceId)
        .maybeSingle();

      if (documentError) throw documentError;

      setDocument(documentData);
    } catch (error: any) {
      setMessage(error.message || "Failed to load invoice.");
    } finally {
      setLoading(false);
    }
  }

  async function openDocument(path: string | null) {
    if (!path) return;

    const { data, error } = await supabase.storage
      .from("invoice-documents")
      .createSignedUrl(path, 60);

    if (error) {
      setMessage(error.message);
      return;
    }

    window.open(data.signedUrl, "_blank");
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading invoice...</p>;
  }

  if (message) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {message}
      </div>
    );
  }

  if (!invoice) {
    return <p className="text-red-600">Invoice not found.</p>;
  }

  const itcStatus = invoice.itc_status || "Pending";

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
            <FileText className="h-3.5 w-3.5" />
            Invoice Detail
          </div>

          <h1 className="text-3xl font-bold text-slate-950">
            Invoice {invoice.invoice_number}
          </h1>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(
                itcStatus
              )}`}
            >
              ITC {itcStatus}
            </span>

            <span className="text-sm text-slate-500">
              Created against WO {workOrder?.wo_number || "-"}
            </span>
          </div>
        </div>

        <Link
          href="/invoices"
          className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Invoices
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Summary title="Taxable Amount" value={money(invoice.taxable_amount)} />
        <Summary title="GST Amount" value={money(invoice.gst_amount)} />
        <Summary title="Invoice Amount" value={money(invoice.invoice_amount)} />
        <Summary title="ITC Status" value={itcStatus} />
      </div>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Building2 className="h-5 w-5 text-slate-400" />
          <h2 className="text-xl font-semibold text-slate-950">
            Work Order & Vendor Details
          </h2>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Info label="Work Order" value={workOrder?.wo_number || "-"} />
          <Info label="Company" value={company?.company_name || "-"} />
          <Info label="Site" value={site?.site_name || "-"} />
          <Info label="Vendor" value={vendor?.vendor_name || "-"} />
          <Info label="WO Date" value={workOrder?.wo_date || "-"} />
          <Info label="WO Value" value={money(workOrder?.wo_value)} />
          <Info label="PAN" value={vendor?.pan || "-"} />
          <Info label="GSTIN" value={vendor?.gstin || "-"} />
        </div>

        {invoice.work_order_id && (
          <Link
            href={`/work-orders/${invoice.work_order_id}`}
            className="mt-5 inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Open Work Order
            <ExternalLink className="h-4 w-4" />
          </Link>
        )}
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold text-slate-950">
          Invoice Information
        </h2>

        <div className="grid gap-4 md:grid-cols-4">
          <Info label="Invoice Number" value={invoice.invoice_number || "-"} />
          <Info label="Invoice Date" value={invoice.invoice_date || "-"} />
          <Info label="Taxable Amount" value={money(invoice.taxable_amount)} />
          <Info label="GST Rate" value={`${invoice.gst_rate || 0}%`} />
          <Info label="GST Amount" value={money(invoice.gst_amount)} />
          <Info label="Invoice Amount" value={money(invoice.invoice_amount)} />
          <Info label="Status" value={invoice.status || "-"} />
          <Info label="Approval Status" value={invoice.approval_status || "-"} />
          <Info label="Created By" value={invoice.created_by_name || "-"} />
          <Info label="Created Email" value={invoice.created_by_email || "-"} />
        </div>

        {invoice.remarks && (
          <div className="mt-6 border-t pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Remarks
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              {invoice.remarks}
            </p>
          </div>
        )}
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold text-slate-950">
          ITC Tracking
        </h2>

        <div className="grid gap-4 md:grid-cols-4">
          <Info label="ITC Status" value={itcStatus} />
          <Info label="Claimed By" value={invoice.itc_claimed_by_name || "-"} />
          <Info label="Claimed Email" value={invoice.itc_claimed_by_email || "-"} />
          <Info
            label="Claimed At"
            value={
              invoice.itc_claimed_at
                ? new Date(invoice.itc_claimed_at).toLocaleString()
                : "-"
            }
          />
          <Info label="Rejected By" value={invoice.itc_rejected_by_name || "-"} />
          <Info
            label="Rejected Email"
            value={invoice.itc_rejected_by_email || "-"}
          />
          <Info
            label="Rejected At"
            value={
              invoice.itc_rejected_at
                ? new Date(invoice.itc_rejected_at).toLocaleString()
                : "-"
            }
          />
        </div>

        {invoice.itc_rejection_reason && (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-red-700">
              ITC Rejection Reason
            </p>
            <p className="mt-2 text-sm leading-6 text-red-800">
              {invoice.itc_rejection_reason}
            </p>
          </div>
        )}
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Paperclip className="h-5 w-5 text-slate-400" />
          <h2 className="text-xl font-semibold text-slate-950">Invoice PDF</h2>
        </div>

        {!document ? (
          <p className="text-sm text-red-600">No invoice PDF found.</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-3">
            <div>
              <p className="font-medium text-slate-950">{document.file_name}</p>
              <p className="text-xs text-slate-500">
                Uploaded:{" "}
                {document.uploaded_at
                  ? new Date(document.uploaded_at).toLocaleString()
                  : "-"}
              </p>
            </div>

            <button
              type="button"
              onClick={() => openDocument(document.file_url)}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800"
            >
              Open PDF
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </section>
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

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 font-medium text-slate-950">{value}</p>
    </div>
  );
}