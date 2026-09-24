"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, SlidersHorizontal, UserRoundMinus, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { sortCompanies } from "@/lib/companyOrdering";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import AlertMessage from "@/components/AlertMessage";
import { recordClientAuditEvent } from "@/lib/clientAudit";

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
  const [messageType, setMessageType] = useState<"success" | "error">("error");
  const [removeUser, setRemoveUser] = useState<any | null>(null);
  const [removing, setRemoving] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [siteFilter, setSiteFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name-asc");
  const canDeleteUsers = can(access?.permissions || [], "users", "delete");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData(options: { preserveMessage?: boolean } = {}) {
    if (!options.preserveMessage) {
      setMessage("");
      setMessageType("error");
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setMessage("Your session expired. Please log in again.");
      setMessageType("error");
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
      setMessageType("error");
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

  function getUserRoleNames(userId: string) {
    const roleIds = userRoles
      .filter((item) => item.user_id === userId)
      .map((item) => item.role_id);

    return roles
      .filter((role) => roleIds.includes(role.id))
      .map((role) => role.role_name);
  }

  function getAccessSummary(userId: string, type: "organization" | "company" | "site", globalAccess: boolean) {
    const rows = accessRows.filter((item) => item.user_id === userId);

    const wildcard = globalAccess && (type === "company" || type === "site");
    if (wildcard) return { label: type === "company" ? "All Companies" : type === "site" ? "All Sites" : "All Organizations", values: [] as string[], all: true };

    if (type === "organization") {
      const ids = Array.from(new Set(rows.map((r) => r.organization_id).filter(Boolean)));
      return { label: organizations
        .filter((item) => ids.includes(item.id))
        .map((item) => item.name)
        .join(", "), values: ids, all: false };
    }

    if (type === "company") {
      const ids = Array.from(new Set(rows.map((r) => r.company_id).filter(Boolean)));
      const values = companies
        .filter((item) => ids.includes(item.id))
        .map((item) => item.company_code || item.company_name);
      return { label: values.join(", "), values: ids, all: false };
    }

    const ids = Array.from(new Set(rows.map((r) => r.site_id).filter(Boolean)));
    const values = sites
      .filter((item) => ids.includes(item.id))
      .map((item) => item.site_code || item.site_name);
    return { label: values.join(", "), values: ids, all: false };
  }

  const userRows = useMemo(() => profiles.map((profile) => {
    const roleNames = getUserRoleNames(profile.id);
    const globalAccess = userRoles
      .filter((item) => item.user_id === profile.id)
      .map((item) => roles.find((role) => role.id === item.role_id)?.role_code)
      .includes("platform_owner");
    return {
      profile,
      roleNames,
      organization: getAccessSummary(profile.id, "organization", globalAccess),
      company: getAccessSummary(profile.id, "company", globalAccess),
      site: getAccessSummary(profile.id, "site", globalAccess),
      status: String(profile.status || "active").toLowerCase(),
    };
  }), [profiles, roles, userRoles, accessRows, organizations, companies, sites]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = userRows.filter((row) => {
      const profile = row.profile;
      const searchable = `${profile.full_name || ""} ${profile.email || ""} ${row.roleNames.join(" ")}`.toLowerCase();
      return (!query || searchable.includes(query))
        && (roleFilter === "all" || row.roleNames.includes(roleFilter))
        && (statusFilter === "all" || row.status === statusFilter)
        && (companyFilter === "all" || row.company.all || row.company.values.includes(companyFilter))
        && (siteFilter === "all" || row.site.all || row.site.values.includes(siteFilter));
    });
    return rows.sort((left, right) => {
      if (sortBy === "created-newest" || sortBy === "created-oldest") {
        const direction = sortBy === "created-newest" ? -1 : 1;
        return (new Date(left.profile.created_at || 0).getTime() - new Date(right.profile.created_at || 0).getTime()) * direction;
      }
      const comparison = String(left.profile.full_name || left.profile.email || "").localeCompare(String(right.profile.full_name || right.profile.email || ""), undefined, { sensitivity: "base" });
      return sortBy === "name-desc" ? -comparison : comparison;
    });
  }, [userRows, search, roleFilter, statusFilter, companyFilter, siteFilter, sortBy]);

  const hasFilters = Boolean(search || roleFilter !== "all" || statusFilter !== "all" || companyFilter !== "all" || siteFilter !== "all" || sortBy !== "name-asc");
  const clearFilters = () => { setSearch(""); setRoleFilter("all"); setStatusFilter("all"); setCompanyFilter("all"); setSiteFilter("all"); setSortBy("name-asc"); };
  const selectedCompany = companies.find((company) => company.id === companyFilter);
  const selectedSite = sites.find((site) => site.id === siteFilter);

  async function confirmRemoveUser() {
    if (!removeUser) return;

    try {
      setRemoving(true);
      setMessage("");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const response = await fetch(`/api/admin/users/${removeUser.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await response.json();

      if (!response.ok) {
        const details = Array.isArray(result.responsibilities) ? ` ${result.responsibilities.join("; ")}.` : "";
        throw new Error((result.error || "Failed to remove user.") + details);
      }

      const removedUserId = removeUser.id;
      setProfiles((prev) => prev.map((profile) => profile.id === removedUserId ? { ...profile, status: "inactive" } : profile));
      setUserRoles((prev) => prev.filter((row) => row.user_id !== removedUserId));
      setAccessRows((prev) => prev.filter((row) => row.user_id !== removedUserId));
      setRemoveUser(null);
      setMessage("User removed from SiteQube. Their profile and historical records were retained.");
      setMessageType("success");
      await loadData({ preserveMessage: true });
    } catch (error: any) {
      setMessage(error.message || "Failed to remove user.");
      setMessageType("error");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">Admin Users</h1>
          <p className="mt-1 text-sm text-slate-500">Manage users, roles and access across the organization.</p>
        </div>
        <Link href="/admin/users/new" className="tenant-primary-bg inline-flex h-10 items-center rounded-lg px-4 text-sm font-semibold shadow-sm">
          + Add User
        </Link>
      </div>

      <AlertMessage
        type={messageType}
        message={message}
        onClose={() => { setMessage(""); setMessageType("error"); }}
      />

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search users by name or email..." className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-4 text-sm outline-none focus:border-[var(--tenant-primary)] focus:ring-4 focus:ring-[var(--tenant-focus)]" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SlidersHorizontal className="mr-1 h-4 w-4 text-slate-400" />
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="all">All Roles</option>{roles.map((role) => <option key={role.id} value={role.role_name}>{role.role_name}</option>)}</select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="all">All Status</option>{Array.from(new Set(profiles.map((profile) => String(profile.status || "active").toLowerCase()))).map((status) => <option key={status} value={status}>{status.charAt(0).toUpperCase() + status.slice(1)}</option>)}</select>
          <select value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)} className="h-9 max-w-[190px] rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="all">All Companies</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.company_code || company.company_name}</option>)}</select>
          <select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)} className="h-9 max-w-[190px] rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="all">All Sites</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.site_code || site.site_name}</option>)}</select>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="name-asc">Name A–Z</option><option value="name-desc">Name Z–A</option><option value="created-newest">Newest Created</option><option value="created-oldest">Oldest Created</option></select>
          {hasFilters && <button type="button" onClick={clearFilters} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"><X className="h-4 w-4" />Clear Filters</button>}
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500"><span>{filteredRows.length === profiles.length ? `${profiles.length} users` : `Showing ${filteredRows.length} of ${profiles.length} users`}</span><span>{selectedCompany?.company_name || selectedSite?.site_name ? "Scoped access filter" : ""}</span></div>
      </div>

      <div className="space-y-3 md:hidden">
        {filteredRows.map(({ profile, roleNames, organization, company, site, status }) => (
          <article key={profile.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><h2 className="truncate font-semibold text-slate-900">{profile.full_name || "-"}</h2><p className="truncate text-xs text-slate-500">{profile.email || "-"}</p></div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${status === "active" ? "bg-emerald-50 text-emerald-700" : status === "suspended" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{status.charAt(0).toUpperCase() + status.slice(1)}</span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div><dt className="text-xs font-medium text-slate-500">Role</dt><dd className="mt-0.5 truncate font-medium text-slate-800">{roleNames[0] || "-"}{roleNames.length > 1 && <span className="ml-1 text-xs text-slate-500">+{roleNames.length - 1} more</span>}</dd></div>
              <div><dt className="text-xs font-medium text-slate-500">Organization</dt><dd className="mt-0.5 truncate text-slate-700">{organization.label || "-"}</dd></div>
              <div><dt className="text-xs font-medium text-slate-500">Company Access</dt><dd className="mt-0.5 truncate text-slate-700"><AccessSummary value={company.label || "-"} all={company.all} values={company.label ? company.label.split(", ") : []} /></dd></div>
              <div><dt className="text-xs font-medium text-slate-500">Site Access</dt><dd className="mt-0.5 truncate text-slate-700"><AccessSummary value={site.label || "-"} all={site.all} values={site.label ? site.label.split(", ") : []} /></dd></div>
            </dl>
            <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3"><Link href={`/admin/users/${profile.id}`} onClick={() => recordClientAuditEvent({ eventType: "view_record", entityType: "user", recordId: profile.id, source: "users_register" })} className="inline-flex min-h-10 flex-1 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700">Edit Access</Link>{canDeleteUsers && <button type="button" onClick={() => setRemoveUser(profile)} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold text-red-700"><UserRoundMinus className="h-3.5 w-3.5" />Remove User</button>}</div>
          </article>
        ))}
        {filteredRows.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-14 text-center text-sm text-slate-500"><p className="font-semibold text-slate-700">{profiles.length === 0 ? "No users found." : "No users match your search or filters."}</p>{profiles.length > 0 && <button type="button" onClick={clearFilters} className="tenant-primary-text mt-2 font-semibold">Clear Filters</button>}</div>}
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
        <table className="w-full min-w-[1060px] text-sm">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left">User</th><th className="px-4 py-3 text-left">Role</th><th className="px-4 py-3 text-left">Organization</th><th className="px-4 py-3 text-left">Company Access</th><th className="px-4 py-3 text-left">Site Access</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>

          <tbody>
            {filteredRows.map(({ profile, roleNames, organization, company, site, status }) => (
              <tr key={profile.id} className="border-t border-slate-100 align-middle hover:bg-slate-50/70">
                <td className="px-4 py-3"><div className="font-semibold text-slate-900">{profile.full_name || "-"}</div><div className="text-xs text-slate-500">{profile.email || "-"}</div></td>
                <td className="px-4 py-3"><span className="font-medium text-slate-700">{roleNames[0] || "-"}</span>{roleNames.length > 1 && <span className="ml-1 text-xs text-slate-500">+{roleNames.length - 1} more</span>}</td>
                <td className="px-4 py-3 text-slate-600">{organization.label || "-"}</td>
                <td className="max-w-[210px] px-4 py-3"><AccessSummary value={company.label || "-"} all={company.all} values={company.label ? company.label.split(", ") : []} /></td>
                <td className="max-w-[210px] px-4 py-3"><AccessSummary value={site.label || "-"} all={site.all} values={site.label ? site.label.split(", ") : []} /></td>
                <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${status === "active" ? "bg-emerald-50 text-emerald-700" : status === "suspended" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{status.charAt(0).toUpperCase() + status.slice(1)}</span></td>
                <td className="px-4 py-3"><div className="flex items-center justify-end gap-2 whitespace-nowrap"><Link href={`/admin/users/${profile.id}`} onClick={() => recordClientAuditEvent({ eventType: "view_record", entityType: "user", recordId: profile.id, source: "users_register" })} className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tenant-focus)]">Edit Access</Link>{canDeleteUsers && <button type="button" onClick={() => setRemoveUser(profile)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"><UserRoundMinus className="h-3.5 w-3.5" />Remove User</button>}</div></td>
              </tr>
            ))}

            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-14 text-center text-slate-500">
                  <p className="font-semibold text-slate-700">{profiles.length === 0 ? "No users found." : "No users match your search or filters."}</p>
                  {profiles.length > 0 && <button type="button" onClick={clearFilters} className="tenant-primary-text mt-2 text-sm font-semibold">Clear Filters</button>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {removeUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-bold text-slate-950">Remove User</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Remove SiteQube access for{" "}
              <span className="font-semibold text-slate-950">
                {removeUser.full_name || removeUser.email || "-"}
              </span>
              ? They will no longer be able to access SiteQube or appear in active user lists. Their profile and historical records will be retained.
            </p>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setRemoveUser(null)}
                disabled={removing}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmRemoveUser}
                disabled={removing}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {removing ? "Removing..." : "Remove User"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AccessSummary({ value, all, values }: { value: string; all: boolean; values: string[] }) {
  const visible = values.slice(0, 2);
  const remaining = Math.max(values.length - visible.length, 0);
  return (
    <div title={all ? value : values.join(", ")} className="truncate text-slate-600">
      {all ? <span className="font-semibold text-slate-700">{value}</span> : <>{visible.join(", ") || "-"}{remaining > 0 && <span className="ml-1 text-xs text-slate-500">+{remaining} more</span>}</>}
    </div>
  );
}
