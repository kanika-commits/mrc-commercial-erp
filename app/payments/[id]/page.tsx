"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Building2, CreditCard, ReceiptText } from "lucide-react";
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

function accountLabel(account: any) {
  if (!account) return "-";
  const last4 = account.account_number ? account.account_number.slice(-4) : "----";
  return `${account.bank_name || "Bank"} | ${last4}`;
}

export default function PaymentDetailPage() {
  const params = useParams();
  const paymentId = params.id as string;

  const [payment, setPayment] = useState<any>(null);
  const [invoice, setInvoice] = useState<any>(null);
  const [workOrder, setWorkOrder] = useState<any>(null);
  const [vendor, setVendor] = useState<any>(null);
  const [company, setCompany] = useState<any>(null);
  const [site, setSite] = useState<any>(null);
  const [account, setAccount] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadPayment();
  }, [paymentId]);

  async function loadPayment() {
    try {
      setLoading(true);
      setMessage("");

      const { data: paymentData, error: paymentError } = await supabase
        .from("payments")
        .select("*")
        .eq("id", paymentId)
        .maybeSingle();

      if (paymentError) throw paymentError;
      if (!paymentData) throw new Error("Payment was not found.");

      setPayment(paymentData);

      if (paymentData.invoice_id) {
        const { data: invoiceData } = await supabase
          .from("invoices")
          .select(
            "id, invoice_number, invoice_date, invoice_amount, taxable_amount, gst_amount, itc_status"
          )
          .eq("id", paymentData.invoice_id)
          .maybeSingle();

        setInvoice(invoiceData);
      }

      if (paymentData.work_order_id) {
        const { data: woData } = await supabase
          .from("work_orders")
          .select("id, wo_number, company_id, site_id")
          .eq("id", paymentData.work_order_id)
          .maybeSingle();

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

      if (paymentData.vendor_id) {
        const { data: vendorData } = await supabase
          .from("vendors")
          .select("id, vendor_name, pan, gstin")
          .eq("id", paymentData.vendor_id)
          .maybeSingle();

        setVendor(vendorData);
      }

      if (paymentData.company_bank_account_id) {
        const { data: accountData } = await supabase
          .from("company_bank_accounts")
          .select("id, bank_name, account_number, ifsc")
          .eq("id", paymentData.company_bank_account_id)
          .maybeSingle();

        setAccount(accountData);
      }
    } catch (error: any) {
      setMessage(error.message || "Failed to load payment.");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-slate-500">Loading payment...</div>;
  }

  if (message) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {message}
      </div>
    );
  }

  if (!payment) return null;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Payments / Detail
          </div>
          <h1 className="text-3xl font-bold text-slate-950">
            {payment.payment_number || "Payment"}
          </h1>
          <p className="text-sm text-slate-500">
            Invoice-linked payment record and transfer details.
          </p>
        </div>

        <Link
          href="/payments"
          className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Summary title="Total Payment" value={money(payment.total_payment)} />
        <Summary title="TDS" value={money(payment.tds_amount)} />
        <Summary
          title="Transferred Amount"
          value={money(payment.transferred_amount || payment.payment_amount)}
        />
        <Summary title="Payment Mode" value={payment.payment_mode || "-"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card icon={<CreditCard className="h-5 w-5" />} title="Payment Details">
          <Info label="Payment Date" value={payment.payment_date || "-"} />
          <Info label="Payment Type" value={payment.payment_type || "Invoice"} />
          <Info
            label="UTR / Reference Number"
            value={payment.utr_number || payment.reference_number || "-"}
          />
          <Info label="From Account" value={accountLabel(account)} />
          <Info label="Status" value={payment.status || "-"} />
          <Info label="Remarks" value={payment.remarks || "-"} />
        </Card>

        <Card icon={<ReceiptText className="h-5 w-5" />} title="Linked Invoice">
          <Info label="Invoice Number" value={invoice?.invoice_number || "-"} />
          <Info label="Invoice Date" value={invoice?.invoice_date || "-"} />
          <Info label="Invoice Amount" value={money(invoice?.invoice_amount)} />
          <Info label="ITC Status" value={invoice?.itc_status || "-"} />
          <Info
            label="Invoice Link"
            value={invoice?.id ? `/invoices/${invoice.id}` : "-"}
            href={invoice?.id ? `/invoices/${invoice.id}` : undefined}
          />
        </Card>

        <Card icon={<Building2 className="h-5 w-5" />} title="Commercial Links">
          <Info label="Company" value={company?.company_name || "-"} />
          <Info label="Site" value={site?.site_name || "-"} />
          <Info
            label="Work Order"
            value={workOrder?.wo_number || "-"}
            href={workOrder?.id ? `/work-orders/${workOrder.id}` : undefined}
          />
          <Info label="Vendor" value={vendor?.vendor_name || "-"} />
        </Card>

        <Card icon={<ReceiptText className="h-5 w-5" />} title="Audit">
          <Info label="Created By" value={payment.created_by_name || "-"} />
          <Info label="Created Email" value={payment.created_by_email || "-"} />
          <Info label="Created At" value={formatDateTime(payment.created_at)} />
          <Info
            label="Created At User"
            value={formatDateTime(payment.created_at_user)}
          />
        </Card>
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

function Card({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <div className="rounded-xl bg-slate-100 p-2 text-slate-700">{icon}</div>
        <h2 className="font-semibold text-slate-950">{title}</h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Info({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="rounded-xl border bg-slate-50 px-3 py-2.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      {href ? (
        <Link
          href={href}
          className="mt-1 block text-sm font-medium text-blue-600 hover:underline"
        >
          {value}
        </Link>
      ) : (
        <p className="mt-1 text-sm font-medium text-slate-950">{value}</p>
      )}
    </div>
  );
}
