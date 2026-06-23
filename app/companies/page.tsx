"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import { sortCompanies } from "@/lib/companyOrdering";
import { formatStatusLabel } from "@/lib/statusLabels";
import DeleteCompanyButton from "@/components/DeleteCompanyButton";

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
  const { access } = useAccessContext();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const permissions = access?.permissions || [];
  const roleCodes = access?.roleCodes || [];
  const canEditCompanies =
    roleCodes.includes("platform_owner") ||
    can(permissions, "companies", "edit");
  const canAddCompanies =
    roleCodes.includes("platform_owner") ||
    can(permissions, "companies", "add");
  const canDeleteCompanies =
    roleCodes.includes("platform_owner") ||
    can(permissions, "companies", "delete");

  useEffect(() => {
    loadCompanies();
  }, []);

  async function loadCompanies() {
    setLoading(true);
    setMessage("");

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

  function handleCompanyDeleted(company: Company) {
    setCompanies((prev) => prev.filter((item) => item.id !== company.id));
    setMessage("Company deleted successfully.");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Companies</h1>
          <p className="text-gray-500">Manage MRC group companies.</p>
        </div>

        {canAddCompanies && (
          <Link href="/companies/new" className="rounded-lg bg-blue-600 px-4 py-2 text-white">
            Add Company
          </Link>
        )}
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
                  <td className="p-3">{formatStatusLabel(company.status)}</td>
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
                        <DeleteCompanyButton
                          companyId={company.id}
                          companyName={company.company_name}
                          onDeleted={() => handleCompanyDeleted(company)}
                        />
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
