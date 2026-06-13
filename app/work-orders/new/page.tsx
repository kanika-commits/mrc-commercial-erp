"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Vendor = {
  id: string;
  vendor_name: string;
  pan: string | null;
};

type Company = {
  id: string;
  company_name: string;
  company_code: string;
};

type Site = {
  id: string;
  company_id: string;
  site_name: string;
  site_code: string;
};

export default function NewWorkOrderPage() {
  const router = useRouter();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [filteredSites, setFilteredSites] = useState<Site[]>([]);
  const [workOrderFile, setWorkOrderFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [form, setForm] = useState({
    company_id: "",
    site_id: "",
    wo_date: "",
    wo_type: "Civil",
    description: "",
    wo_value: "",
    gst_percent: "18",
    status: "active",
    approval_status: "draft",
    primary_vendor_id: "",
    primary_vendor_role: "Main Contractor",
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const { data: vendorData, error: vendorError } = await supabase
      .from("vendors")
      .select("id, vendor_name, pan")
      .eq("status", "active")
      .order("vendor_name");

    if (vendorError) {
      setMessage(vendorError.message);
      return;
    }

    const { data: companyData, error: companyError } = await supabase
      .from("companies")
      .select("id, company_name, company_code")
      .eq("status", "active")
      .order("company_name");

    if (companyError) {
      setMessage(companyError.message);
      return;
    }

    const { data: siteData, error: siteError } = await supabase
      .from("sites")
      .select("id, company_id, site_name, site_code")
      .eq("status", "active")
      .order("site_name");

    if (siteError) {
      setMessage(siteError.message);
      return;
    }

    setVendors(vendorData || []);
    setCompanies(companyData || []);
    setSites(siteData || []);
  }

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) {
    const { name, value } = e.target;

    if (name === "company_id") {
      setFilteredSites(sites.filter((site) => site.company_id === value));
      setForm((prev) => ({
        ...prev,
        company_id: value,
        site_id: "",
      }));
      return;
    }

    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function safeFileName(name: string) {
    return name.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  async function generateWorkOrderNumber() {
    const company = companies.find((item) => item.id === form.company_id);
    const site = sites.find((item) => item.id === form.site_id);

    if (!company?.company_code) {
      throw new Error("Selected company does not have company code.");
    }

    if (!site?.site_code) {
      throw new Error("Selected site does not have site code.");
    }

    const prefix = `${site.site_code}/${company.company_code}/`;

    const { data, error } = await supabase
      .from("work_orders")
      .select("wo_number")
      .like("wo_number", `${prefix}%`);

    if (error) throw error;

    let nextNumber = 101;

    if (data && data.length > 0) {
      const numbers = data
        .map((row) => {
          const parts = String(row.wo_number || "").split("/");
          return Number(parts[parts.length - 1]);
        })
        .filter((value) => Number.isFinite(value) && value > 0);

      if (numbers.length > 0) {
        nextNumber = Math.max(...numbers) + 1;
      }
    }

    return `${prefix}${nextNumber}`;
  }

  async function uploadWorkOrderFile(
    organizationId: string,
    workOrderId: string,
    file: File
  ) {
    const cleanName = safeFileName(file.name);
    const filePath = `work-orders/${workOrderId}/${Date.now()}-${cleanName}`;

    const { error: uploadError } = await supabase.storage
      .from("work-order-documents")
      .upload(filePath, file, { upsert: false });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage
      .from("work_order_documents")
      .getPublicUrl(filePath);

    const { error: documentError } = await supabase
      .from("work_order_documents")
      .insert({
        organization_id: organizationId,
        work_order_id: workOrderId,
        file_name: file.name,
        file_url: publicUrlData.publicUrl,
        file_path: filePath,
      });

    if (documentError) throw documentError;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    if (!form.company_id) {
      setMessage("Company is required.");
      return;
    }

    if (!form.site_id) {
      setMessage("Site is required.");
      return;
    }

    if (!form.primary_vendor_id) {
      setMessage("Primary vendor is required.");
      return;
    }

    if (!workOrderFile) {
      setMessage("Work Order file is required.");
      return;
    }

    try {
      setSaving(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const userEmail = user?.email || "platform.owner@mrc.local";
const userName =
  user?.user_metadata?.full_name ||
  user?.user_metadata?.name ||
  userEmail ||
  "Platform Owner";

      const organizationId = "3b65abde-9f9f-4f1b-bd40-fa261a76920b";
      const generatedWONumber = await generateWorkOrderNumber();

      const { data: duplicate, error: duplicateError } = await supabase
        .from("work_orders")
        .select("id, wo_number")
        .eq("organization_id", organizationId)
        .eq("wo_number", generatedWONumber)
        .maybeSingle();

      if (duplicateError) throw duplicateError;

      if (duplicate) {
        setMessage("Generated Work Order number already exists. Please save again.");
        return;
      }

      const { data: workOrder, error: woError } = await supabase
        .from("work_orders")
        .insert({
          organization_id: organizationId,
          company_id: form.company_id,
          site_id: form.site_id,
          wo_number: generatedWONumber,
          wo_date: form.wo_date || null,
          wo_type: form.wo_type,
          description: form.description.trim() || null,
          status: form.status,
          approval_status: form.approval_status,
          wo_value: form.wo_value ? Number(form.wo_value) : null,
          gst_percent: Number(form.gst_percent || 0),
          created_by_name: userName,
          created_by_email: userEmail,
          created_at_user: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (woError) throw woError;

      await uploadWorkOrderFile(organizationId, workOrder.id, workOrderFile);

      const { error: vendorLinkError } = await supabase
        .from("work_order_vendors")
        .insert({
          organization_id: organizationId,
          work_order_id: workOrder.id,
          vendor_id: form.primary_vendor_id,
          vendor_role: form.primary_vendor_role,
          is_primary: true,
        });

      if (vendorLinkError) throw vendorLinkError;

      router.push(`/work-orders/${workOrder.id}`);
    } catch (error: any) {
      setMessage(error.message || "Failed to create work order.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "w-full rounded-lg border px-3 py-2";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Add Work Order</h1>
          <p className="text-gray-500">Create work order under company and site.</p>
        </div>

        <Link href="/work-orders" className="rounded-lg border px-4 py-2">
          Back
        </Link>
      </div>

      {message && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {message}
        </div>
      )}

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Company and Site</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">Company *</label>
            <select
              name="company_id"
              value={form.company_id}
              onChange={handleChange}
              className={inputClass}
            >
              <option value="">Select Company</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.company_name} - {company.company_code}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Site *</label>
            <select
              name="site_id"
              value={form.site_id}
              onChange={handleChange}
              className={inputClass}
              disabled={!form.company_id}
            >
              <option value="">Select Site</option>
              {filteredSites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.site_name} - {site.site_code}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Work Order Information</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="WO Date"
            name="wo_date"
            value={form.wo_date}
            onChange={handleChange}
            type="date"
          />

          <div>
            <label className="mb-1 block text-sm font-medium">WO Type</label>
            <select
              name="wo_type"
              value={form.wo_type}
              onChange={handleChange}
              className={inputClass}
            >
              <option>Civil</option>
              <option>Interior</option>
              <option>Electrical</option>
              <option>Plumbing</option>
              <option>HVAC</option>
              <option>Supply</option>
              <option>Service</option>
              <option>Other</option>
            </select>
          </div>

          <Field
            label="WO Value"
            name="wo_value"
            value={form.wo_value}
            onChange={handleChange}
            type="number"
          />

          <div>
            <label className="mb-1 block text-sm font-medium">GST %</label>
            <select
              name="gst_percent"
              value={form.gst_percent}
              onChange={handleChange}
              className={inputClass}
            >
              <option value="0">0%</option>
              <option value="5">5%</option>
              <option value="12">12%</option>
              <option value="18">18%</option>
              <option value="28">28%</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Work Order File *</label>
            <input
              type="file"
              onChange={(e) => setWorkOrderFile(e.target.files?.[0] || null)}
              className={inputClass}
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium">Description</label>
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              className="min-h-24 w-full rounded-lg border px-3 py-2"
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Primary Vendor</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">Vendor *</label>
            <select
              name="primary_vendor_id"
              value={form.primary_vendor_id}
              onChange={handleChange}
              className={inputClass}
            >
              <option value="">Select Vendor</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.vendor_name} {vendor.pan ? `(${vendor.pan})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Role in Work Order</label>
            <select
              name="primary_vendor_role"
              value={form.primary_vendor_role}
              onChange={handleChange}
              className={inputClass}
            >
              <option>Main Contractor</option>
              <option>Subcontractor</option>
              <option>Supplier</option>
              <option>Consultant</option>
              <option>Labour Contractor</option>
              <option>Equipment Rental</option>
            </select>
          </div>
        </div>
      </section>

      <div className="flex justify-end gap-3">
        <Link href="/work-orders" className="rounded-lg border px-4 py-2">
          Cancel
        </Link>

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Work Order"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  name: string;
  value: string;
  onChange: (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      <input
        name={name}
        value={value}
        onChange={onChange}
        type={type}
        className="w-full rounded-lg border px-3 py-2"
      />
    </div>
  );
}