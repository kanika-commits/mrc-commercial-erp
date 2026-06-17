"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { can, getCurrentUserAccess } from "@/lib/accessControl";
import { sortCompanies } from "@/lib/companyOrdering";

type Company = {
  id: string;
  organization_id: string;
  company_name: string;
  company_code: string;
  status: string;
  created_at: string;
  organization_name?: string;
  organization_code?: string;
};

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [canEditCompanies, setCanEditCompanies] = useState(false);
  const [canDeleteCompanies, setCanDeleteCompanies] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadCompanies();
  }, []);

  async function loadCompanies() {
    setLoading(true);
    setMessage("");

    const access = await getCurrentUserAccess();

    setCanEditCompanies(
      access.roleCodes.includes("platform_owner") ||
        access.roleCodes.includes("super_admin") ||
        can(access.permissions, "companies", "edit")
    );
    setCanDeleteCompanies(
      access.roleCodes.includes("platform_owner") ||
        access.roleCodes.includes("super_admin") ||
        can(access.permissions, "companies", "delete")
    );

    const { data, error } = await supabase
      .from("companies")
      .select("id, organization_id, company_name, company_code, status, created_at")
      .neq("status", "deleted")
      .order("created_at", { ascending: false });

    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    const organizationIds = Array.from(
      new Set((data || []).map((company) => company.organization_id).filter(Boolean))
    );

    const { data: orgData, error: orgError } = organizationIds.length
      ? await supabase
          .from("organizations")
          .select("id, name, code")
          .in("id", organizationIds)
      : { data: [], error: null };

    if (orgError) {
      setMessage(orgError.message);
      setLoading(false);
      return;
    }

    const organizationById = new Map(
      (orgData || []).map((organization) => [organization.id, organization])
    );

    setCompanies(
      sortCompanies((data || []).map((company) => {
        const organization = organizationById.get(company.organization_id);

        return {
          ...company,
          organization_name: organization?.name || "",
          organization_code: organization?.code || "",
        };
      }))
    );
    setLoading(false);
  }

  async function deleteCompany(company: Company) {
    const ok = window.confirm(
      `Delete company "${company.company_name}"? This is blocked automatically if linked records exist.`
    );

    if (!ok) return;

    try {
      setMessage("");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const response = await fetch(`/api/companies/${company.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to delete company.");
      }

      setCompanies((prev) => prev.filter((item) => item.id !== company.id));
      setMessage("Company deleted successfully.");
    } catch (error: any) {
      setMessage(error.message || "Failed to delete company.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Companies</h1>
          <p className="text-gray-500">Manage MRC group companies.</p>
        </div>

        <Link href="/companies/new" className="rounded-lg bg-blue-600 px-4 py-2 text-white">
          Add Company
        </Link>
      </div>

      {message && (
        <div className="rounded-lg border bg-yellow-50 p-3 text-sm text-yellow-800">
          {message}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-3 text-left">Company Name</th>
              <th className="p-3 text-left">Company Code</th>
              <th className="p-3 text-left">Organization</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Created At</th>
              <th className="p-3 text-left">Action</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td className="p-3" colSpan={6}>
                  Loading...
                </td>
              </tr>
            ) : companies.length === 0 ? (
              <tr>
                <td className="p-3" colSpan={6}>
                  No companies found.
                </td>
              </tr>
            ) : (
              companies.map((company) => (
                <tr key={company.id} className="border-t">
                  <td className="p-3 font-medium">{company.company_name}</td>
                  <td className="p-3">{company.company_code}</td>
                  <td className="p-3">
                    {company.organization_name
                      ? `${company.organization_name} - ${
                          company.organization_code || "-"
                        }`
                      : "-"}
                  </td>
                  <td className="p-3">{company.status}</td>
                  <td className="p-3">
                    {new Date(company.created_at).toLocaleDateString("en-IN")}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/companies/${company.id}`}
                        className="rounded border px-3 py-1"
                      >
                        View
                      </Link>
                      {canEditCompanies && (
                      <Link
                        href={`/companies/${company.id}/edit`}
                        className="rounded border px-3 py-1"
                      >
                        Edit
                      </Link>
                      )}
                      {canDeleteCompanies && (
                        <button
                          type="button"
                          onClick={() => deleteCompany(company)}
                          className="rounded border border-red-200 px-3 py-1 text-red-700 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
