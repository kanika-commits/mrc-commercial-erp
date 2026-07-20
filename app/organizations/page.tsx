import Link from "next/link";
import { supabase } from "@/lib/supabase";
import RequirePermission from "@/components/RequirePermission";
import OrganizationsTable from "@/app/organizations/OrganizationsTable";

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

  const rows = (organizations || []).map((org) => ({
    id: org.id,
    name: org.name,
    code: org.code,
    status: org.status,
    created_at: org.created_at,
    company_count: companyCountMap.get(org.id) || 0,
  }));

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

      <OrganizationsTable organizations={rows} />
    </div>
  );
}
