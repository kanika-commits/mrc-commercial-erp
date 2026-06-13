"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Company = {
  id: string;
  company_name: string;
  company_code: string;
};

export default function NewSitePage() {
  const router = useRouter();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [siteName, setSiteName] = useState("");
  const [siteCode, setSiteCode] = useState("");
  const [location, setLocation] = useState("");
  const [state, setState] = useState("");
  const [status, setStatus] = useState("active");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadCompanies();
  }, []);

  async function loadCompanies() {
    const { data, error } = await supabase
      .from("companies")
      .select("id, company_name, company_code")
      .eq("status", "active")
      .order("company_name");

    if (error) {
      setMessage(error.message);
      return;
    }

    setCompanies(data || []);
  }

  async function saveSite() {
    setMessage("");

    if (!companyId) {
      setMessage("Company is required.");
      return;
    }

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

      const organizationId = "7208169c-4e3f-4d6b-b068-31931a39120f";

      const { error } = await supabase.from("sites").insert({
        organization_id: organizationId,
        company_id: companyId,
        site_name: siteName.trim(),
        site_code: siteCode.trim(),
        location: location.trim() || null,
        state: state.trim() || null,
        status,
      });

      if (error) throw error;

      router.push("/sites");
    } catch (error: any) {
      setMessage(error.message || "Failed to save site.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Add Site</h1>
          <p className="text-gray-500">Create a site under a company.</p>
        </div>

        <Link href="/sites" className="rounded-lg border px-4 py-2">
          Back
        </Link>
      </div>

      {message && (
        <div className="rounded-lg border bg-yellow-50 p-3 text-sm text-yellow-800">
          {message}
        </div>
      )}

      <div className="space-y-4 rounded-lg border bg-white p-6">
        <div>
          <label className="mb-1 block text-sm font-medium">Company *</label>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="w-full rounded border px-3 py-2"
          >
            <option value="">Select Company</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.company_name} - {company.company_code}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Site Name *</label>
          <input
            value={siteName}
            onChange={(e) => setSiteName(e.target.value)}
            className="w-full rounded border px-3 py-2"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Site Code *</label>
          <input
            value={siteCode}
            onChange={(e) => setSiteCode(e.target.value.toUpperCase())}
            className="w-full rounded border px-3 py-2"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Location</label>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="w-full rounded border px-3 py-2"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">State</label>
          <input
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="w-full rounded border px-3 py-2"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full rounded border px-3 py-2"
          >
            <option value="active">active</option>
            <option value="inactive">inactive</option>
          </select>
        </div>

        <button
          type="button"
          onClick={saveSite}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Site"}
        </button>
      </div>
    </div>
  );
}