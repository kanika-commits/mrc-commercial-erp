"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { sortCompanies } from "@/lib/companyOrdering";

export default function EditOrganizationPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [form, setForm] = useState({
    name: "",
    code: "",
    status: "active",
  });

  const [companies, setCompanies] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [id]);

  async function loadData() {
    setLoading(true);
    setMessage("");

    const { data: org, error } = await supabase
      .from("organizations")
      .select("id, name, code, status")
      .eq("id", id)
      .single();

    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    setForm({
      name: org.name || "",
      code: org.code || "",
      status: org.status || "active",
    });

    const { data: companyData } = await supabase
      .from("companies")
      .select("id, company_name, company_code, status")
      .eq("organization_id", id)
      .order("company_name");

    setCompanies(sortCompanies(companyData || []));
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

  async function saveOrganization() {
    try {
      setSaving(true);
      setMessage("");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const response = await fetch(`/api/admin/organizations/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          name: form.name,
          code: form.code,
          status: form.status,
        }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to update organization.");
      }

      setMessage("Organization updated successfully.");
      router.refresh();
    } catch (error: any) {
      setMessage(error.message || "Failed to update organization.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleCompanyStatus(companyId: string, status: string) {
    const company = companies.find((item) => item.id === companyId);

    if (!company) {
      setMessage("Company was not found.");
      return;
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const response = await fetch(`/api/companies/${companyId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          company_name: company.company_name,
          company_code: company.company_code,
          status,
        }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to update company status.");
      }

      await loadData();
      setMessage("Company status updated.");
    } catch (error: any) {
      setMessage(error.message || "Failed to update company status.");
    }
  }

  if (loading) {
    return <p className="text-gray-500">Loading organization...</p>;
  }

  const inputClass = "w-full rounded-lg border px-3 py-2";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Edit Organization</h1>
          <p className="text-gray-500">
            Manage organization details and companies.
          </p>
        </div>

        <Link href={`/organizations/${id}`} className="rounded-lg border px-4 py-2">
          Back
        </Link>
      </div>

      {message && (
        <div className="rounded-lg border bg-yellow-50 p-3 text-sm text-yellow-800">
          {message}
        </div>
      )}

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Organization Details</h2>

        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Name</label>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              className={inputClass}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Code</label>
            <input
              name="code"
              value={form.code}
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
            onClick={saveOrganization}
            className="rounded-lg bg-blue-600 px-5 py-2 text-white disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Organization"}
          </button>
        </div>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Companies</h2>

          <Link
            href={`/companies/new?organization_id=${id}`}
            className="rounded-lg bg-blue-600 px-4 py-2 text-white"
          >
            + Add Company
          </Link>
        </div>

        <div className="overflow-hidden rounded border">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-3 text-left">Company</th>
                <th className="p-3 text-left">Code</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-left">Action</th>
              </tr>
            </thead>

            <tbody>
              {companies.map((company) => (
                <tr key={company.id} className="border-t">
                  <td className="p-3">{company.company_name}</td>
                  <td className="p-3">{company.company_code || "-"}</td>
                  <td className="p-3">{company.status || "active"}</td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <Link
                        href={`/companies/${company.id}`}
                        className="rounded border px-3 py-1"
                      >
                        View
                      </Link>

                      {company.status === "inactive" ? (
                        <button
                          type="button"
                          onClick={() => toggleCompanyStatus(company.id, "active")}
                          className="rounded bg-blue-600 px-3 py-1 text-white"
                        >
                          Activate
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggleCompanyStatus(company.id, "inactive")}
                          className="rounded bg-red-600 px-3 py-1 text-white"
                        >
                          Deactivate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {companies.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-gray-500">
                    No companies found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
