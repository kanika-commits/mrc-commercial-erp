"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

const actions = ["view", "add", "edit", "delete", "approve", "reject", "upload"];

export default function EditUserAccessPage() {
  const params = useParams();
  const userId = params.id as string;

  const [profile, setProfile] = useState<any>(null);
  const [roles, setRoles] = useState<any[]>([]);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);

  const [organizations, setOrganizations] = useState<any[]>([]);
  const [selectedOrganizationIds, setSelectedOrganizationIds] = useState<string[]>([]);

  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);

  const [sites, setSites] = useState<any[]>([]);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);

  const [modules, setModules] = useState<any[]>([]);
  const [rolePermissions, setRolePermissions] = useState<any[]>([]);
  const [userOverrides, setUserOverrides] = useState<any[]>([]);

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, [userId]);

  async function loadData() {
    try {
      setLoading(true);
      setMessage("");

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("id, email, full_name, status")
        .eq("id", userId)
        .single();

      if (profileError) throw profileError;

      const { data: roleData, error: roleError } = await supabase
        .from("roles")
        .select("id, role_name, role_code, status, is_system_role")
        .eq("status", "active")
        .order("role_name");

      if (roleError) throw roleError;

      const { data: userRoleData, error: userRoleError } = await supabase
        .from("user_roles")
        .select("role_id")
        .eq("user_id", userId);

      if (userRoleError) throw userRoleError;

      const { data: orgData, error: orgError } = await supabase
        .from("organizations")
        .select("id, name, code, status")
        .eq("status", "active")
        .order("name");

      if (orgError) throw orgError;

      const { data: companyData, error: companyError } = await supabase
        .from("companies")
        .select("id, organization_id, company_name, company_code, status")
        .eq("status", "active")
        .order("company_name");

      if (companyError) throw companyError;

      const { data: siteData, error: siteError } = await supabase
        .from("sites")
        .select("id, company_id, site_name, site_code, status")
        .eq("status", "active")
        .order("site_name");

      if (siteError) throw siteError;

      const { data: accessData, error: accessError } = await supabase
        .from("user_access_assignments")
        .select("organization_id, company_id, site_id")
        .eq("user_id", userId);

      if (accessError) throw accessError;

      const { data: moduleData, error: moduleError } = await supabase
        .from("erp_modules")
        .select("id, module_group, module_code, module_name, route, sort_order, status")
        .eq("status", "active");

      if (moduleError) throw moduleError;

      const { data: allRolePerms, error: rolePermError } = await supabase
        .from("role_permissions")
        .select("role_id, module_code, action_code, allowed");

      if (rolePermError) throw rolePermError;

      const { data: overrideData, error: overrideError } = await supabase
        .from("user_permission_overrides")
        .select("module_code, action_code, allowed")
        .eq("user_id", userId);

      if (overrideError) throw overrideError;

      setProfile(profileData);
      setRoles(roleData || []);
      setSelectedRoleIds((userRoleData || []).map((item: any) => item.role_id));

      setOrganizations(orgData || []);
      setCompanies(companyData || []);
      setSites(siteData || []);

      setSelectedOrganizationIds(
        Array.from(
          new Set((accessData || []).map((item: any) => item.organization_id).filter(Boolean))
        )
      );

      setSelectedCompanyIds(
        Array.from(
          new Set((accessData || []).map((item: any) => item.company_id).filter(Boolean))
        )
      );

      setSelectedSiteIds(
        Array.from(
          new Set((accessData || []).map((item: any) => item.site_id).filter(Boolean))
        )
      );

      setModules(
        (moduleData || []).sort((a: any, b: any) => {
          if (a.module_group === b.module_group) {
            return Number(a.sort_order || 0) - Number(b.sort_order || 0);
          }
          return String(a.module_group).localeCompare(String(b.module_group));
        })
      );

      setRolePermissions(allRolePerms || []);
      setUserOverrides(overrideData || []);
    } catch (error: any) {
      setMessage(error.message || "Failed to load user access.");
    } finally {
      setLoading(false);
    }
  }

  const filteredCompanies = useMemo(() => {
    if (selectedOrganizationIds.length === 0) return [];
    return companies.filter((company) =>
      selectedOrganizationIds.includes(company.organization_id)
    );
  }, [companies, selectedOrganizationIds]);

  const filteredSites = useMemo(() => {
    if (selectedCompanyIds.length === 0) return [];
    return sites.filter((site) => selectedCompanyIds.includes(site.company_id));
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
      prev.includes(roleId)
        ? prev.filter((id) => id !== roleId)
        : [...prev, roleId]
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
      prev.includes(siteId)
        ? prev.filter((id) => id !== siteId)
        : [...prev, siteId]
    );
  }

  function inheritedAllowed(moduleCode: string, actionCode: string) {
    return rolePermissions.some(
      (permission) =>
        selectedRoleIds.includes(permission.role_id) &&
        permission.module_code === moduleCode &&
        permission.action_code === actionCode &&
        permission.allowed === true
    );
  }

  function overrideFor(moduleCode: string, actionCode: string) {
    return userOverrides.find(
      (item) =>
        item.module_code === moduleCode &&
        item.action_code === actionCode
    );
  }

  function finalAllowed(moduleCode: string, actionCode: string) {
    const override = overrideFor(moduleCode, actionCode);
    if (override) return override.allowed === true;
    return inheritedAllowed(moduleCode, actionCode);
  }

  function toggleUserPermission(moduleCode: string, actionCode: string) {
    const current = finalAllowed(moduleCode, actionCode);

    setUserOverrides((prev) => {
      const existing = prev.find(
        (item) =>
          item.module_code === moduleCode &&
          item.action_code === actionCode
      );

      if (existing) {
        return prev.map((item) =>
          item.module_code === moduleCode && item.action_code === actionCode
            ? { ...item, allowed: !current }
            : item
        );
      }

      return [
        ...prev,
        {
          module_code: moduleCode,
          action_code: actionCode,
          allowed: !current,
        },
      ];
    });
  }

  async function updateStatus(status: string) {
    const { error } = await supabase
      .from("profiles")
      .update({ status })
      .eq("id", userId);

    if (error) {
      setMessage(error.message);
      return;
    }

    await loadData();
    setMessage("User status updated.");
  }

  async function saveAccess() {
    try {
      setSaving(true);
      setMessage("");

      const { error: deleteRoleError } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId);

      if (deleteRoleError) throw deleteRoleError;

      if (selectedRoleIds.length > 0) {
        const roleRows = selectedRoleIds.map((roleId) => ({
          user_id: userId,
          role_id: roleId,
        }));

        const { error: insertRoleError } = await supabase
          .from("user_roles")
          .insert(roleRows);

        if (insertRoleError) throw insertRoleError;
      }

      const { error: deleteAccessError } = await supabase
        .from("user_access_assignments")
        .delete()
        .eq("user_id", userId);

      if (deleteAccessError) throw deleteAccessError;

      const accessRows = selectedSiteIds.map((siteId) => {
        const site = sites.find((item) => item.id === siteId);
        const company = companies.find((item) => item.id === site?.company_id);

        return {
          user_id: userId,
          organization_id: company?.organization_id || null,
          company_id: company?.id || null,
          site_id: siteId,
        };
      });

      if (accessRows.length > 0) {
        const { error: insertAccessError } = await supabase
          .from("user_access_assignments")
          .insert(accessRows);

        if (insertAccessError) throw insertAccessError;
      }

      const { error: deleteOverridesError } = await supabase
        .from("user_permission_overrides")
        .delete()
        .eq("user_id", userId);

      if (deleteOverridesError) throw deleteOverridesError;

      if (userOverrides.length > 0) {
        const overrideRows = userOverrides.map((item) => ({
          user_id: userId,
          module_code: item.module_code,
          action_code: item.action_code,
          allowed: item.allowed,
        }));

        const { error: insertOverridesError } = await supabase
          .from("user_permission_overrides")
          .insert(overrideRows);

        if (insertOverridesError) throw insertOverridesError;
      }

      await loadData();
      setMessage("User access saved successfully.");
    } catch (error: any) {
      setMessage(error.message || "Failed to save access.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-gray-500">Loading user access...</p>;
  }

  if (!profile) {
    return <p className="text-red-600">User not found.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">User Access</h1>
          <p className="text-gray-500">
            Assign roles, organization, companies, sites and module permissions.
          </p>
        </div>

        <Link href="/admin/users" className="rounded-lg border px-4 py-2">
          Back
        </Link>
      </div>

      {message && (
        <div className="rounded-lg border bg-yellow-50 p-3 text-sm text-yellow-800">
          {message}
        </div>
      )}

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">User Details</h2>

        <div className="grid gap-4 md:grid-cols-3">
          <Info label="Name" value={profile.full_name || "-"} />
          <Info label="Email" value={profile.email || "-"} />
          <Info label="Status" value={profile.status || "active"} />
        </div>

        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={() => updateStatus("active")}
            className="rounded bg-blue-600 px-3 py-1 text-white"
          >
            Activate
          </button>

          <button
            type="button"
            onClick={() => updateStatus("inactive")}
            className="rounded bg-red-600 px-3 py-1 text-white"
          >
            Deactivate
          </button>
        </div>
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
        )}
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Module Permissions</h2>

        <div className="space-y-8 overflow-x-auto">
          {Object.entries(groupedModules).map(([groupName, items]) => (
            <div key={groupName}>
              <h3 className="mb-3 font-semibold text-gray-700">{groupName}</h3>

              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-2 text-left">Module</th>
                    {actions.map((action) => (
                      <th key={action} className="p-2 text-center capitalize">
                        {action}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {items.map((module) => (
                    <tr key={module.id} className="border-t">
                      <td className="p-2 font-medium">{module.module_name}</td>

                      {actions.map((action) => {
                        const inherited = inheritedAllowed(module.module_code, action);
                        const override = overrideFor(module.module_code, action);
                        const checked = finalAllowed(module.module_code, action);

                        return (
                          <td key={action} className="p-2 text-center">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                toggleUserPermission(module.module_code, action)
                              }
                            />

                            {override ? (
                              <span className="ml-1 text-xs text-blue-600">*</span>
                            ) : inherited ? (
                              <span className="ml-1 text-xs text-gray-400">R</span>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <p className="mt-3 text-xs text-gray-500">
          R = inherited from role. * = custom user override.
        </p>
      </section>

      <div className="flex justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={saveAccess}
          className="rounded-lg bg-blue-600 px-5 py-2 text-white disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save User Access"}
        </button>
      </div>
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