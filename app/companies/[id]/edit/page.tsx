"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function EditCompanyPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [organizations, setOrganizations] = useState<any[]>([]);
  const [form, setForm] = useState({
    company_name: "",
    company_code: "",
    organization_id: "",
    status: "active",
  });

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, [id]);

  async function loadData() {
    setLoading(true);
    setMessage("");

    const { data: company, error } = await supabase
      .from("companies")
      .select("id, company_name, company_code, organization_id, status")
      .eq("id", id)
      .single();

    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    const { data: orgData, error: orgError } = await supabase
      .from("organizations")
      .select("id, name, code")
      .eq("status", "active")
      .order("name");

    if (orgError) {
      setMessage(orgError.message);
      setLoading(false);
      return;
    }

    setOrganizations(orgData || []);
    setForm({
      company_name: company.company_name || "",
      company_code: company.company_code || "",
      organization_id: company.organization_id || "",
      status: company.status || "active",
    });

    setLoading(false);
  }

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    setForm((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  }

  async function saveCompany() {
    try {
      setSaving(true);
      setMessage("");

      if (!form.company_name || !form.company_code || !form.organization_id) {
        setMessage("Company name, code and organization are required.");
        return;
      }

      const { error } = await supabase
        .from("companies")
        .update({
          company_name: form.company_name,
          company_code: form.company_code,
          organization_id: form.organization_id,
          status: form.status,
        })
        .eq("id", id);

      if (error) throw error;

      setMessage("Company updated successfully.");
      router.refresh();
    } catch (error: any) {
      setMessage(error.message || "Failed to update company.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-gray-500">Loading company...</p>;
  }

  const inputClass = "w-full rounded-lg border px-3 py-2";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Edit Company</h1>
          <p className="text-gray-500">
            Update company details and organization mapping.
          </p>
        </div>

        <Link href={`/companies/${id}`} className="rounded-lg border px-4 py-2">
          Back
        </Link>
      </div>

      {message && (
        <div className="rounded-lg border bg-yellow-50 p-3 text-sm text-yellow-800">
          {message}
        </div>
      )}

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Company Details</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">
              Company Name *
            </label>
            <input
              name="company_name"
              value={form.company_name}
              onChange={handleChange}
              className={inputClass}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Company Code *
            </label>
            <input
              name="company_code"
              value={form.company_code}
              onChange={handleChange}
              className={inputClass}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Organization *
            </label>
            <select
              name="organization_id"
              value={form.organization_id}
              onChange={handleChange}
              className={inputClass}
            >
              <option value="">Select Organization</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name} - {org.code}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Status</label>
            <select
              name="status"
              value={form.status}
              onChange={handleChange}
              className={inputClass}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            disabled={saving}
            onClick={saveCompany}
            className="rounded-lg bg-blue-600 px-5 py-2 text-white disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Company"}
          </button>
        </div>
      </section>
    </div>
  );
}