"use client";

import Link from "next/link";
import { useState } from "react";
import AlertMessage from "@/components/AlertMessage";
import RequirePermission from "@/components/RequirePermission";
import DeleteOrganizationButton from "@/components/DeleteOrganizationButton";
import { formatIstTimestamp } from "@/lib/dateTime";

type OrganizationRow = {
  id: string;
  name: string;
  code: string | null;
  status: string | null;
  created_at: string | null;
  company_count: number;
};

export default function OrganizationsTable({
  organizations,
}: {
  organizations: OrganizationRow[];
}) {
  const [rows, setRows] = useState(organizations);
  const [message, setMessage] = useState("");

  function handleDeleted(id: string) {
    setRows((current) => current.filter((organization) => organization.id !== id));
    setMessage("Organization deleted successfully.");
  }

  return (
    <div className="space-y-4">
      <AlertMessage
        type="success"
        message={message}
        onClose={() => setMessage("")}
      />

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
            {rows.map((org) => (
              <tr key={org.id} className="border-t">
                <td className="p-3 font-medium">{org.name}</td>
                <td className="p-3">{org.code}</td>
                <td className="p-3">{org.company_count || 0}</td>
                <td className="p-3">{org.status || "active"}</td>
                <td className="p-3">
                  {formatIstTimestamp(org.created_at)}
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/organizations/${org.id}`}
                      className="rounded border px-3 py-1"
                    >
                      View
                    </Link>

                    <RequirePermission
                      moduleCode="organizations"
                      actionCode="edit"
                      fallback={null}
                    >
                      <Link
                        href={`/organizations/${org.id}/edit`}
                        className="rounded border px-3 py-1"
                      >
                        Edit
                      </Link>
                    </RequirePermission>

                    <RequirePermission
                      moduleCode="organizations"
                      actionCode="delete"
                      fallback={null}
                    >
                      <DeleteOrganizationButton
                        organizationId={org.id}
                        organizationName={org.name}
                        onDeleted={() => handleDeleted(org.id)}
                      />
                    </RequirePermission>
                  </div>
                </td>
              </tr>
            ))}

            {rows.length === 0 && (
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
