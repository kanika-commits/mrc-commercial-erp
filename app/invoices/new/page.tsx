"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  FileText,
  ReceiptText,
  Upload,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
}

export default function NewInvoicePage() {
  const router = useRouter();

  const [sites, setSites] = useState<any[]>([]);
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [selectedWO, setSelectedWO] = useState<any>(null);
  const [linkedVendor, setLinkedVendor] = useState<any>(null);
  const [previousRABills, setPreviousRABills] = useState<any[]>([]);
  const [previousInvoices, setPreviousInvoices] = useState<any[]>([]);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [form, setForm] = useState({
    work_order_id: "",
    vendor_id: "",
    invoice_number: "",
    invoice_date: "",
    taxable_amount: "",
    gst_rate: "18",
    remarks: "",
  });

  useEffect(() => {
    loadInitialData();
  }, []);

  async function loadInitialData() {
    const { data: siteData, error: siteError } = await supabase
      .from("sites")
      .select("id, site_name, site_code, company_id")
      .eq("status", "active")
      .order("site_name");

    if (siteError) {
      setMessage(siteError.message);
      return;
    }

    const { data: woData, error: woError } = await supabase
      .from("work_orders")
      .select(`
        id,
        wo_number,
        wo_date,
        wo_value,
        company_id,
        site_id,
        companies (
          id,
          company_name,
          company_code
        ),
        sites (
          id,
          site_name,
          site_code
        )
      `)
      .in("approval_status", ["Approved", "approved"])
      .eq("status", "active")
      .order("wo_number");

    if (woError) {
      setMessage(woError.message);
      return;
    }

    setSites(siteData || []);
    setWorkOrders(woData || []);
  }

  const filteredWorkOrders = useMemo(() => {
    if (!selectedSiteId) return [];
    return workOrders.filter((wo) => wo.site_id === selectedSiteId);
  }, [workOrders, selectedSiteId]);

  function handleSiteChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const siteId = e.target.value;

    setSelectedSiteId(siteId);
    setSelectedWO(null);
    setLinkedVendor(null);
    setPreviousRABills([]);
    setPreviousInvoices([]);

    setForm((prev) => ({
      ...prev,
      work_order_id: "",
      vendor_id: "",
      invoice_number: "",
      taxable_amount: "",
      remarks: "",
    }));
  }

  async function loadWorkOrderDetails(workOrderId: string) {
    setMessage("");
    setSelectedWO(null);
    setLinkedVendor(null);
    setPreviousRABills([]);
    setPreviousInvoices([]);

    if (!workOrderId) return;

    const wo = workOrders.find((item) => item.id === workOrderId);
    setSelectedWO(wo || null);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setMessage("Please sign in again to resolve the linked vendor.");
      return;
    }

    const vendorResponse = await fetch(
      `/api/work-orders/vendors?work_order_id=${encodeURIComponent(
        workOrderId
      )}`,
      {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      }
    );

    const vendorResult = await vendorResponse.json();

    if (!vendorResponse.ok) {
      setMessage(vendorResult.error || "Failed to resolve Work Order vendor.");
      return;
    }

    const linkedVendor = vendorResult.vendors?.[workOrderId];

    if (!linkedVendor?.vendor_id) {
      setMessage("No vendor is linked to this Work Order.");
      return;
    }

    setLinkedVendor(linkedVendor);

    const { data: raData, error: raError } = await supabase
      .from("ra_bills")
      .select(`
        id,
        ra_number,
        ra_date,
        gross_amount,
        gst_amount,
        net_amount,
        approval_status,
        created_at
      `)
      .eq("work_order_id", workOrderId)
      .ilike("approval_status", "approved")
      .order("created_at", { ascending: true });

    if (raError) {
      setMessage(raError.message);
      return;
    }

    const { data: invoiceData, error: invoiceError } = await supabase
      .from("invoices")
      .select(`
        id,
        invoice_number,
        invoice_date,
        taxable_amount,
        gst_amount,
        invoice_amount,
        itc_status,
        created_at
      `)
      .eq("work_order_id", workOrderId)
      .order("created_at", { ascending: true });

    if (invoiceError) {
      setMessage(invoiceError.message);
      return;
    }

    setPreviousRABills(raData || []);
    setPreviousInvoices(invoiceData || []);

    setForm((prev) => ({
      ...prev,
      work_order_id: workOrderId,
      vendor_id: linkedVendor.vendor_id,
    }));
  }

  function handleChange(
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >
  ) {
    const { name, value } = e.target;

    if (name === "work_order_id") {
      setForm((prev) => ({
        ...prev,
        work_order_id: value,
        vendor_id: "",
      }));

      loadWorkOrderDetails(value);
      return;
    }

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  const gstAmount = useMemo(() => {
    const taxable = Number(form.taxable_amount || 0);
    const gstRate = Number(form.gst_rate || 0);
    return Math.round((taxable * gstRate) / 100);
  }, [form.taxable_amount, form.gst_rate]);

  const invoiceAmount = useMemo(() => {
    const taxable = Number(form.taxable_amount || 0);
    return Math.round(taxable + gstAmount);
  }, [form.taxable_amount, gstAmount]);

  const totalRABills = useMemo(() => {
    return previousRABills.reduce(
      (sum, bill) => sum + Number(bill.net_amount || 0),
      0
    );
  }, [previousRABills]);

  const totalInvoices = useMemo(() => {
    return previousInvoices.reduce(
      (sum, invoice) => sum + Number(invoice.invoice_amount || 0),
      0
    );
  }, [previousInvoices]);

  const totalAfterThisInvoice = totalInvoices + invoiceAmount;
  const raVsInvoiceBalance = totalRABills - totalAfterThisInvoice;
  const invoiceExceedsRA = totalAfterThisInvoice > totalRABills;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    if (!selectedSiteId) {
      setMessage("Site is required.");
      return;
    }

    if (!form.work_order_id) {
      setMessage("Work Order is required.");
      return;
    }

    if (!form.vendor_id) {
      setMessage("Vendor could not be found for this Work Order.");
      return;
    }

    if (!form.invoice_number.trim()) {
      setMessage("Vendor Invoice Number is required.");
      return;
    }

    if (!form.invoice_date) {
      setMessage("Invoice Date is required.");
      return;
    }

    if (!form.taxable_amount || Number(form.taxable_amount) <= 0) {
      setMessage("Taxable amount is required.");
      return;
    }

    if (!invoiceFile) {
      setMessage("Invoice PDF is required.");
      return;
    }

    if (invoiceFile.type !== "application/pdf") {
      setMessage("Only PDF file is allowed for invoice.");
      return;
    }

    try {
      setSaving(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Please sign in again to create the invoice.");
      }

      const formData = new FormData();
      formData.append("work_order_id", form.work_order_id);
      formData.append("vendor_id", form.vendor_id);
      formData.append("invoice_number", form.invoice_number.trim());
      formData.append("invoice_date", form.invoice_date);
      formData.append(
        "taxable_amount",
        String(Math.round(Number(form.taxable_amount) || 0))
      );
      formData.append("gst_rate", String(Number(form.gst_rate) || 0));
      formData.append("gst_amount", String(gstAmount));
      formData.append("invoice_amount", String(invoiceAmount));
      formData.append("remarks", form.remarks.trim());
      formData.append("invoice_file", invoiceFile);

      const response = await fetch("/api/invoices", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to create invoice.");
      }

      router.push(`/invoices/${result.id}`);
    } catch (error: any) {
      setMessage(error.message || "Failed to create invoice.");
    } finally {
      setSaving(false);
    }
  }

  const steps = [
    {
      title: "Select Site & WO",
      caption: "Approved work order",
      done: Boolean(selectedWO),
    },
    {
      title: "Vendor Invoice Details",
      caption: "Tax and amount",
      done: Boolean(form.invoice_number && form.taxable_amount),
    },
    {
      title: "Attachments",
      caption: "Invoice PDF",
      done: Boolean(invoiceFile),
    },
    {
      title: "Summary",
      caption: "Submit to ITC queue",
      done: false,
    },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
            <FileText className="h-3.5 w-3.5" />
            Invoice Coordination
          </div>
          <h1 className="text-3xl font-bold text-slate-950">New Invoice</h1>
          <p className="text-sm text-slate-500">
            Submit vendor invoice and send it to ITC claim queue.
          </p>
        </div>

        <Link
          href="/invoices"
          className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      </div>

      {message && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {message}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="h-fit rounded-2xl border bg-white p-5 shadow-sm lg:sticky lg:top-24">
          <h2 className="text-lg font-semibold text-slate-950">
            Invoice Wizard
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Select an approved Work Order, upload the invoice PDF, then submit
            it to the ITC queue.
          </p>

          <div className="mt-6 space-y-3">
            {steps.map((step, index) => (
              <div
                key={step.title}
                className={`flex items-center gap-3 rounded-xl border p-3 ${
                  step.done
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-slate-200 bg-slate-50"
                }`}
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    step.done
                      ? "bg-emerald-600 text-white"
                      : "bg-white text-slate-600"
                  }`}
                >
                  {step.done ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                </div>
                <div>
                  <p className="font-medium text-slate-950">{step.title}</p>
                  <p className="text-xs text-slate-500">{step.caption}</p>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="space-y-6">
          <section className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-sky-50 p-2 text-sky-700">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Step 1
                </p>
                <h2 className="text-xl font-semibold text-slate-950">
                  Select Site & Work Order
                </h2>
                <p className="text-sm text-slate-500">
                  Work Orders are filtered by site and approval status.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Field label="Site *">
                <select
                  value={selectedSiteId}
                  onChange={handleSiteChange}
                  className="h-11 w-full rounded-xl border px-3 text-sm"
                >
                  <option value="">Select Site</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.site_name}{" "}
                      {site.site_code ? `(${site.site_code})` : ""}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Work Order *">
                <select
                  name="work_order_id"
                  value={form.work_order_id}
                  onChange={handleChange}
                  disabled={!selectedSiteId}
                  className="h-11 w-full rounded-xl border px-3 text-sm disabled:bg-slate-100"
                >
                  <option value="">
                    {selectedSiteId ? "Select Work Order" : "Select Site First"}
                  </option>
                  {filteredWorkOrders.map((wo) => (
                    <option key={wo.id} value={wo.id}>
                      {wo.wo_number}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </section>

          {selectedWO && (
            <>
              <section className="grid gap-4 md:grid-cols-4">
                <Summary
                  title="Site"
                  value={selectedWO.sites?.site_name || "-"}
                />
                <Summary
                  title="Company"
                  value={selectedWO.companies?.company_name || "-"}
                />
                <Summary title="WO Number" value={selectedWO.wo_number || "-"} />
                <Summary
                  title="Vendor"
                  value={linkedVendor?.vendor_name || "-"}
                />
              </section>

              <section className="grid gap-4 md:grid-cols-4">
                <Summary title="WO Value" value={money(selectedWO.wo_value)} />
                <Summary title="Approved RA Total" value={money(totalRABills)} />
                <Summary
                  title="Previous Invoice Total"
                  value={money(totalInvoices)}
                />
                <Summary
                  title="RA - Invoice Balance"
                  value={money(raVsInvoiceBalance)}
                  warning={invoiceExceedsRA}
                />
              </section>

              {invoiceExceedsRA && (
                <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
                  Warning: Total invoices after this entry exceed approved RA
                  bills by {money(Math.abs(raVsInvoiceBalance))}. You can still
                  submit, but please verify before saving.
                </div>
              )}

              <section className="rounded-2xl border bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-xl font-semibold text-slate-950">
                  Approved RA Bills
                </h2>

                <HistoryTable
                  emptyText="No approved RA bills found for this Work Order."
                  columns={["RA No", "Date", "Gross", "GST", "Net"]}
                  rows={previousRABills.map((bill) => [
                    bill.ra_number || "-",
                    bill.ra_date || "-",
                    money(bill.gross_amount),
                    money(bill.gst_amount),
                    money(bill.net_amount),
                  ])}
                />
              </section>

              <section className="rounded-2xl border bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-xl font-semibold text-slate-950">
                  Previous Invoices
                </h2>

                <HistoryTable
                  emptyText="No previous invoices found for this Work Order."
                  columns={[
                    "Invoice No",
                    "Date",
                    "Taxable",
                    "GST",
                    "Total",
                    "ITC",
                  ]}
                  rows={previousInvoices.map((invoice) => [
                    invoice.invoice_number || "-",
                    invoice.invoice_date || "-",
                    money(invoice.taxable_amount),
                    money(invoice.gst_amount),
                    money(invoice.invoice_amount),
                    invoice.itc_status || "Pending",
                  ])}
                />
              </section>

              <section className="rounded-2xl border bg-white p-6 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-slate-100 p-2 text-slate-700">
                    <ReceiptText className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Step 2
                    </p>
                    <h2 className="text-xl font-semibold text-slate-950">
                      Vendor Invoice Details
                    </h2>
                    <p className="text-sm text-slate-500">
                      Enter the tax values exactly as shown on the uploaded PDF.
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <Field label="Vendor Invoice Number *">
                    <input
                      name="invoice_number"
                      value={form.invoice_number}
                      onChange={handleChange}
                      className="h-11 w-full rounded-xl border px-3 text-sm"
                    />
                  </Field>

                  <Field label="Invoice Date">
                    <input
                      type="date"
                      name="invoice_date"
                      value={form.invoice_date}
                      onChange={handleChange}
                      className="h-11 w-full rounded-xl border px-3 text-sm"
                    />
                  </Field>

                  <Field label="Taxable Amount *">
                    <input
                      type="number"
                      step="1"
                      min="0"
                      name="taxable_amount"
                      value={form.taxable_amount}
                      onChange={handleChange}
                      className="h-11 w-full rounded-xl border px-3 text-sm"
                    />
                  </Field>

                  <Field label="GST Rate %">
                    <select
                      name="gst_rate"
                      value={form.gst_rate}
                      onChange={handleChange}
                      className="h-11 w-full rounded-xl border px-3 text-sm"
                    >
                      <option value="0">0%</option>
                      <option value="5">5%</option>
                      <option value="12">12%</option>
                      <option value="18">18%</option>
                      <option value="28">28%</option>
                    </select>
                  </Field>

                  <Field label="GST Amount">
                    <input
                      value={money(gstAmount)}
                      readOnly
                      className="h-11 w-full rounded-xl border bg-slate-50 px-3 text-sm"
                    />
                  </Field>

                  <Field label="Total Invoice Amount">
                    <input
                      value={money(invoiceAmount)}
                      readOnly
                      className="h-11 w-full rounded-xl border bg-sky-50 px-3 text-sm font-semibold text-sky-800"
                    />
                  </Field>
                </div>
              </section>

              <section className="rounded-2xl border bg-white p-6 shadow-sm">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Step 3
                </p>
                <h2 className="text-xl font-semibold text-slate-950">
                  Attachments
                </h2>

                <div className="mt-4">
                  <Field label="Invoice PDF *">
                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed bg-slate-50 p-8 text-center hover:bg-slate-100">
                      <Upload className="mb-2 h-6 w-6 text-slate-400" />
                      <span className="text-sm font-medium text-slate-700">
                        Click to upload invoice PDF
                      </span>
                      <span className="mt-1 text-xs text-slate-500">
                        Only one PDF invoice is allowed.
                      </span>
                      <input
                        type="file"
                        accept=".pdf,application/pdf"
                        onChange={(e) =>
                          setInvoiceFile(e.target.files?.[0] || null)
                        }
                        className="hidden"
                      />
                    </label>

                    {invoiceFile && (
                      <div className="mt-3 rounded-xl border bg-white px-3 py-2 text-sm">
                        {invoiceFile.name}
                      </div>
                    )}
                  </Field>
                </div>
              </section>

              <section className="rounded-2xl border bg-white p-6 shadow-sm">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Step 4
                </p>
                <h2 className="text-xl font-semibold text-slate-950">
                  Summary
                </h2>

                <div className="mt-5 grid gap-4 md:grid-cols-4">
                  <Summary title="Taxable" value={money(form.taxable_amount)} />
                  <Summary title="GST" value={money(gstAmount)} />
                  <Summary title="Invoice Total" value={money(invoiceAmount)} />
                  <Summary title="ITC Status" value="Pending" />
                </div>

                <div className="mt-5">
                  <Field label="Remarks">
                    <textarea
                      name="remarks"
                      value={form.remarks}
                      onChange={handleChange}
                      className="min-h-24 w-full rounded-xl border px-3 py-2 text-sm"
                    />
                  </Field>
                </div>
              </section>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving || !form.vendor_id}
                  className="rounded-xl bg-slate-950 px-6 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Submit Invoice"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </span>
      {children}
    </label>
  );
}

function Summary({
  title,
  value,
  warning,
}: {
  title: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-5 shadow-sm ${
        warning ? "border-yellow-200 bg-yellow-50" : "bg-white"
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {title}
      </p>
      <p className="mt-2 text-lg font-bold text-slate-950">{value}</p>
    </div>
  );
}

function HistoryTable({
  columns,
  rows,
  emptyText,
}: {
  columns: string[];
  rows: string[][];
  emptyText: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[700px] text-sm">
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
              <td colSpan={columns.length} className="p-6 text-center text-slate-500">
                {emptyText}
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
  );
}
