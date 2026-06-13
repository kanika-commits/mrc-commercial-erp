"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

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

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const currentUserEmail = user?.email || "";
    const isPlatformOwner = currentUserEmail === "kanika@mrcgroup.in";

    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select("id, email, full_name, status, created_at")
      .order("created_at", { ascending: false });

    if (profileError) {
      setMessage(profileError.message);
      return;
    }

    const { data: roleData, error: roleError } = await supabase
      .from("roles")
      .select("id, role_name, role_code")
      .eq("status", "active")
      .order("role_name");

    if (roleError) {
      setMessage(roleError.message);
      return;
    }

    const { data: userRoleData, error: userRoleError } = await supabase
      .from("user_roles")
      .select("id, user_id, role_id");

    if (userRoleError) {
      setMessage(userRoleError.message);
      return;
    }

    const { data: accessData, error: accessError } = await supabase
      .from("user_access_assignments")
      .select("user_id, organization_id, company_id, site_id");

    if (accessError) {
      setMessage(accessError.message);
      return;
    }

    const { data: orgData } = await supabase
      .from("organizations")
      .select("id, name, code");

    const { data: companyData } = await supabase
      .from("companies")
      .select("id, company_name, company_code");

    const { data: siteData } = await supabase
      .from("sites")
      .select("id, site_name, site_code");

    const safeProfiles = isPlatformOwner
      ? profileData || []
      : (profileData || []).filter(
          (profile: any) => profile.email !== "kanika@mrcgroup.in"
        );

    setProfiles(safeProfiles);
    setRoles(roleData || []);
    setUserRoles(userRoleData || []);
    setAccessRows(accessData || []);
    setOrganizations(orgData || []);
    setCompanies(companyData || []);
    setSites(siteData || []);
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