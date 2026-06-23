"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";

export default function EditCompanyPage() {
  const { access, loading: accessLoading } = useAccessContext();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [form, setForm] = useState({
    company_name: "",
    company_code: "",
    organization_id: "",
    status: "active",
  });

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);

  useEffect(() => {
    if (!accessLoading && access) {
      loadData();
    }
  }, [access, accessLoading, id]);

  async function loadData() {
    setLoading(true);
    setMessage("");
    setAccessDenied(false);

    const currentAccess = access;
    if (!currentAccess) return;

    const canEditCompany =
      currentAccess.roleCodes.includes("platform_owner") ||
      currentAccess.roleCodes.includes("super_admin") ||
      can(currentAccess.permissions, "companies", "edit");

    if (!canEditCompany) {
      setAccessDenied(true);
      setMessage("You do not have permission to edit companies.");
      setLoading(false);
      return;
    }

    const { data: company, error } = await supabase
      .from("companies")
      .select("id, company_name, company_code, organization_id, status")
      .eq("id", id)
      .limit(1)
      .maybeSingle();

    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    if (!company) {
      setMessage("Company was not found.");
      setLoading(false);
      return;
    }

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

      if (!form.company_name || !form.company_code) {
        setMessage("Company name and code are required.");
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const response = await fetch(`/api/companies/${id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          company_name: form.company_name,
          company_code: form.company_code,
          status: form.status,
        }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to update company.");
      }

      setMessage("Company updated successfully.");
      router.push("/companies");
    } catch (error: any) {
      setMessage(error.message || "Failed to update company.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-gray-500">Loading company...</p>;
  }

  if (accessDenied) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-700">
        <h1 className="text-lg font-semibold">Access Denied</h1>
        <p className="mt-1 text-sm">You do not have permission to edit companies.</p>
        <Link
          href={`/companies/${id}`}
          className="mt-4 inline-flex rounded border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
        >
          Back to Company
        </Link>
      </div>
    );
  }

  const inputClass = "w-full rounded-lg border px-3 py-2";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Edit Company</h1>
          <p className="text-gray-500">
            Update company name, code and status.
          </p>
        </div>

        <Link href="/companies" className="rounded-lg border px-4 py-2">
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
