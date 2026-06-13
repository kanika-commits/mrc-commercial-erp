"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

const actions = ["view", "add", "edit", "delete", "approve", "reject", "upload", "export"];

export default function UserAccessPage() {
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

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("id, email, full_name, status")
        .eq("id", userId)
        .single();

      if (profileError) throw profileError;

      const { data: roleData, error: roleError } = await supabase
        .from("roles")
        .select("id, role_name, role_code, status")
        .eq("status", "active")
        .order("role_name");

      if (roleError) throw roleError;

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

      const { data: moduleData, error: moduleError } = await supabase
        .from("erp_modules")
        .select("id, module_group, module_code, module_name, sort_order")
        .eq("status", "active");

      if (moduleError) throw moduleError;

      const { data: userRoleData, error: userRoleError } = await supabase
        .from("user_roles")
        .select("role_id")
        .eq("user_id", userId);

      if (userRoleError) throw userRoleError;

      const roleIds = (userRoleData || []).map((item: any) => item.role_id);

      const { data: accessData, error: accessError } = await supabase
        .from("user_access_assignments")
        .select("organization_id, company_id, site_id")
        .eq("user_id", userId);

      if (accessError) throw accessError;

      const { data: userPermissionData, error: userPermissionError } = await supabase
      
        .from("user_permissions")
        .select("module_code, action_code, allowed")
        .eq("user_id", userId);
setPermissionsSaved((userPermissionData || []).length > 0);
      if (userPermissionError) throw userPermissionError;

      let initialPermissions: Record<string, boolean> = {};

      if ((userPermissionData || []).length > 0) {
        (userPermissionData || []).forEach((item: any) => {
          initialPermissions[key(item.module_code, item.action_code)] = item.allowed === true;
        });
      } else if (roleIds.length > 0) {
        const { data: rolePermissionData } = await supabase
          .from("role_permissions")
          .select("module_code, action_code, allowed")
          .in("role_id", roleIds);

        (rolePermissionData || []).forEach((item: any) => {
          if (item.allowed === true) {
            initialPermissions[key(item.module_code, item.action_code)] = true;
          }
        });
      }

      setProfile(profileData);
      setRoles((roleData || []).filter((role: any) => role.role_code !== "platform_owner"));
      setOrganizations(orgData || []);
      setCompanies(companyData || []);
      setSites(siteData || []);
      setModules(
        (moduleData || []).sort((a: any, b: any) => {
          if (a.module_group === b.module_group) {
            return Number(a.sort_order || 0) - Number(b.sort_order || 0);
          }
          return String(a.module_group).localeCompare(String(b.module_group));
        })
      );

      setSelectedRoleIds(roleIds);

      setSelectedOrganizationIds(
        Array.from(new Set((accessData || []).map((x: any) => x.organization_id).filter(Boolean)))
      );

      setSelectedCompanyIds(
        Array.from(new Set((accessData || []).map((x: any) => x.company_id).filter(Boolean)))
      );

      setSelectedSiteIds(
        Array.from(new Set((accessData || []).map((x: any) => x.site_id).filter(Boolean)))
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
      actions.forEach((action) => {
        next[key(moduleCode, action)] = allowed;
      });
      return next;
    });
  }

  function setGroup(groupName: string, allowed: boolean) {
    setPermissionMap((prev) => {
      const next = { ...prev };
      (groupedModules[groupName] || []).forEach((module) => {
        actions.forEach((action) => {
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
        actions.forEach((action) => {
          next[key(module.module_code, action)] = allowed;
        });
      });
      return next;
    });
  }

  function rowChecked(moduleCode: string) {
    return actions.every((action) => isAllowed(moduleCode, action));
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

      await supabase.from("user_roles").delete().eq("user_id", userId);

      const roleRows = selectedRoleIds.map((roleId) => ({
        user_id: userId,
        role_id: roleId,
      }));

      const { error: roleError } = await supabase.from("user_roles").insert(roleRows);
      if (roleError) throw roleError;

      await supabase.from("user_access_assignments").delete().eq("user_id", userId);

      const accessRows: any[] = [];

      selectedOrganizationIds.forEach((orgId) => {
        accessRows.push({
          user_id: userId,
          organization_id: orgId,
          company_id: null,
          site_id: null,
        });
      });

      selectedCompanyIds.forEach((companyId) => {
        const company = companies.find((item) => item.id === companyId);

        accessRows.push({
          user_id: userId,
          organization_id: company?.organization_id || null,
          company_id: companyId,
          site_id: null,
        });
      });

      selectedSiteIds.forEach((siteId) => {
        const site = sites.find((item) => item.id === siteId);
        const company = companies.find((item) => item.id === site?.company_id);

        accessRows.push({
          user_id: userId,
          organization_id: company?.organization_id || null,
          company_id: company?.id || null,
          site_id: siteId,
        });
      });

      const uniqueAccessRows = Array.from(
        new Map(
          accessRows.map((row) => [
            `${row.organization_id || ""}.${row.company_id || ""}.${row.site_id || ""}`,
            row,
          ])
        ).values()
      );

      if (uniqueAccessRows.length > 0) {
        const { error: accessError } = await supabase
          .from("user_access_assignments")
          .insert(uniqueAccessRows);

        if (accessError) throw accessError;
      }

      await supabase.from("user_permissions").delete().eq("user_id", userId);

      const permissionRows: any[] = [];

      modules.forEach((module) => {
  actions.forEach((action) => {
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

      if (permissionRows.length > 0) {
        const { error: permissionError } = await supabase
          .from("user_permissions")
          .insert(permissionRows);

        if (permissionError) throw permissionError;
      }

      await loadData();
      setPermissionsSaved(true);
      setMessage(
  `User access saved successfully. ${permissionRows.length} permissions updated.`
);
    } catch (error: any) {
      setMessage(error.message || "Failed to save user access.");
    } finally {
      setSaving(false);
    }
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

      {message && (
        <div className="rounded-lg border bg-yellow-50 p-3 text-sm text-yellow-800">
          {message}
        </div>
      )}
{!permissionsSaved && (
  <div className="rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-800">
    This user has no saved user permissions yet. The checked permissions below are copied from the selected role defaults. Click Save User Access to apply them to this user.
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
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">User Permissions</h2>
            <p className="text-sm text-gray-500">
              Checked means this user has permission. Unchecked means no permission.
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
                  {items.map((module: any) => (
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
                          <input
                            type="checkbox"
                            checked={isAllowed(module.module_code, action)}
                            onChange={(e) =>
                              setPermission(module.module_code, action, e.target.checked)
                            }
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
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