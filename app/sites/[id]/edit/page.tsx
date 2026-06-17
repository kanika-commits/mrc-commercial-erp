"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Save } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { can, getCurrentUserAccess } from "@/lib/accessControl";

type Site = {
  id: string;
  site_name: string;
  site_code: string;
  location: string | null;
  state: string | null;
  status: string | null;
};

export default function EditSitePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const siteId = params.id;

  const [siteName, setSiteName] = useState("");
  const [siteCode, setSiteCode] = useState("");
  const [location, setLocation] = useState("");
  const [state, setState] = useState("");
  const [status, setStatus] = useState("active");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);

  useEffect(() => {
    async function loadSite() {
      setLoading(true);
      setMessage("");
      setAccessDenied(false);

      const access = await getCurrentUserAccess();

      if (!can(access.permissions, "sites", "edit")) {
        setAccessDenied(true);
        setMessage("You do not have permission to edit sites.");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("sites")
        .select("id, site_name, site_code, location, state, status")
        .eq("id", siteId)
        .single();

      if (error) {
        setMessage(error.message);
        setLoading(false);
        return;
      }

      const site = data as Site;
      setSiteName(site.site_name || "");
      setSiteCode(site.site_code || "");
      setLocation(site.location || "");
      setState(site.state || "");
      setStatus(site.status || "active");
      setLoading(false);
    }

    if (siteId) {
      loadSite();
    }
  }, [siteId]);

  async function saveSite() {
    setMessage("");

    if (!siteName.trim()) {
      setMessage("Site name is required.");
      return;
    }

    if (!siteCode.trim()) {
      setMessage("Site code is required.");
      return;
    }

    try {
      setSaving(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const response = await fetch(`/api/sites/${siteId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          site_name: siteName.trim(),
          site_code: siteCode.trim(),
          location: location.trim() || null,
          state: state.trim() || null,
          status,
        }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to update site.");
      }

      router.push(`/sites/${siteId}`);
    } catch (error: any) {
      setMessage(error.message || "Failed to update site.");
    } finally {
      setSaving(false);
    }
  }

  if (accessDenied) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        <h1 className="text-lg font-semibold">Access Denied</h1>
        <p className="mt-1 text-sm">You do not have permission to edit sites.</p>
        <Link
          href={`/sites/${siteId}`}
          className="mt-4 inline-flex rounded border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
        >
          Back to Site
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <nav className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Link href="/sites" className="hover:text-slate-950">
              Sites
            </Link>
            <span>/</span>
            <Link href={`/sites/${siteId}`} className="hover:text-slate-950">
              Detail
            </Link>
            <span>/</span>
            <span className="text-[#00658b]">Edit</span>
          </nav>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">
            Edit Site
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Update independent site master fields. Company is selected on Work Orders.
          </p>
        </div>

        <Link
          href={`/sites/${siteId}`}
          className="inline-flex items-center gap-2 rounded border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Site
        </Link>
      </div>

      {message && (
        <div className="rounded border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          {message}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-[#f8fafc] px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-950">Site Master</h2>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-slate-500">Loading site...</div>
        ) : (
          <div className="grid grid-cols-1 gap-5 p-6 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-600">Site Name *</span>
              <input
                value={siteName}
                onChange={(event) => setSiteName(event.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[#00658b] focus:ring-1 focus:ring-[#00658b]"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-600">Site Code *</span>
              <input
                value={siteCode}
                onChange={(event) => setSiteCode(event.target.value.toUpperCase())}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold uppercase outline-none transition focus:border-[#00658b] focus:ring-1 focus:ring-[#00658b]"
              />
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="text-sm font-medium text-slate-600">Location</span>
              <input
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[#00658b] focus:ring-1 focus:ring-[#00658b]"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-600">State</span>
              <input
                value={state}
                onChange={(event) => setState(event.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[#00658b] focus:ring-1 focus:ring-[#00658b]"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-600">Status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[#00658b] focus:ring-1 focus:ring-[#00658b]"
              >
                <option value="active">active</option>
                <option value="inactive">inactive</option>
                <option value="under construction">under construction</option>
                <option value="pending">pending</option>
              </select>
            </label>
          </div>
        )}
      </section>

      <div className="flex justify-end gap-3">
        <Link
          href={`/sites/${siteId}`}
          className="rounded border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          Cancel
        </Link>
        <button
          type="button"
          onClick={saveSite}
          disabled={loading || saving}
          className="inline-flex items-center gap-2 rounded bg-[#00658b] px-6 py-2.5 text-sm font-bold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
