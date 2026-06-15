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
  const [linkedVendorId, setLinkedVendorId] = useState("");
  const [linkedVendorName, setLinkedVendorName] = useState("");
  const [linkedVendorRole, setLinkedVendorRole] = useState("");
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
    clearLinkedVendor();
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
    clearLinkedVendor();
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

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setMessage("Please log in again before creating an RA Bill.");
      return;
    }

    const vendorResponse = await fetch(
      `/api/ra-bills/work-order-vendor?work_order_id=${encodeURIComponent(
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
      setMessage(vendorResult.error || "No vendor is linked to this Work Order.");
      return;
    }

    setLinkedVendorId(vendorResult.vendor_id || "");
    setLinkedVendorName(vendorResult.vendor_name || "-");
    setLinkedVendorRole(vendorResult.vendor_role || "-");

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
      vendor_id: vendorResult.vendor_id,
      ra_number: suggestedNumber,
    }));
  }

  function clearLinkedVendor() {
    setLinkedVendorId("");
    setLinkedVendorName("");
    setLinkedVendorRole("");
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

      clearLinkedVendor();
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
  const selectedSite = sites.find((site) => site.id === selectedSiteId);

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

    if (!linkedVendorId) {
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

      const organizationId = "3b65abde-9f9f-4f1b-bd40-fa261a76920b";

      const { data, error } = await supabase
        .from("ra_bills")
        .insert({
          organization_id: organizationId,
          work_order_id: form.work_order_id,
          vendor_id: linkedVendorId,
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
    <form onSubmit={handleSubmit} className="space-y-8 pb-24">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <nav className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <span>Contract Management</span>
            <span>/</span>
            <span className="text-sky-800">New RA Bill</span>
          </nav>
          <h1 className="text-3xl font-bold text-slate-950">New RA Bill</h1>
          <p className="mt-2 text-sm text-slate-600">
            Site-wise RA bill creation against approved work orders.
          </p>
        </div>

        <Link
          href="/ra-bills"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      </div>

      {message && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {message}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <SectionTitle step="01" title="Select Site & Work Order" />
        <p className="mb-5 text-sm text-slate-500">
          Select a site first. Work orders are filtered to approved active work orders for that site.
        </p>

        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Site *">
            <select
              value={selectedSiteId}
              onChange={handleSiteChange}
              className="h-11 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm outline-none focus:border-sky-700 focus:ring-2 focus:ring-sky-100"
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
              className="h-11 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm outline-none focus:border-sky-700 focus:ring-2 focus:ring-sky-100 disabled:bg-slate-100"
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

        {selectedWO && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Work Order Details
                </p>
                <h3 className="mt-1 text-xl font-bold text-sky-800">
                  {selectedWO.wo_number}
                </h3>
                <p className="mt-2 text-sm text-slate-600">
                  {selectedWO.companies?.company_name || "-"} / {selectedWO.sites?.site_name || selectedSite?.site_name || "-"}
                </p>
              </div>
              <span className="inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold uppercase text-emerald-700">
                Active
              </span>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <MiniInfo title="Company" value={selectedWO.companies?.company_name || "-"} />
              <MiniInfo title="Site" value={selectedWO.sites?.site_name || selectedSite?.site_name || "-"} />
              <MiniInfo title="Vendor" value={linkedVendorName || "-"} />
              <MiniInfo title="Vendor Role" value={linkedVendorRole || "-"} />
              <MiniInfo title="WO Value" value={money(woValue)} />
            </div>
          </div>
        )}
      </section>

      {selectedWO && (
        <>
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
            <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
              Warning: Total billed amount after this RA exceeds the Work Order value by{" "}
              {money(Math.abs(balanceAfterThisRA))}. You can still submit, but please verify before saving.
            </div>
          )}

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <SectionTitle step="02" title="New RA Bill Details" />
            <p className="mb-5 text-sm text-slate-500">
              RA number is auto-suggested from previous bills and remains editable.
            </p>

            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              <Field label="RA Bill Number *">
                <input
                  type="text"
                  name="ra_number"
                  value={form.ra_number}
                  onChange={handleChange}
                  className="h-11 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm outline-none focus:border-sky-700 focus:ring-2 focus:ring-sky-100"
                  placeholder="1, 2, 3, Full & Final"
                />
              </Field>

              <Field label="RA Date">
                <input
                  type="date"
                  name="ra_date"
                  value={form.ra_date}
                  onChange={handleChange}
                  className="h-11 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm outline-none focus:border-sky-700 focus:ring-2 focus:ring-sky-100"
                />
              </Field>

              <Field label="Value of Work Done *">
                <input
                  type="number"
                  name="value_of_work_done"
                  value={form.value_of_work_done}
                  onChange={handleChange}
                  className="h-11 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm outline-none focus:border-sky-700 focus:ring-2 focus:ring-sky-100"
                  placeholder="0"
                />
              </Field>

              <Field label="Security Deduction">
                <input
                  type="number"
                  name="security_amount"
                  value={form.security_amount}
                  onChange={handleChange}
                  className="h-11 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm outline-none focus:border-sky-700 focus:ring-2 focus:ring-sky-100"
                />
              </Field>

              <Field label="Taxable Amount">
                <input
                  value={money(taxableAmount)}
                  readOnly
                  className="h-11 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 text-sm text-slate-600"
                />
              </Field>

              <Field label="GST Rate %">
                <select
                  name="gst_rate"
                  value={form.gst_rate}
                  onChange={handleChange}
                  className="h-11 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm outline-none focus:border-sky-700 focus:ring-2 focus:ring-sky-100"
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
                  className="h-11 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 text-sm text-slate-600"
                />
              </Field>

              <Field label="Amount Payable">
                <input
                  value={money(netPayable)}
                  readOnly
                  className="h-11 w-full rounded-lg border border-sky-200 bg-sky-50 px-3 text-base font-bold text-sky-800"
                />
              </Field>

              <div className="lg:col-span-3">
                <Field label="Remarks">
                  <textarea
                    name="remarks"
                    value={form.remarks}
                    onChange={handleChange}
                    className="min-h-24 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-sky-700 focus:ring-2 focus:ring-sky-100"
                    placeholder="Add work details or supporting context"
                  />
                </Field>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <SectionTitle step="03" title="Attachments" />
            <label className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-10 text-center transition hover:border-sky-600 hover:bg-sky-50">
              <Upload className="mb-3 h-9 w-9 text-slate-400" />
              <span className="text-sm font-semibold text-slate-800">Click to upload files</span>
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
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                {files.map((file) => (
                  <div key={file.name} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                    {file.name}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <SectionTitle step="04" title="Previous RA Bills" icon />
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
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
                      <td colSpan={6} className="p-8 text-center text-slate-500">
                        No previous RA bills found for this Work Order.
                      </td>
                    </tr>
                  ) : (
                    previousRABills.map((bill) => (
                      <tr key={bill.id} className="border-t border-slate-100">
                        <td className="p-3 font-semibold">{bill.ra_number}</td>
                        <td className="p-3">{bill.ra_date || "-"}</td>
                        <td className="p-3 text-right">{money(bill.gross_amount)}</td>
                        <td className="p-3 text-right">{money(bill.gst_amount)}</td>
                        <td className="p-3 text-right font-semibold">{money(bill.net_amount)}</td>
                        <td className="p-3">{bill.approval_status || "Pending"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <div className="sticky bottom-4 z-10 rounded-xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="grid flex-1 gap-4 md:grid-cols-4">
                <Summary title="Value of Work Done" value={money(currentRAValue)} />
                <Summary title="Security Deduction" value={money(form.security_amount)} />
                <Summary title="GST Amount" value={money(gstAmount)} />
                <Summary title="Net Payable" value={money(netPayable)} />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex h-12 items-center justify-center rounded-lg bg-sky-700 px-8 text-sm font-bold text-white shadow-sm hover:bg-sky-800 disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save RA Bill"}
              </button>
            </div>
          </div>
        </>
      )}
    </form>
  );
}

function SectionTitle({
  step,
  title,
  icon = false,
}: {
  step: string;
  title: string;
  icon?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-700 text-xs font-bold text-white">
        {icon ? <FileText className="h-4 w-4" /> : step}
      </div>
      <h2 className="text-xl font-bold text-slate-950">{title}</h2>
    </div>
  );
}

function MiniInfo({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
        {title}
      </p>
      <p className="mt-2 text-sm font-semibold text-slate-950">{value}</p>
    </div>
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
