import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { sortCompanies } from "@/lib/companyOrdering";
import RequirePermission from "@/components/RequirePermission";
import DeleteOrganizationButton from "@/components/DeleteOrganizationButton";
import DeleteCompanyButton from "@/components/DeleteCompanyButton";

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = adminClient();

  const { data: organization, error } = await supabase
    .from("organizations")
    .select("id, name, code, status, created_at")
    .eq("id", id)
    .single();

  if (error || !organization) {
    return (
      <div className="rounded-lg border bg-red-50 p-4 text-red-700">
        Organization not found.
      </div>
    );
  }

  const { data: companies } = await supabase
    .from("companies")
    .select("id, company_name, company_code, status")
    .eq("organization_id", id)
    .order("company_name");

  const { data: accessRows } = await supabase
    .from("user_access_assignments")
    .select("user_id")
    .eq("organization_id", id);

  const userIds = Array.from(
    new Set((accessRows || []).map((row: any) => row.user_id).filter(Boolean))
  );

  const { data: profileRows } = userIds.length
    ? await supabase
        .from("profiles")
        .select("id, email, full_name, status")
        .in("id", userIds)
    : { data: [] };

  const { data: userRoleRows } = userIds.length
    ? await supabase
        .from("user_roles")
        .select("user_id, role_id")
        .in("user_id", userIds)
    : { data: [] };

  const roleIds = Array.from(
    new Set((userRoleRows || []).map((row: any) => row.role_id).filter(Boolean))
  );

  const { data: roleRows } = roleIds.length
    ? await supabase
        .from("roles")
        .select("id, role_name, role_code")
        .in("id", roleIds)
    : { data: [] };

  const rolesById = new Map((roleRows || []).map((role: any) => [role.id, role]));
  const rolesByUserId = new Map<string, string[]>();

  (userRoleRows || []).forEach((row: any) => {
    const role = rolesById.get(row.role_id);
    const roleNames = rolesByUserId.get(row.user_id) || [];

    if (role) {
      roleNames.push(role.role_name || role.role_code);
    }

    rolesByUserId.set(row.user_id, roleNames);
  });

  const users = (profileRows || []).map((profile: any) => ({
    ...profile,
    roles: rolesByUserId.get(profile.id) || [],
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{organization.name}</h1>
          <p className="text-gray-500">
            Organization code: {organization.code}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <RequirePermission
            moduleCode="organizations"
            actionCode="delete"
            fallback={null}
          >
            <DeleteOrganizationButton
              organizationId={organization.id}
              organizationName={organization.name}
              redirectTo="/organizations"
            />
          </RequirePermission>

          <Link href="/organizations" className="rounded-lg border px-4 py-2">
            Back
          </Link>
        </div>
      </div>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Organization Information</h2>

        <div className="grid gap-4 md:grid-cols-3">
          <Info label="Name" value={organization.name} />
          <Info label="Code" value={organization.code} />
          <Info label="Status" value={organization.status || "active"} />
        </div>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Companies</h2>

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
              {sortCompanies(companies || []).map((company: any) => (
                <tr key={company.id} className="border-t">
                  <td className="p-3">{company.company_name}</td>
                  <td className="p-3">{company.company_code || "-"}</td>
                  <td className="p-3">{company.status || "active"}</td>
                  <td className="p-3">
                    <RequirePermission
                      moduleCode="companies"
                      actionCode="delete"
                      fallback={null}
                    >
                      <DeleteCompanyButton
                        companyId={company.id}
                        companyName={company.company_name}
                      />
                    </RequirePermission>
                  </td>
                </tr>
              ))}

              {companies?.length === 0 && (
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

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Users</h2>

        <div className="overflow-hidden rounded border">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-3 text-left">Name</th>
                <th className="p-3 text-left">Email</th>
                <th className="p-3 text-left">Roles</th>
                <th className="p-3 text-left">Status</th>
              </tr>
            </thead>

            <tbody>
              {users?.map((user: any) => (
                <tr key={user.id} className="border-t">
                  <td className="p-3">
                    {user.full_name || "-"}
                  </td>
                  <td className="p-3">
                    {user.email || "-"}
                  </td>
                  <td className="p-3">
                    {user.roles?.join(", ") || "-"}
                  </td>
                  <td className="p-3">
                    {user.status || "active"}
                  </td>
                </tr>
              ))}

              {users?.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-gray-500">
                    No users assigned.
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
