"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileText, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
}

export default function NewRABillPage() {
  const router = useRouter();

  const [sites, setSites] = useState<any[]>([]);
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [selectedWO, setSelectedWO] = useState<any>(null);
  const [linkedVendor, setLinkedVendor] = useState<any>(null);
  const [previousRABills, setPreviousRABills] = useState<any[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [form, setForm] = useState({
    ra_number: "",
    work_order_id: "",
    vendor_id: "",
    ra_date: "",
    value_of_work_done: "",
    security_amount: "0",
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
      .eq("approval_status", "approved")
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

    setForm((prev) => ({
      ...prev,
      work_order_id: "",
      vendor_id: "",
      ra_number: "",
      value_of_work_done: "",
      security_amount: "0",
      remarks: "",
    }));
  }

  async function loadWorkOrderDetails(workOrderId: string) {
    setMessage("");
    setSelectedWO(null);
    setLinkedVendor(null);
    setPreviousRABills([]);

    if (!workOrderId) {
      setForm((prev) => ({
        ...prev,
        work_order_id: "",
        vendor_id: "",
        ra_number: "",
      }));
      return;
    }

    const wo = workOrders.find((item) => item.id === workOrderId);
    setSelectedWO(wo || null);

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

    if (vendorError) {
      setMessage(vendorError.message);
      return;
    }

    const primaryVendor =
      vendorData?.find((row: any) => row.is_primary) || vendorData?.[0];

    if (!primaryVendor?.vendors?.id) {
      setMessage("No vendor is linked to this Work Order.");
      return;
    }

    setLinkedVendor(primaryVendor);

    const { data: raData, error: raError } = await supabase
      .from("ra_bills")
      .select(`
        id,
        ra_number,
        ra_date,
        gross_amount,
        recovery_amount,
        gst_amount,
        net_amount,
        status,
        approval_status,
        created_at
      `)
      .eq("work_order_id", workOrderId)
      .order("created_at", { ascending: true });

    if (raError) {
      setMessage(raError.message);
      return;
    }

    const previousBills = raData || [];
    const suggestedNumber = String(previousBills.length + 1);

    setPreviousRABills(previousBills);

    setForm((prev) => ({
      ...prev,
      work_order_id: workOrderId,
      vendor_id: primaryVendor.vendors.id,
      ra_number: suggestedNumber,
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
        ra_number: "",
      }));

      loadWorkOrderDetails(value);
      return;
    }

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  const taxableAmount = useMemo(() => {
    const value = Number(form.value_of_work_done || 0);
    const security = Number(form.security_amount || 0);
    return Math.max(value - security, 0);
  }, [form.value_of_work_done, form.security_amount]);

  const gstAmount = useMemo(() => {
    const gstRate = Number(form.gst_rate || 0);
    return Math.round((taxableAmount * gstRate) / 100);
  }, [taxableAmount, form.gst_rate]);

  const netPayable = useMemo(() => {
    return taxableAmount + gstAmount;
  }, [taxableAmount, gstAmount]);

  const previousRATotal = useMemo(() => {
    return previousRABills.reduce(
      (sum, item) => sum + Number(item.gross_amount || 0),
      0
    );
  }, [previousRABills]);

  const currentRAValue = Number(form.value_of_work_done || 0);
  const woValue = Number(selectedWO?.wo_value || 0);
  const totalAfterThisRA = previousRATotal + currentRAValue;
  const balanceAfterThisRA = woValue - totalAfterThisRA;
  const exceedsWO = selectedWO && balanceAfterThisRA < 0;

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

    if (!form.ra_number.trim()) {
      setMessage("RA Bill Number is required.");
      return;
    }

    if (!form.value_of_work_done || Number(form.value_of_work_done) <= 0) {
      setMessage("Value of work done is required.");
      return;
    }

    if (files.length === 0) {
      setMessage("At least one RA Bill attachment is required.");
      return;
    }

    try {
      setSaving(true);

      const organizationId = "7208169c-4e3f-4d6b-b068-31931a39120f";

      const { data, error } = await supabase
        .from("ra_bills")
        .insert({
          organization_id: organizationId,
          work_order_id: form.work_order_id,
          vendor_id: form.vendor_id,
          ra_number: form.ra_number.trim(),
          ra_date: form.ra_date || null,

          gross_amount: Number(form.value_of_work_done) || 0,
          recovery_amount: Number(form.security_amount) || 0,
          retention_amount: 0,
          gst_rate: Number(form.gst_rate) || 0,
          gst_amount: gstAmount,
          net_amount: netPayable,

          status: "Draft",
          approval_status: "Pending",
          remarks: form.remarks.trim() || null,
        })
        .select("id")
        .single();

      if (error) throw error;

      for (const file of files) {
        const safeName = file.name.replace(/[^a-zA-Z0-9.]/g, "_");
        const path = `${organizationId}/ra-bills/${data.id}/${Date.now()}_${safeName}`;

        const { error: uploadError } = await supabase.storage
          .from("ra-bill-documents")
          .upload(path, file);

        if (uploadError) throw uploadError;

        const { error: documentError } = await supabase
          .from("ra_bill_documents")
          .insert({
            organization_id: organizationId,
            ra_bill_id: data.id,
            file_name: file.name,
            file_url: path,
          });

        if (documentError) throw documentError;
      }

      router.push(`/ra-bills/${data.id}`);
    } catch (err: any) {
      setMessage(err.message || "Failed to create RA Bill");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
            <FileText className="h-3.5 w-3.5" />
            Contract Management
          </div>
          <h1 className="text-3xl font-bold text-slate-950">New RA Bill</h1>
          <p className="text-sm text-slate-500">
            Site-wise RA bill creation against approved work orders.
          </p>
        </div>

        <Link
          href="/ra-bills"
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

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Step 1
        </p>
        <h2 className="text-xl font-semibold text-slate-950">
          Select Site & Work Order
        </h2>
        <p className="mb-4 text-sm text-slate-500">
          Select site first. Work orders will be filtered for that site.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Site *">
            <select
              value={selectedSiteId}
              onChange={handleSiteChange}
              className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400"
            >
              <option value="">Select Site</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.site_name} {site.site_code ? `(${site.site_code})` : ""}
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
              className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400 disabled:bg-slate-100"
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
            <Summary title="Site" value={selectedWO.sites?.site_name || "-"} />
            <Summary
              title="Company"
              value={selectedWO.companies?.company_name || "-"}
            />
            <Summary title="WO Number" value={selectedWO.wo_number || "-"} />
            <Summary
              title="Vendor"
              value={linkedVendor?.vendors?.vendor_name || "-"}
            />
          </section>

          <section className="grid gap-4 md:grid-cols-4">
            <Summary title="WO Value" value={money(woValue)} />
            <Summary title="Previous RA Total" value={money(previousRATotal)} />
            <Summary title="Current RA" value={money(currentRAValue)} />
            <Summary
              title="Balance After This RA"
              value={money(balanceAfterThisRA)}
              warning={balanceAfterThisRA < 0}
            />
          </section>

          {exceedsWO && (
            <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
              Warning: Total billed amount after this RA exceeds the Work Order
              value by {money(Math.abs(balanceAfterThisRA))}. You can still
              submit, but please verify before saving.
            </div>
          )}

          <section className="rounded-2xl border bg-white p-6 shadow-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              History
            </p>
            <h2 className="text-xl font-semibold text-slate-950">
              Previous RA Bills
            </h2>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-3 text-left">RA No</th>
                    <th className="p-3 text-left">Date</th>
                    <th className="p-3 text-right">Gross</th>
                    <th className="p-3 text-right">GST</th>
                    <th className="p-3 text-right">Net</th>
                    <th className="p-3 text-left">Approval</th>
                  </tr>
                </thead>

                <tbody>
                  {previousRABills.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-slate-500">
                        No previous RA bills found for this Work Order.
                      </td>
                    </tr>
                  ) : (
                    previousRABills.map((bill) => (
                      <tr key={bill.id} className="border-t">
                        <td className="p-3 font-medium">{bill.ra_number}</td>
                        <td className="p-3">{bill.ra_date || "-"}</td>
                        <td className="p-3 text-right">
                          {money(bill.gross_amount)}
                        </td>
                        <td className="p-3 text-right">
                          {money(bill.gst_amount)}
                        </td>
                        <td className="p-3 text-right">
                          {money(bill.net_amount)}
                        </td>
                        <td className="p-3">
                          {bill.approval_status || "Pending"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-6 shadow-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Step 2
            </p>
            <h2 className="text-xl font-semibold text-slate-950">
              New RA Bill Details
            </h2>
            <p className="mb-5 text-sm text-slate-500">
              RA number is auto-suggested but editable.
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="RA Bill Number *">
                <input
                  type="text"
                  name="ra_number"
                  value={form.ra_number}
                  onChange={handleChange}
                  className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400"
                  placeholder="1, 2, 3, Full & Final"
                />
              </Field>

              <Field label="RA Date">
                <input
                  type="date"
                  name="ra_date"
                  value={form.ra_date}
                  onChange={handleChange}
                  className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400"
                />
              </Field>

              <Field label="Value of Work Done *">
                <input
                  type="number"
                  name="value_of_work_done"
                  value={form.value_of_work_done}
                  onChange={handleChange}
                  className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400"
                />
              </Field>

              <Field label="Security Deduction">
                <input
                  type="number"
                  name="security_amount"
                  value={form.security_amount}
                  onChange={handleChange}
                  className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400"
                />
              </Field>

              <Field label="Taxable Amount">
                <input
                  value={money(taxableAmount)}
                  readOnly
                  className="h-11 w-full rounded-xl border bg-slate-50 px-3 text-sm"
                />
              </Field>

              <Field label="GST Rate %">
                <select
                  name="gst_rate"
                  value={form.gst_rate}
                  onChange={handleChange}
                  className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400"
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

              <Field label="Amount Payable">
                <input
                  value={money(netPayable)}
                  readOnly
                  className="h-11 w-full rounded-xl border bg-emerald-50 px-3 text-sm font-semibold text-emerald-700"
                />
              </Field>

              <div className="md:col-span-2">
                <Field label="Remarks">
                  <textarea
                    name="remarks"
                    value={form.remarks}
                    onChange={handleChange}
                    className="min-h-24 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-slate-400"
                  />
                </Field>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-6 shadow-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Step 3
            </p>
            <h2 className="text-xl font-semibold text-slate-950">
              Attachments
            </h2>

            <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed bg-slate-50 p-8 text-center hover:bg-slate-100">
              <Upload className="mb-2 h-6 w-6 text-slate-400" />
              <span className="text-sm font-medium text-slate-700">
                Click to upload files
              </span>
              <span className="mt-1 text-xs text-slate-500">
                Multiple files allowed. At least one attachment is required.
              </span>
              <input
                type="file"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
                className="hidden"
              />
            </label>

            {files.length > 0 && (
              <div className="mt-4 space-y-2">
                {files.map((file) => (
                  <div
                    key={file.name}
                    className="rounded-xl border bg-white px-3 py-2 text-sm"
                  >
                    {file.name}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border bg-white p-6 shadow-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Step 4
            </p>
            <h2 className="text-xl font-semibold text-slate-950">
              Billing Summary
            </h2>

            <div className="mt-5 grid gap-4 md:grid-cols-5">
              <Summary title="Total Billed" value={money(totalAfterThisRA)} />
              <Summary
                title="Balance Remaining"
                value={money(balanceAfterThisRA)}
                warning={balanceAfterThisRA < 0}
              />
              <Summary title="Taxable Amount" value={money(taxableAmount)} />
              <Summary title="GST Amount" value={money(gstAmount)} />
              <Summary title="Amount Payable" value={money(netPayable)} />
            </div>
          </section>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-slate-950 px-6 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save RA Bill"}
            </button>
          </div>
        </>
      )}
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