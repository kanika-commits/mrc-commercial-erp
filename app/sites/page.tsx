"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Site = {
  id: string;
  organization_id: string;
  company_id: string;
  site_name: string;
  site_code: string;
  location: string;
  state: string;
  status: string;
  created_at: string;
  companies?: {
    company_name: string;
    company_code: string;
  } | null;
};

export default function SitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadSites();
  }, []);

  async function loadSites() {
    setLoading(true);
    setMessage("");

    const { data, error } = await supabase
      .from("sites")
      .select(`
        id,
        organization_id,
        company_id,
        site_name,
        site_code,
        location,
        state,
        status,
        created_at,
        companies (
          company_name,
          company_code
        )
      `)
      .order("created_at", { ascending: false });

    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    setSites(((data || []) as unknown as Site[]));
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Sites</h1>
          <p className="text-gray-500">Manage construction sites by company.</p>
        </div>

        <Link href="/sites/new" className="rounded-lg bg-blue-600 px-4 py-2 text-white">
          Add Site
        </Link>
      </div>

      {message && (
        <div className="rounded-lg border bg-yellow-50 p-3 text-sm text-yellow-800">
          {message}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-3 text-left">Site Name</th>
              <th className="p-3 text-left">Site Code</th>
              <th className="p-3 text-left">Company</th>
              <th className="p-3 text-left">Location</th>
              <th className="p-3 text-left">State</th>
              <th className="p-3 text-left">Status</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td className="p-3" colSpan={6}>
                  Loading...
                </td>
              </tr>
            ) : sites.length === 0 ? (
              <tr>
                <td className="p-3" colSpan={6}>
                  No sites found.
                </td>
              </tr>
            ) : (
              sites.map((site) => (
                <tr key={site.id} className="border-t">
                  <td className="p-3 font-medium">{site.site_name}</td>
                  <td className="p-3">{site.site_code}</td>
                  <td className="p-3">
                    {site.companies?.company_name || "-"}
                  </td>
                  <td className="p-3">{site.location || "-"}</td>
                  <td className="p-3">{site.state || "-"}</td>
                  <td className="p-3">{site.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}