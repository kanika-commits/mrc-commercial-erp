"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import RequirePermission from "@/components/RequirePermission";
import DeleteOrganizationButton from "@/components/DeleteOrganizationButton";
import DeleteCompanyButton from "@/components/DeleteCompanyButton";
import { apiFetch } from "@/components/hr/hrClient";
import { sortCompanies } from "@/lib/companyOrdering";

export default function OrganizationDetailClient({ organizationId }: { organizationId: string }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => { void apiFetch(`/api/organizations/${organizationId}/detail`).then(setData).catch((reason: any) => setError(reason?.message || "Could not load the organization.")); }, [organizationId]);
  if (error) return <div className="rounded-lg border bg-red-50 p-4 text-red-700">{error}</div>;
  if (!data) return <p className="text-sm text-slate-500">Loading organization...</p>;
  const { organization, companies, users } = data;
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4"><div><h1 className="text-3xl font-bold">{organization.name}</h1><p className="text-gray-500">Organization code: {organization.code}</p></div><div className="flex flex-wrap gap-2"><RequirePermission moduleCode="organizations" actionCode="delete" fallback={null}><DeleteOrganizationButton organizationId={organization.id} organizationName={organization.name} redirectTo="/organizations" /></RequirePermission><Link href="/organizations" className="rounded-lg border px-4 py-2">Back</Link></div></div>
      <section className="rounded-lg border bg-white p-6"><h2 className="mb-4 text-xl font-semibold">Organization Information</h2><div className="grid gap-4 md:grid-cols-3"><Info label="Name" value={organization.name} /><Info label="Code" value={organization.code} /><Info label="Status" value={organization.status || "active"} /></div></section>
      <section className="rounded-lg border bg-white p-6"><h2 className="mb-4 text-xl font-semibold">Companies</h2><div className="overflow-hidden rounded border"><table className="w-full text-sm"><thead className="bg-gray-100"><tr><th className="p-3 text-left">Company</th><th className="p-3 text-left">Code</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">Action</th></tr></thead><tbody>{sortCompanies(companies || []).map((company: any) => <tr key={company.id} className="border-t"><td className="p-3">{company.company_name}</td><td className="p-3">{company.company_code || "-"}</td><td className="p-3">{company.status || "active"}</td><td className="p-3"><RequirePermission moduleCode="companies" actionCode="delete" fallback={null}><DeleteCompanyButton companyId={company.id} companyName={company.company_name} /></RequirePermission></td></tr>)}{companies?.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-gray-500">No companies found.</td></tr>}</tbody></table></div></section>
      <section className="rounded-lg border bg-white p-6"><h2 className="mb-4 text-xl font-semibold">Users</h2><div className="overflow-hidden rounded border"><table className="w-full text-sm"><thead className="bg-gray-100"><tr><th className="p-3 text-left">Name</th><th className="p-3 text-left">Email</th><th className="p-3 text-left">Roles</th><th className="p-3 text-left">Status</th></tr></thead><tbody>{users?.map((user: any) => <tr key={user.id} className="border-t"><td className="p-3">{user.full_name || "-"}</td><td className="p-3">{user.email || "-"}</td><td className="p-3">{user.roles?.join(", ") || "-"}</td><td className="p-3">{user.status || "active"}</td></tr>)}{users?.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-gray-500">No users assigned.</td></tr>}</tbody></table></div></section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-medium uppercase text-gray-500">{label}</p><p className="mt-1 font-medium text-gray-900">{value}</p></div>;
}
