"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { sortCompanies } from "@/lib/companyOrdering";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import AlertMessage from "@/components/AlertMessage";

export default function AdminUsersPage() {
  const { access } = useAccessContext();
  const [profiles, setProfiles] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [userRoles, setUserRoles] = useState<any[]>([]);
  const [accessRows, setAccessRows] = useState<any[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [deleteUser, setDeleteUser] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const canDeleteUsers = can(access?.permissions || [], "users", "delete");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setMessage("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setMessage("Your session expired. Please log in again.");
      return;
    }

    const response = await fetch("/api/admin/users", {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
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

  async function confirmDeleteUser() {
    if (!deleteUser) return;

    try {
      setDeleting(true);
      setMessage("");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const response = await fetch(`/api/admin/users/${deleteUser.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to delete user.");
      }

      setProfiles((prev) => prev.filter((profile) => profile.id !== deleteUser.id));
      setUserRoles((prev) => prev.filter((row) => row.user_id !== deleteUser.id));
      setAccessRows((prev) => prev.filter((row) => row.user_id !== deleteUser.id));
      setDeleteUser(null);
      setMessage("User deleted successfully.");
    } catch (error: any) {
      setMessage(error.message || "Failed to delete user.");
    } finally {
      setDeleting(false);
    }
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

      <AlertMessage
        type={message.toLowerCase().includes("success") ? "success" : "error"}
        message={message}
        onClose={() => setMessage("")}
      />

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
                  {canDeleteUsers ? (
                    <button
                      type="button"
                      onClick={() => setDeleteUser(profile)}
                      className="inline-flex items-center gap-2 rounded border border-red-200 px-3 py-1 text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  ) : (
                    "-"
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

      {deleteUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-bold text-slate-950">Delete User</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Delete app user record for{" "}
              <span className="font-semibold text-slate-950">
                {deleteUser.full_name || deleteUser.email || "-"}
              </span>
              ? This removes the ERP profile, roles, permissions and access
              assignments. The Supabase Auth user is not deleted.
            </p>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteUser(null)}
                disabled={deleting}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteUser}
                disabled={deleting}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleting ? "Deleting..." : "Delete User"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
