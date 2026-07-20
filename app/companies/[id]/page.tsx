"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import { formatStatusLabel } from "@/lib/statusLabels";
import DeleteCompanyButton from "@/components/DeleteCompanyButton";
import { isOrganizationAllowed } from "@/lib/clientOrganizationScope";

export default function CompanyDetailPage() {
  const { access, loading: accessLoading } = useAccessContext();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [company, setCompany] = useState<any>(null);
  const [organization, setOrganization] = useState<any>(null);
  const [sites, setSites] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const roleCodes = access?.roleCodes || [];
  const permissions = access?.permissions || [];
  const canEditCompany =
    roleCodes.includes("platform_owner") ||
    can(permissions, "companies", "edit");
  const canDeleteCompany =
    roleCodes.includes("platform_owner") ||
    can(permissions, "companies", "delete");

  useEffect(() => {
    if (!accessLoading && access) {
      loadCompany();
    }
  }, [access, accessLoading, id]);

  async function loadCompany() {
    try {
      setLoading(true);
      setMessage("");

      const { data: companyData, error: companyError } = await supabase
        .from("companies")
        .select("id, organization_id, company_name, company_code, status, created_at")
        .eq("id", id)
        .single();

      if (companyError) throw companyError;

      if (!isOrganizationAllowed(access, companyData.organization_id)) {
        throw new Error("Company not found.");
      }

      setCompany(companyData);

      const { data: organizationData } = await supabase
        .from("organizations")
        .select("id, name, code")
        .eq("id", companyData.organization_id)
        .maybeSingle();

      setOrganization(organizationData);

      const { data: siteData, error: siteError } = await supabase
        .from("sites")
        .select("id, site_name, site_code, status")
        .eq("company_id", id)
        .order("site_name");

      if (siteError) throw siteError;

      setSites(siteData || []);

      const { data: userAccess, error: userAccessError } = await supabase
        .from("user_access_assignments")
        .select("user_id")
        .eq("company_id", id);

      if (userAccessError) throw userAccessError;

      const userIds = Array.from(
        new Set((userAccess || []).map((item: any) => item.user_id).filter(Boolean))
      );

      if (userIds.length) {
        const { data: userData, error: userError } = await supabase
          .from("profiles")
          .select("id, email, full_name, status")
          .in("id", userIds);

        if (userError) throw userError;
        setUsers(userData || []);
      } else {
        setUsers([]);
      }
    } catch (error: any) {
      setMessage(error.message || "Company not found.");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <p className="text-gray-500">Loading company...</p>;
  }

  if (message && !company) {
    return (
      <div className="rounded-lg border bg-red-50 p-4 text-red-700">
        {message}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{company.company_name}</h1>
          <p className="text-gray-500">
            Company code: {company.company_code || "-"}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href="/companies" className="rounded-lg border px-4 py-2">
            Back
          </Link>

          {canEditCompany && (
            <Link
              href={`/companies/${company.id}/edit`}
              className="rounded-lg bg-blue-600 px-4 py-2 text-white"
            >
              Edit Company
            </Link>
          )}
          {canDeleteCompany && (
            <DeleteCompanyButton
              companyId={company.id}
              companyName={company.company_name}
              redirectTo="/companies"
              className="rounded-lg border border-red-200 px-4 py-2 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            />
          )}
        </div>
      </div>

      {message && (
        <div className="rounded-lg border bg-yellow-50 p-3 text-sm text-yellow-800">
          {message}
        </div>
      )}

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Company Information</h2>

        <div className="grid gap-4 md:grid-cols-4">
          <Info label="Company" value={company.company_name || "-"} />
          <Info label="Code" value={company.company_code || "-"} />
          <Info label="Status" value={formatStatusLabel(company.status || "active")} />
          <Info
            label="Organization"
            value={
              organization ? `${organization.name} - ${organization.code}` : "-"
            }
          />
        </div>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Sites</h2>

          <Link
            href={`/sites/new?company_id=${company.id}`}
            className="rounded-lg bg-blue-600 px-4 py-2 text-white"
          >
            + Add Site
          </Link>
        </div>

        <div className="overflow-hidden rounded border">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-3 text-left">Site</th>
                <th className="p-3 text-left">Code</th>
                <th className="p-3 text-left">Status</th>
              </tr>
            </thead>

            <tbody>
              {sites.map((site: any) => (
                <tr key={site.id} className="border-t">
                  <td className="p-3">{site.site_name}</td>
                  <td className="p-3">{site.site_code || "-"}</td>
                  <td className="p-3">{formatStatusLabel(site.status || "active")}</td>
                </tr>
              ))}

              {sites.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-6 text-center text-gray-500">
                    No sites found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Users With Access</h2>

        <div className="overflow-hidden rounded border">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-3 text-left">Name</th>
                <th className="p-3 text-left">Email</th>
                <th className="p-3 text-left">Status</th>
              </tr>
            </thead>

            <tbody>
              {users.map((user: any) => (
                <tr key={user.id} className="border-t">
                  <td className="p-3">{user.full_name || "-"}</td>
                  <td className="p-3">{user.email || "-"}</td>
                  <td className="p-3">{formatStatusLabel(user.status || "active")}</td>
                </tr>
              ))}

              {users.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-6 text-center text-gray-500">
                    No users assigned to this company.
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

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-gray-500">{label}</p>
      <p className="mt-1 font-medium text-gray-900">{value}</p>
    </div>
  );
}
