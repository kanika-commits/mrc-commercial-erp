"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { sortCompanies } from "@/lib/companyOrdering";
import { supabase } from "@/lib/supabase";

export default function NewUserPage() {
  const router = useRouter();

  const [roles, setRoles] = useState<any[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [sites, setSites] = useState<any[]>([]);

  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [selectedOrganizationIds, setSelectedOrganizationIds] = useState<string[]>([]);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
  });

  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setMessage("Your session expired. Please log in again.");
      return;
    }

    const response = await fetch("/api/admin/access-options", {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    const result = await response.json();

    if (!response.ok) {
      setMessage(result.error || "Failed to load access options.");
      return;
    }

    setRoles((result.roles || []).filter((role: any) => role.role_code !== "platform_owner"));
    setOrganizations(result.organizations || []);
    setCompanies(sortCompanies(result.companies || []));
    setSites(result.sites || []);
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

  const unassignedSites = useMemo(() => {
    if (selectedCompanyIds.length === 0) return [];

    return sites.filter((site) => !site.company_id);
  }, [sites, selectedCompanyIds]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  }

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
      const next = exists
        ? prev.filter((id) => id !== orgId)
        : [...prev, orgId];

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
      const next = exists
        ? prev.filter((id) => id !== companyId)
        : [...prev, companyId];

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

  async function createUser(e: React.FormEvent) {
    e.preventDefault();

    try {
      setSaving(true);
      setMessage("");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const response = await fetch("/api/admin/create-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          full_name: form.full_name,
          email: form.email,
          password: form.password,
          role_ids: selectedRoleIds,
          organization_ids: selectedOrganizationIds,
          company_ids: selectedCompanyIds,
          site_ids: selectedSiteIds,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to create user.");
      }

      router.push(`/admin/users/${result.user_id}`);
    } catch (error: any) {
      setMessage(error.message || "Failed to create user.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "w-full rounded-lg border px-3 py-2";

  return (
    <form onSubmit={createUser} className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Add User</h1>
          <p className="text-gray-500">
            Create user and assign organization, companies, sites and roles.
          </p>
        </div>

        <Link href="/admin/users" className="rounded-lg border px-4 py-2">
          Back
        </Link>
      </div>

      {message && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {message}
        </div>
      )}

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">User Details</h2>

        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Name *</label>
            <input
              name="full_name"
              value={form.full_name}
              onChange={handleChange}
              className={inputClass}
              placeholder="Employee name"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Email *</label>
            <input
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              className={inputClass}
              placeholder="employee@company.com"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Temporary Password *
            </label>
            <input
              name="password"
              type="password"
              value={form.password}
              onChange={handleChange}
              className={inputClass}
              placeholder="Minimum 6 characters"
            />
          </div>
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

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-5 py-2 text-white disabled:opacity-60"
        >
          {saving ? "Creating..." : "Create User"}
        </button>
      </div>
    </form>
  );
}
