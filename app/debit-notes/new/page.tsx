"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileMinus, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
}

export default function NewDebitNotePage() {
  const router = useRouter();

  const [sites, setSites] = useState<any[]>([]);
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [raBills, setRaBills] = useState<any[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [selectedWO, setSelectedWO] = useState<any>(null);
  const [linkedVendor, setLinkedVendor] = useState<any>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [form, setForm] = useState({
    work_order_id: "",
    ra_bill_id: "",
    vendor_id: "",
    debit_note_number: "",
    debit_note_date: "",
    debit_note_type: "Recovery",
    reason: "",
    amount: "",
  });

  useEffect(() => {
    loadInitialData();
  }, []);

  async function loadInitialData() {
    const { data: siteData, error: siteError } = await supabase
      .from("sites")
      .select("id, site_name, site_code")
      .eq("status", "active")
      .order("site_name");

    if (siteError) {
      setMessage(siteError.message);
      return;
    }

    const { data: woData, error: woError } = await supabase
      .from("work_orders")
      .select("id, wo_number, wo_value, company_id, site_id")
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
    setRaBills([]);

    setForm((prev) => ({
      ...prev,
      work_order_id: "",
      ra_bill_id: "",
      vendor_id: "",
      debit_note_number: "",
      amount: "",
      reason: "",
    }));
  }

  async function loadWorkOrderDetails(workOrderId: string) {
    setMessage("");
    setSelectedWO(null);
    setLinkedVendor(null);
    setRaBills([]);

    if (!workOrderId) return;

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
          vendor_name
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

   const linkedVendor = Array.isArray(primaryVendor?.vendors)
  ? primaryVendor.vendors[0]
  : primaryVendor?.vendors;

if (!linkedVendor?.id) {
  setMessage("No vendor is linked to this Work Order.");
  return;
}

    setLinkedVendor(primaryVendor);

    const { data: raData, error: raError } = await supabase
      .from("ra_bills")
      .select("id, ra_number, ra_date, gross_amount, net_amount, approval_status")
      .eq("work_order_id", workOrderId)
      .eq("approval_status", "Approved")
      .order("created_at", { ascending: false });

    if (raError) {
      setMessage(raError.message);
      return;
    }

    setRaBills(raData || []);

    const suggestedNumber = `DN-${Date.now().toString().slice(-6)}`;

    setForm((prev) => ({
      ...prev,
      work_order_id: workOrderId,
      vendor_id: linkedVendor.id,
      debit_note_number: suggestedNumber,
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
        ra_bill_id: "",
        vendor_id: "",
        debit_note_number: "",
      }));

      loadWorkOrderDetails(value);
      return;
    }

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

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

    if (!form.debit_note_number.trim()) {
      setMessage("Debit Note Number is required.");
      return;
    }

    if (!form.amount || Number(form.amount) <= 0) {
      setMessage("Debit Note amount is required.");
      return;
    }

    if (!form.reason.trim()) {
      setMessage("Reason is required.");
      return;
    }

    if (files.length === 0) {
      setMessage("At least one Debit Note attachment is required.");
      return;
    }

    try {
      setSaving(true);

      const organizationId = "3b65abde-9f9f-4f1b-bd40-fa261a76920b";
      const amount = Number(form.amount) || 0;

      const { data, error } = await supabase
        .from("debit_notes")
        .insert({
          organization_id: organizationId,
          work_order_id: form.work_order_id,
          ra_bill_id: form.ra_bill_id || null,
          vendor_id: form.vendor_id,
          debit_note_number: form.debit_note_number.trim(),
          debit_note_date: form.debit_note_date || null,
          debit_note_type: form.debit_note_type,
          reason: form.reason.trim(),
          gross_amount: amount,
          gst_amount: 0,
          total_amount: amount,
          status: "Draft",
          approval_status: "Pending",
        })
        .select("id")
        .single();

      if (error) throw error;

      for (const file of files) {
        const safeName = file.name.replace(/[^a-zA-Z0-9.]/g, "_");
        const path = `${organizationId}/debit-notes/${data.id}/${Date.now()}_${safeName}`;

        const { error: uploadError } = await supabase.storage
          .from("debit-note-documents")
          .upload(path, file);

        if (uploadError) throw uploadError;

        const { error: documentError } = await supabase
          .from("debit_note_documents")
          .insert({
            organization_id: organizationId,
            debit_note_id: data.id,
            file_name: file.name,
            file_url: path,
          });

        if (documentError) throw documentError;
      }

      router.push(`/debit-notes/${data.id}`);
    } catch (err: any) {
      setMessage(err.message || "Failed to create Debit Note.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
            <FileMinus className="h-3.5 w-3.5" />
            Contract Management
          </div>
          <h1 className="text-3xl font-bold text-slate-950">
            New Debit Note
          </h1>
          <p className="text-sm text-slate-500">
            Create debit note against a work order or approved RA bill.
          </p>
        </div>

        <Link
          href="/debit-notes"
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

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Site *">
            <select
              value={selectedSiteId}
              onChange={handleSiteChange}
              className="h-11 w-full rounded-xl border px-3 text-sm"
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
            <Summary title="WO Number" value={selectedWO.wo_number || "-"} />
            <Summary title="WO Value" value={money(selectedWO.wo_value)} />
            <Summary
              title="Vendor"
              value={linkedVendor?.vendors?.vendor_name || "-"}
            />
            <Summary title="Approved RA Bills" value={String(raBills.length)} />
          </section>

          <section className="rounded-2xl border bg-white p-6 shadow-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Step 2
            </p>
            <h2 className="text-xl font-semibold text-slate-950">
              Debit Note Details
            </h2>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Debit Note Number *">
                <input
                  name="debit_note_number"
                  value={form.debit_note_number}
                  onChange={handleChange}
                  className="h-11 w-full rounded-xl border px-3 text-sm"
                />
              </Field>

              <Field label="Debit Note Date">
                <input
                  type="date"
                  name="debit_note_date"
                  value={form.debit_note_date}
                  onChange={handleChange}
                  className="h-11 w-full rounded-xl border px-3 text-sm"
                />
              </Field>

              <Field label="Link Approved RA Bill optional">
                <select
                  name="ra_bill_id"
                  value={form.ra_bill_id}
                  onChange={handleChange}
                  className="h-11 w-full rounded-xl border px-3 text-sm"
                >
                  <option value="">Not linked to RA Bill</option>
                  {raBills.map((bill) => (
                    <option key={bill.id} value={bill.id}>
                      RA {bill.ra_number} - {money(bill.net_amount)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Debit Note Type">
                <select
                  name="debit_note_type"
                  value={form.debit_note_type}
                  onChange={handleChange}
                  className="h-11 w-full rounded-xl border px-3 text-sm"
                >
                  <option>Recovery</option>
                  <option>Penalty</option>
                  <option>Material Recovery</option>
                  <option>Damage Recovery</option>
                  <option>Excess Payment Recovery</option>
                  <option>Other</option>
                </select>
              </Field>

              <Field label="Debit Note Amount *">
                <input
                  type="number"
                  name="amount"
                  value={form.amount}
                  onChange={handleChange}
                  className="h-11 w-full rounded-xl border px-3 text-sm"
                />
              </Field>

              <Field label="Amount Payable / Recoverable">
                <input
                  value={money(form.amount)}
                  readOnly
                  className="h-11 w-full rounded-xl border bg-red-50 px-3 text-sm font-semibold text-red-700"
                />
              </Field>

              <div className="md:col-span-2">
                <Field label="Reason *">
                  <textarea
                    name="reason"
                    value={form.reason}
                    onChange={handleChange}
                    className="min-h-24 w-full rounded-xl border px-3 py-2 text-sm"
                    placeholder="Explain why this debit note is being raised."
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
                Supporting files are required.
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

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-slate-950 px-6 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Debit Note"}
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