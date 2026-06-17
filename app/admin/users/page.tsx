"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { sortCompanies } from "@/lib/companyOrdering";

export default function AdminUsersPage() {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [userRoles, setUserRoles] = useState<any[]>([]);
  const [accessRows, setAccessRows] = useState<any[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setMessage("");

    const response = await fetch("/api/admin/users");
    const result = await response.json();

    if (!response.ok) {
      setMessage(result.error || "Failed to load admin users.");
      return;
    }

    setProfiles(result.profiles || []);
    setRoles(result.roles || []);
    setUserRoles(result.userRoles || []);
    setAccessRows(result.accessRows || []);
    setOrganizations(result.organizations || []);
    setCompanies(sortCompanies(result.companies || []));
    setSites(result.sites || []);
  }

  function getUserRoles(userId: string) {
    const roleIds = userRoles
      .filter((item) => item.user_id === userId)
      .map((item) => item.role_id);

    return roles
      .filter((role) => roleIds.includes(role.id))
      .map((role) => role.role_name)
      .join(", ");
  }

  function getNames(userId: string, type: "organization" | "company" | "site") {
    const rows = accessRows.filter((item) => item.user_id === userId);

    if (type === "organization") {
      const ids = Array.from(new Set(rows.map((r) => r.organization_id).filter(Boolean)));
      return organizations
        .filter((item) => ids.includes(item.id))
        .map((item) => item.name)
        .join(", ");
    }

    if (type === "company") {
      const ids = Array.from(new Set(rows.map((r) => r.company_id).filter(Boolean)));
      return companies
        .filter((item) => ids.includes(item.id))
        .map((item) => item.company_code || item.company_name)
        .join(", ");
    }

    const ids = Array.from(new Set(rows.map((r) => r.site_id).filter(Boolean)));
    return sites
      .filter((item) => ids.includes(item.id))
      .map((item) => item.site_code || item.site_name)
      .join(", ");
  }

  async function updateStatus(userId: string, status: string) {
    const { error } = await supabase
      .from("profiles")
      .update({ status })
      .eq("id", userId);

    if (error) {
      setMessage(error.message);
      return;
    }

    await loadData();
    setMessage("User status updated successfully.");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Admin Users</h1>
          <p className="text-gray-500">
            Manage users, roles, organizations, companies and sites.
          </p>
        </div>

        <Link
          href="/admin/users/new"
          className="rounded-lg bg-blue-600 px-4 py-2 text-white"
        >
          + Add User
        </Link>
      </div>

      {message && (
        <div className="rounded-lg border bg-yellow-50 p-3 text-sm text-yellow-800">
          {message}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full min-w-[1200px] text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-3 text-left">Name</th>
              <th className="p-3 text-left">Email</th>
              <th className="p-3 text-left">Roles</th>
              <th className="p-3 text-left">Organization</th>
              <th className="p-3 text-left">Companies</th>
              <th className="p-3 text-left">Sites</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Action</th>
              <th className="p-3 text-left">Access</th>
            </tr>
          </thead>

          <tbody>
            {profiles.map((profile) => (
              <tr key={profile.id} className="border-t">
                <td className="p-3 font-medium">{profile.full_name || "-"}</td>
                <td className="p-3">{profile.email}</td>
                <td className="p-3">{getUserRoles(profile.id) || "-"}</td>
                <td className="p-3">{getNames(profile.id, "organization") || "-"}</td>
                <td className="p-3">{getNames(profile.id, "company") || "-"}</td>
                <td className="p-3">{getNames(profile.id, "site") || "-"}</td>
                <td className="p-3">{profile.status || "active"}</td>

                <td className="p-3">
                  {profile.status === "inactive" ? (
                    <button
                      type="button"
                      onClick={() => updateStatus(profile.id, "active")}
                      className="rounded bg-blue-600 px-3 py-1 text-white"
                    >
                      Activate
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => updateStatus(profile.id, "inactive")}
                      className="rounded bg-red-600 px-3 py-1 text-white"
                    >
                      Deactivate
                    </button>
                  )}
                </td>

                <td className="p-3">
                  <Link
                    href={`/admin/users/${profile.id}`}
                    className="rounded border px-3 py-1"
                  >
                    Edit Access
                  </Link>
                </td>
              </tr>
            ))}

            {profiles.length === 0 && (
              <tr>
                <td colSpan={9} className="p-6 text-center text-gray-500">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
