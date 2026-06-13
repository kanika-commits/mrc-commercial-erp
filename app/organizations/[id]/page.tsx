import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

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

  const { data: users } = await supabase
    .from("user_access_assignments")
    .select(`
      user_id,
      profiles (
        email,
        full_name,
        status
      )
    `)
    .eq("organization_id", id);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{organization.name}</h1>
          <p className="text-gray-500">
            Organization code: {organization.code}
          </p>
        </div>

        <Link href="/organizations" className="rounded-lg border px-4 py-2">
          Back
        </Link>
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
              </tr>
            </thead>

            <tbody>
              {companies?.map((company: any) => (
                <tr key={company.id} className="border-t">
                  <td className="p-3">{company.company_name}</td>
                  <td className="p-3">{company.company_code || "-"}</td>
                  <td className="p-3">{company.status || "active"}</td>
                </tr>
              ))}

              {companies?.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-6 text-center text-gray-500">
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
                <th className="p-3 text-left">Status</th>
              </tr>
            </thead>

            <tbody>
              {users?.map((item: any, index: number) => (
                <tr key={`${item.user_id}-${index}`} className="border-t">
                  <td className="p-3">
                    {item.profiles?.full_name || "-"}
                  </td>
                  <td className="p-3">
                    {item.profiles?.email || "-"}
                  </td>
                  <td className="p-3">
                    {item.profiles?.status || "active"}
                  </td>
                </tr>
              ))}

              {users?.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-6 text-center text-gray-500">
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