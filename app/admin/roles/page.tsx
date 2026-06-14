"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function RolesPage() {
  const [roles, setRoles] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRoles();
  }, []);

  async function loadRoles() {
    setLoading(true);
    setMessage("");

    const response = await fetch("/api/admin/roles");
    const result = await response.json();

    if (!response.ok) {
      setMessage(result.error || "Failed to load roles.");
      setRoles([]);
      setLoading(false);
      return;
    }

    setRoles(result.roles || []);
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Roles</h1>
          <p className="text-gray-500">
            Manage ERP roles and system access groups.
          </p>
        </div>

        <Link
          href="/admin/roles/new"
          className="rounded-lg bg-blue-600 px-4 py-2 text-white"
        >
          + New Role
        </Link>
      </div>

      {message && (
        <div className="rounded-lg border bg-red-50 p-4 text-red-700">
          {message}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-3 text-left">Role Name</th>
              <th className="p-3 text-left">Role Code</th>
              <th className="p-3 text-left">System Role</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Action</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-gray-500">
                  Loading roles...
                </td>
              </tr>
            ) : roles.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-gray-500">
                  No roles found.
                </td>
              </tr>
            ) : (
              roles.map((role) => (
                <tr key={role.id} className="border-t">
                  <td className="p-3 font-medium">{role.role_name}</td>
                  <td className="p-3">{role.role_code}</td>
                  <td className="p-3">{role.is_system_role ? "Yes" : "No"}</td>
                  <td className="p-3">{role.status || "active"}</td>
                  <td className="p-3">
                    <Link
                      href={`/admin/permissions?role_id=${role.id}`}
                      className="rounded border px-3 py-1"
                    >
                      Permissions
                    </Link>
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
