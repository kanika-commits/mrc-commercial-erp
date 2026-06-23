"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { sortCompanies } from "@/lib/companyOrdering";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import AlertMessage from "@/components/AlertMessage";

const actions = [
  "view",
  "add",
  "edit",
  "delete",
  "approve",
  "reject",
  "upload",
  "submit",
  "mark_paid",
  "export",
];

function availableActionsForModule(moduleCode: string) {
  return moduleCode === "dashboard" ? ["view"] : actions;
}

export default function UserAccessPage() {
  const { access } = useAccessContext();
  const params = useParams();
  const userId = params.id as string;

  const [profile, setProfile] = useState<any>(null);
  const [roles, setRoles] = useState<any[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [modules, setModules] = useState<any[]>([]);

  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [selectedOrganizationIds, setSelectedOrganizationIds] = useState<string[]>([]);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);

  const [permissionMap, setPermissionMap] = useState<Record<string, boolean>>({});

  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [permissionsSaved, setPermissionsSaved] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [resetConfirmationText, setResetConfirmationText] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const permissions = access?.permissions || [];
  const roleCodes = access?.roleCodes || [];
  const canEditUser =
    roleCodes.includes("platform_owner") ||
    can(permissions, "*", "*") ||
    can(permissions, "users", "edit");
  const canDeleteUser =
    roleCodes.includes("platform_owner") ||
    can(permissions, "*", "*") ||
    can(permissions, "users", "delete");

  useEffect(() => {
    loadData();
  }, [userId]);

  function key(moduleCode: string, actionCode: string) {
    return `${moduleCode}.${actionCode}`;
  }

  async function loadData() {
    try {
      setLoading(true);
      setMessage("");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const response = await fetch(`/api/admin/users/${userId}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to load user access.");
      }

      if (!result.profile) {
        throw new Error("User profile was not found.");
      }

      const roleIds = (result.userRoles || []).map((item: any) => item.role_id);
      const userPermissionData = result.userPermissions || [];

      setPermissionsSaved(userPermissionData.length > 0);

      const initialPermissions: Record<string, boolean> = {};

      userPermissionData.forEach((item: any) => {
        initialPermissions[key(item.module_code, item.action_code)] = item.allowed === true;
      });

      setProfile(result.profile);
      setRoles(result.roles || []);
      setOrganizations(result.organizations || []);
      setCompanies(sortCompanies(result.companies || []));
      setSites(result.sites || []);
      setModules(
        (result.modules || []).sort((a: any, b: any) => {
          if (a.module_group === b.module_group) {
            return Number(a.sort_order || 0) - Number(b.sort_order || 0);
          }
          return String(a.module_group).localeCompare(String(b.module_group));
        })
      );

      setSelectedRoleIds(roleIds);

      setSelectedOrganizationIds(
        Array.from(new Set((result.accessRows || []).map((x: any) => x.organization_id).filter(Boolean)))
      );

      setSelectedCompanyIds(
        Array.from(new Set((result.accessRows || []).map((x: any) => x.company_id).filter(Boolean)))
      );

      setSelectedSiteIds(
        Array.from(new Set((result.accessRows || []).map((x: any) => x.site_id).filter(Boolean)))
      );

      setPermissionMap(initialPermissions);
    } catch (error: any) {
      setMessage(error.message || "Failed to load user access.");
    } finally {
      setLoading(false);
    }
  }

  const filteredCompanies = useMemo(() => {
    return companies.filter((company) =>
      selectedOrganizationIds.includes(company.organization_id)
    );
  }, [companies, selectedOrganizationIds]);

  const filteredSites = useMemo(() => {
    return sites.filter((site) => selectedCompanyIds.includes(site.company_id));
  }, [sites, selectedCompanyIds]);

  const unassignedSites = useMemo(() => {
    if (selectedCompanyIds.length === 0) return [];

    return sites.filter((site) => !site.company_id);
  }, [sites, selectedCompanyIds]);

  const groupedModules = useMemo(() => {
    return modules.reduce<Record<string, any[]>>((acc, item) => {
      if (!acc[item.module_group]) acc[item.module_group] = [];
      acc[item.module_group].push(item);
      return acc;
    }, {});
  }, [modules]);

  function toggleRole(roleId: string) {
    setSelectedRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]
    );
  }

  function toggleOrganization(orgId: string) {
    setSelectedOrganizationIds((prev) => {
      const exists = prev.includes(orgId);
      const next = exists ? prev.filter((id) => id !== orgId) : [...prev, orgId];

      if (exists) {
        const removedCompanyIds = companies
          .filter((company) => company.organization_id === orgId)
          .map((company) => company.id);

        setSelectedCompanyIds((companyPrev) =>
          companyPrev.filter((companyId) => !removedCompanyIds.includes(companyId))
        );

        setSelectedSiteIds((sitePrev) =>
          sitePrev.filter((siteId) => {
            const site = sites.find((s) => s.id === siteId);
            return site && !removedCompanyIds.includes(site.company_id);
          })
        );
      }

      return next;
    });
  }

  function toggleCompany(companyId: string) {
    setSelectedCompanyIds((prev) => {
      const exists = prev.includes(companyId);
      const next = exists ? prev.filter((id) => id !== companyId) : [...prev, companyId];

      if (exists) {
        const removedSiteIds = sites
          .filter((site) => site.company_id === companyId)
          .map((site) => site.id);

        setSelectedSiteIds((sitePrev) =>
          sitePrev.filter((siteId) => !removedSiteIds.includes(siteId))
        );
      }

      return next;
    });
  }

  function toggleSite(siteId: string) {
    setSelectedSiteIds((prev) =>
      prev.includes(siteId) ? prev.filter((id) => id !== siteId) : [...prev, siteId]
    );
  }

  function isAllowed(moduleCode: string, actionCode: string) {
    return permissionMap[key(moduleCode, actionCode)] === true;
  }

  function setPermission(moduleCode: string, actionCode: string, allowed: boolean) {
    setPermissionMap((prev) => ({
      ...prev,
      [key(moduleCode, actionCode)]: allowed,
    }));
  }

  function setRow(moduleCode: string, allowed: boolean) {
    setPermissionMap((prev) => {
      const next = { ...prev };
      availableActionsForModule(moduleCode).forEach((action) => {
        next[key(moduleCode, action)] = allowed;
      });
      return next;
    });
  }

  function setGroup(groupName: string, allowed: boolean) {
    setPermissionMap((prev) => {
      const next = { ...prev };
      (groupedModules[groupName] || []).forEach((module) => {
        availableActionsForModule(module.module_code).forEach((action) => {
          next[key(module.module_code, action)] = allowed;
        });
      });
      return next;
    });
  }

  function setAll(allowed: boolean) {
    setPermissionMap((prev) => {
      const next = { ...prev };
      modules.forEach((module) => {
        availableActionsForModule(module.module_code).forEach((action) => {
          next[key(module.module_code, action)] = allowed;
        });
      });
      return next;
    });
  }

  function rowChecked(moduleCode: string) {
    return availableActionsForModule(moduleCode).every((action) =>
      isAllowed(moduleCode, action)
    );
  }

  async function saveAccess() {
    try {
      setSaving(true);
      setMessage("");

      if (selectedRoleIds.length === 0) {
        setMessage("Select at least one role.");
        return;
      }

      if (selectedOrganizationIds.length === 0) {
        setMessage("Select at least one organization.");
        return;
      }

      const permissionRows: any[] = [];

      modules.forEach((module) => {
        availableActionsForModule(module.module_code).forEach((action) => {
          if (isAllowed(module.module_code, action)) {
            permissionRows.push({
              user_id: userId,
              module_code: module.module_code,
              action_code: action,
              allowed: true,
            });
          }
        });
      });

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          role_ids: selectedRoleIds,
          organization_ids: selectedOrganizationIds,
          company_ids: selectedCompanyIds,
          site_ids: selectedSiteIds,
          user_permissions: permissionRows,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to save user access.");
      }

      await loadData();
      setPermissionsSaved(true);
      setMessage(
        `User access saved successfully. ${result.permissions_saved || 0} explicit user permission overrides saved.`
      );
    } catch (error: any) {
      setMessage(error.message || "Failed to save user access.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteUser() {
    try {
      setDeleting(true);
      setMessage("");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to delete user.");
      }

      window.location.href = "/admin/users";
    } catch (error: any) {
      setMessage(error.message || "Failed to delete user.");
    } finally {
      setDeleting(false);
    }
  }

  async function resetUserPassword() {
    try {
      setResettingPassword(true);
      setMessage("");

      if (!resetPassword || !resetConfirmPassword) {
        setMessage("Enter and confirm the new password.");
        return;
      }

      if (resetPassword.length < 8) {
        setMessage("New password must be at least 8 characters.");
        return;
      }

      if (resetPassword !== resetConfirmPassword) {
        setMessage("New password and confirmation do not match.");
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "reset_password",
          new_password: resetPassword,
          confirmation_text: resetConfirmationText,
        }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to reset password.");
      }

      setResetPassword("");
      setResetConfirmPassword("");
      setResetConfirmationText("");
      setShowResetPasswordModal(false);
      setMessage("Password reset successfully. Share the new password manually.");
    } catch (error: any) {
      setMessage(error.message || "Failed to reset password.");
    } finally {
      setResettingPassword(false);
    }
  }

  if (loading) return <p className="text-gray-500">Loading user access...</p>;

  if (!profile) {
    return (
      <div className="rounded-lg border bg-red-50 p-4 text-red-700">
        {message || "User not found."}
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">User Access</h1>
          <p className="text-gray-500">
            Assign roles, scope and exact module permissions for this user.
          </p>
        </div>

        <Link href="/admin/users" className="rounded-lg border px-4 py-2">
          Back
        </Link>
      </div>

      <AlertMessage
        type={message.toLowerCase().includes("success") ? "success" : "error"}
        message={message}
        onClose={() => setMessage("")}
      />
{!permissionsSaved && (
  <div className="rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-800">
    This user has no explicit user permission overrides. Role permissions will apply automatically until you save overrides here.
  </div>
)}
      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">User Details</h2>

        <div className="grid gap-4 md:grid-cols-3">
          <Info label="Name" value={profile.full_name || "-"} />
          <Info label="Email" value={profile.email || "-"} />
          <Info label="Status" value={profile.status || "active"} />
        </div>

        {(canEditUser || canDeleteUser) && (
          <div className="mt-4 flex gap-3">
            {canEditUser && (
              <button
                type="button"
                onClick={() => setShowResetPasswordModal(true)}
                className="rounded border border-blue-200 px-3 py-1 text-blue-700 hover:bg-blue-50"
              >
                Reset Password
              </button>
            )}

            {canDeleteUser && (
              <button
                type="button"
                onClick={() => setShowDeleteModal(true)}
                className="rounded border border-red-200 px-3 py-1 text-red-700 hover:bg-red-50"
              >
                Delete User
              </button>
            )}
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Roles</h2>

        <div className="grid gap-3 md:grid-cols-2">
          {roles.map((role) => (
            <label key={role.id} className="flex items-center gap-2 rounded border p-3">
              <input
                type="checkbox"
                checked={selectedRoleIds.includes(role.id)}
                onChange={() => toggleRole(role.id)}
              />
              <span>{role.role_name}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Organization Access</h2>

        <div className="grid gap-3 md:grid-cols-2">
          {organizations.map((org) => (
            <label key={org.id} className="flex items-center gap-2 rounded border p-3">
              <input
                type="checkbox"
                checked={selectedOrganizationIds.includes(org.id)}
                onChange={() => toggleOrganization(org.id)}
              />
              <span>
                {org.name} - {org.code}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Company Access</h2>

        {selectedOrganizationIds.length === 0 ? (
          <p className="text-gray-500">Select organization first.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {filteredCompanies.map((company) => (
              <label key={company.id} className="flex items-center gap-2 rounded border p-3">
                <input
                  type="checkbox"
                  checked={selectedCompanyIds.includes(company.id)}
                  onChange={() => toggleCompany(company.id)}
                />
                <span>
                  {company.company_name} - {company.company_code || "-"}
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Site Access</h2>

        {selectedCompanyIds.length === 0 ? (
          <p className="text-gray-500">Select companies first.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              {filteredSites.map((site) => (
                <label key={site.id} className="flex items-center gap-2 rounded border p-3">
                  <input
                    type="checkbox"
                    checked={selectedSiteIds.includes(site.id)}
                    onChange={() => toggleSite(site.id)}
                  />
                  <span>
                    {site.site_name} - {site.site_code || "-"}
                  </span>
                </label>
              ))}
            </div>

            {unassignedSites.length > 0 && (
              <div>
                <h3 className="mb-3 text-sm font-semibold text-gray-600">
                  Unassigned Sites
                </h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {unassignedSites.map((site) => (
                    <label key={site.id} className="flex items-center gap-2 rounded border p-3">
                      <input
                        type="checkbox"
                        checked={selectedSiteIds.includes(site.id)}
                        onChange={() => toggleSite(site.id)}
                      />
                      <span>
                        {site.site_name} - {site.site_code || "-"}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-white p-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">User Permissions</h2>
            <p className="text-sm text-gray-500">
              Checked permissions are explicit user overrides. Leave empty to inherit role permissions.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAll(true)}
              className="rounded bg-blue-600 px-3 py-2 text-sm text-white"
            >
              Select All
            </button>

            <button
              type="button"
              onClick={() => setAll(false)}
              className="rounded border px-3 py-2 text-sm"
            >
              Clear All
            </button>
          </div>
        </div>

        <div className="space-y-8 overflow-x-auto">
          {Object.entries(groupedModules).map(([groupName, items]) => (
            <div key={groupName}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-gray-700">{groupName}</h3>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setGroup(groupName, true)}
                    className="rounded bg-slate-900 px-3 py-1 text-sm text-white"
                  >
                    Select Group
                  </button>

                  <button
                    type="button"
                    onClick={() => setGroup(groupName, false)}
                    className="rounded border px-3 py-1 text-sm"
                  >
                    Clear Group
                  </button>
                </div>
              </div>

              <table className="w-full min-w-[1050px] text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-2 text-left">Module</th>
                    <th className="p-2 text-center">All</th>
                    {actions.map((action) => (
                      <th key={action} className="p-2 text-center capitalize">
                        {action}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {items.map((module: any) => {
                    const availableActions = availableActionsForModule(module.module_code);

                    return (
                      <tr key={module.id} className="border-t">
                        <td className="p-2 font-medium">{module.module_name}</td>

                        <td className="p-2 text-center">
                          <input
                            type="checkbox"
                            checked={rowChecked(module.module_code)}
                            onChange={(e) => setRow(module.module_code, e.target.checked)}
                          />
                        </td>

                        {actions.map((action) => (
                          <td key={action} className="p-2 text-center">
                            {availableActions.includes(action) ? (
                              <input
                                type="checkbox"
                                checked={isAllowed(module.module_code, action)}
                                onChange={(e) =>
                                  setPermission(module.module_code, action, e.target.checked)
                                }
                              />
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </section>

      <div className="sticky bottom-5 flex justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={saveAccess}
          className="rounded-lg bg-blue-600 px-5 py-3 text-white shadow-lg disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save User Access"}
        </button>
      </div>

      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-bold text-slate-950">Delete User</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Delete app user record for{" "}
              <span className="font-semibold text-slate-950">
                {profile.full_name || profile.email || "-"}
              </span>
              ? This removes the ERP profile, roles, permissions and access
              assignments. The Supabase Auth user is not deleted.
            </p>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={deleteUser}
                disabled={deleting}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleting ? "Deleting..." : "Delete User"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showResetPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-bold text-slate-950">Reset Password</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Set a new password for{" "}
              <span className="font-semibold text-slate-950">
                {profile.full_name || profile.email || "-"}
              </span>
              . The password will not be emailed automatically.
            </p>

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">
                  New Password
                </span>
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(event) => setResetPassword(event.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                  autoComplete="new-password"
                />
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-700">
                  Confirm Password
                </span>
                <input
                  type="password"
                  value={resetConfirmPassword}
                  onChange={(event) => setResetConfirmPassword(event.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                  autoComplete="new-password"
                />
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-700">
                  Type RESET to confirm
                </span>
                <input
                  type="text"
                  value={resetConfirmationText}
                  onChange={(event) => setResetConfirmationText(event.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowResetPasswordModal(false)}
                disabled={resettingPassword}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={resetUserPassword}
                disabled={resettingPassword}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {resettingPassword ? "Resetting..." : "Reset Password"}
              </button>
            </div>
          </div>
        </div>
      )}
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
