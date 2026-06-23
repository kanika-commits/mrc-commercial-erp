import Link from "next/link";
import { supabase } from "@/lib/supabase";
import RequirePermission from "@/components/RequirePermission";

export default async function OrganizationsPage() {
  const { data: organizations, error } = await supabase
    .from("organizations")
    .select("id, name, code, status, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="rounded-lg border bg-red-50 p-4 text-red-700">
        Failed to load organizations: {error.message}
      </div>
    );
  }

  const orgIds = (organizations || []).map((org) => org.id);

  const { data: companies } = orgIds.length
    ? await supabase
        .from("companies")
        .select("id, organization_id")
        .in("organization_id", orgIds)
    : { data: [] };

  const companyCountMap = new Map<string, number>();

  (companies || []).forEach((company: any) => {
    const current = companyCountMap.get(company.organization_id) || 0;
    companyCountMap.set(company.organization_id, current + 1);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Organizations</h1>
          <p className="text-gray-500">
            Manage customer organizations using ConstructIQ.
          </p>
        </div>

        <RequirePermission moduleCode="organizations" actionCode="add" fallback={null}>
          <Link
            href="/organizations/new"
            className="rounded-lg bg-blue-600 px-4 py-2 text-white"
          >
            + New Organization
          </Link>
        </RequirePermission>
      </div>

      <div className="overflow-hidden rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-3 text-left">Organization</th>
              <th className="p-3 text-left">Code</th>
              <th className="p-3 text-left">Companies</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Created At</th>
              <th className="p-3 text-left">Action</th>
            </tr>
          </thead>

          <tbody>
            {organizations?.map((org) => (
              <tr key={org.id} className="border-t">
                <td className="p-3 font-medium">{org.name}</td>
                <td className="p-3">{org.code}</td>
                <td className="p-3">{companyCountMap.get(org.id) || 0}</td>
                <td className="p-3">{org.status || "active"}</td>
                <td className="p-3">
                  {org.created_at
                    ? new Date(org.created_at).toLocaleString("en-IN")
                    : "-"}
                </td>
                <td className="p-3">
  <div className="flex gap-2">
    <Link
      href={`/organizations/${org.id}`}
      className="rounded border px-3 py-1"
    >
      View
    </Link>

    <RequirePermission moduleCode="organizations" actionCode="edit" fallback={null}>
      <Link
        href={`/organizations/${org.id}/edit`}
        className="rounded border px-3 py-1"
      >
        Edit
      </Link>
    </RequirePermission>
  </div>
</td>
              </tr>
            ))}

            {organizations?.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-gray-500">
                  No organizations found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
