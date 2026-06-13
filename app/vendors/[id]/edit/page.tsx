"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type VendorForm = {
  vendor_name: string;
  vendor_type: string;
  contractor_type: string;
  status: string;
  pan_aadhaar_link_status: string;
  msme_registered: string;
  msme_number: string;
  msme_category: string;
};

export default function EditVendorPage() {
  const params = useParams();
  const router = useRouter();
  const vendorId = params.id as string;

  const [form, setForm] = useState<VendorForm>({
    vendor_name: "",
    vendor_type: "Contractor",
    contractor_type: "Company",
    status: "active",
    pan_aadhaar_link_status: "Yet to check",
    msme_registered: "No",
    msme_number: "",
    msme_category: "Micro",
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadVendor() {
      try {
        const { data, error } = await supabase
          .from("vendors")
          .select(`
            vendor_name,
            vendor_type,
            contractor_type,
            status,
            pan_aadhaar_link_status,
            msme_registered,
            msme_number,
            msme_category
          `)
          .eq("id", vendorId)
          .single();

        if (error) throw error;

        setForm({
          vendor_name: data.vendor_name || "",
          vendor_type: data.vendor_type || "Contractor",
          contractor_type: data.contractor_type || "Company",
          status: data.status || "active",
          pan_aadhaar_link_status:
            data.pan_aadhaar_link_status || "Yet to check",
          msme_registered: data.msme_registered ? "Yes" : "No",
          msme_number: data.msme_number || "",
          msme_category: data.msme_category || "Micro",
        });
      } catch (error: any) {
        setMessage(error.message || "Failed to load vendor.");
      } finally {
        setLoading(false);
      }
    }

    if (vendorId) loadVendor();
  }, [vendorId]);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    const { name, value } = e.target;

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    if (!form.vendor_name.trim()) {
      setMessage("Vendor Name is required.");
      return;
    }

    try {
      setSaving(true);

      const { error } = await supabase
        .from("vendors")
        .update({
  vendor_type: form.vendor_type,
  contractor_type: form.contractor_type,
  status: form.status,
  pan_aadhaar_link_status: form.pan_aadhaar_link_status,
  msme_registered: form.msme_registered === "Yes",
  msme_number:
    form.msme_registered === "Yes" ? form.msme_number.trim() : null,
  msme_category:
    form.msme_registered === "Yes" ? form.msme_category : null,
})
        .eq("id", vendorId);

      if (error) throw error;

      router.push(`/vendors/${vendorId}`);
    } catch (error: any) {
      setMessage(error.message || "Failed to update vendor.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-gray-500">Loading vendor...</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Edit Vendor</h1>
          <p className="mt-2 text-gray-500">
            Update vendor profile information.
          </p>
        </div>

        <Link href={`/vendors/${vendorId}`} className="rounded-lg border px-4 py-2">
          Back to Vendor
        </Link>
      </div>

      {message && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {message}
        </div>
      )}

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Basic Information</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">
              Vendor Name *
            </label>
            <input
  name="vendor_name"
  value={form.vendor_name}
  readOnly
  className="w-full rounded-lg border bg-gray-100 px-3 py-2 text-gray-600"
/>
<p className="mt-1 text-xs text-gray-500">
  Vendor name can only be changed by Super Admin.
</p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Vendor Type *
            </label>
            <select
              name="vendor_type"
              value={form.vendor_type}
              onChange={handleChange}
              className="w-full rounded-lg border px-3 py-2"
            >
              <option>Contractor</option>
              <option>Supplier</option>
              <option>Consultant</option>
              <option>Labour Contractor</option>
              <option>Equipment Rental</option>
              <option>Transporter</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Contractor Type *
            </label>
            <select
              name="contractor_type"
              value={form.contractor_type}
              onChange={handleChange}
              className="w-full rounded-lg border px-3 py-2"
            >
              <option>Company</option>
              <option>LLP</option>
              <option>Partnership</option>
              <option>Proprietor</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Status *</label>
            <select
              name="status"
              value={form.status}
              onChange={handleChange}
              className="w-full rounded-lg border px-3 py-2"
            >
              <option value="active">active</option>
              <option value="inactive">inactive</option>
              <option value="blocked">blocked</option>
            </select>
          </div>
        </div>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Compliance Status</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">
              PAN Linked with Aadhaar
            </label>
            <select
              name="pan_aadhaar_link_status"
              value={form.pan_aadhaar_link_status}
              onChange={handleChange}
              className="w-full rounded-lg border px-3 py-2"
            >
              <option>Yet to check</option>
              <option>Yes</option>
              <option>No</option>
            </select>
          </div>
        </div>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">MSME</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">
              MSME Registered?
            </label>
            <select
              name="msme_registered"
              value={form.msme_registered}
              onChange={handleChange}
              className="w-full rounded-lg border px-3 py-2"
            >
              <option>No</option>
              <option>Yes</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">MSME Number</label>
            <input
              name="msme_number"
              value={form.msme_number}
              onChange={handleChange}
              className="w-full rounded-lg border px-3 py-2"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              MSME Category
            </label>
            <select
              name="msme_category"
              value={form.msme_category}
              onChange={handleChange}
              className="w-full rounded-lg border px-3 py-2"
            >
              <option>Micro</option>
              <option>Small</option>
              <option>Medium</option>
            </select>
          </div>
        </div>
      </section>

      <div className="flex justify-end gap-3">
        <Link href={`/vendors/${vendorId}`} className="rounded-lg border px-4 py-2">
          Cancel
        </Link>

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  );
}