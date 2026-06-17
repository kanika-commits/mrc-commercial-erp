"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Building2, ChevronRight, Eye, Pencil, Plus, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { can, getCurrentUserAccess } from "@/lib/accessControl";

type Site = {
  id: string;
  organization_id: string;
  site_name: string;
  site_code: string;
  location: string | null;
  state: string | null;
  status: string | null;
  created_at: string;
};

function statusLabel(status: string | null) {
  return status?.trim() || "active";
}

function statusBadgeClass(status: string | null) {
  const normalized = statusLabel(status).toLowerCase();

  if (normalized === "active") {
    return "border-green-200 bg-green-100 text-green-800";
  }

  if (normalized === "inactive") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  if (normalized === "under construction" || normalized === "pending") {
    return "border-amber-200 bg-amber-100 text-amber-800";
  }

  return "border-slate-200 bg-slate-100 text-slate-700";
}

function getInitials(siteName: string) {
  const parts = siteName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "ST";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function formatSiteDisplayName(siteName: string, location: string | null) {
  const cleanSiteName = siteName.trim();
  const cleanLocation = location?.trim();

  if (!cleanLocation) return cleanSiteName;
  if (cleanSiteName.toLowerCase().includes(cleanLocation.toLowerCase())) {
    return cleanSiteName;
  }

  return `${cleanSiteName}, ${cleanLocation}`;
}

export default function SitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [canEditSites, setCanEditSites] = useState(false);

  useEffect(() => {
    loadSites();
  }, []);

  async function loadSites() {
    setLoading(true);
    setMessage("");

    const access = await getCurrentUserAccess();
    setCanEditSites(can(access.permissions, "sites", "edit"));

    const { data, error } = await supabase
      .from("sites")
      .select(
        `
        id,
        organization_id,
        site_name,
        site_code,
        location,
        state,
        status,
        created_at
      `,
      )
      .order("site_name", { ascending: true });

    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    setSites((data || []) as Site[]);
    setLoading(false);
  }

  const filteredSites = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return sites.filter((site) => {
      const searchable = [
        site.site_name,
        site.site_code,
        site.location || "",
        site.state || "",
      ]
        .join(" ")
        .toLowerCase();

      return !normalizedSearch || searchable.includes(normalizedSearch);
    });
  }, [searchTerm, sites]);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <nav className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>Resources</span>
          <ChevronRight className="h-3.5 w-3.5" />
          <span>Master Setup</span>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="text-[#00658b]">Sites</span>
        </nav>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">
              Site Management
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Centralized hub for monitoring all project sites.
            </p>
          </div>

          <Link
            href="/sites/new"
            className="inline-flex items-center justify-center gap-2 rounded bg-[#00658b] px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#005174]"
          >
            <Plus className="h-4 w-4" />
            Add Site
          </Link>
        </div>
      </section>

      {message && (
        <div className="rounded border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          {message}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end">
          <label className="min-w-[260px] flex-1 space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Search by Site Name, Site Code, Location, State
            </span>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search sites..."
                className="w-full rounded border border-slate-300 bg-[#f6f3f5] py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-[#00658b] focus:ring-1 focus:ring-[#00658b]"
              />
            </div>
          </label>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-200 bg-[#f8fafc] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Sites Directory</h2>
            <p className="text-sm text-slate-500">
              {loading
                ? "Loading sites..."
                : `Showing ${filteredSites.length} of ${sites.length} sites`}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left text-sm">
            <thead className="bg-[#f1f5f9]">
              <tr className="border-b border-slate-200">
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Site
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Site Code
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  State
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Status
                </th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Actions
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td className="px-5 py-8 text-center text-slate-500" colSpan={5}>
                    Loading sites...
                  </td>
                </tr>
              ) : filteredSites.length === 0 ? (
                <tr>
                  <td className="px-5 py-10 text-center" colSpan={5}>
                    <div className="mx-auto max-w-sm">
                      <Building2 className="mx-auto h-10 w-10 text-slate-300" />
                      <h3 className="mt-3 text-base font-semibold text-slate-950">
                        No sites found
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Adjust filters or add a site to begin building the site registry.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredSites.map((site) => (
                  <tr key={site.id} className="transition hover:bg-[#f8fafc]">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-slate-950 text-xs font-bold text-white">
                          {getInitials(site.site_name)}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-950">
                            {formatSiteDisplayName(site.site_name, site.location)}
                          </div>
                          <div className="text-xs text-slate-500">
                            Site registry record
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 font-mono text-xs font-semibold text-slate-700">
                      {site.site_code || "-"}
                    </td>
                    <td className="px-5 py-4 text-slate-700">{site.state || "-"}</td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusBadgeClass(
                          site.status,
                        )}`}
                      >
                        {statusLabel(site.status)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/sites/${site.id}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded text-slate-500 transition hover:bg-slate-100 hover:text-[#00658b]"
                          title="View site"
                        >
                          <Eye className="h-4 w-4" />
                        </Link>
                        {canEditSites && (
                          <Link
                            href={`/sites/${site.id}/edit`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded text-slate-500 transition hover:bg-slate-100 hover:text-[#00658b]"
                            title="Edit site"
                          >
                            <Pencil className="h-4 w-4" />
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
