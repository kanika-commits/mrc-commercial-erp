"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function NewCompanyPage() {
  const router = useRouter();

  const [companyName, setCompanyName] = useState("");
  const [companyCode, setCompanyCode] = useState("");
  const [status, setStatus] = useState("active");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function saveCompany() {
    setMessage("");

    if (!companyName.trim()) {
      setMessage("Company name is required.");
      return;
    }

    if (!companyCode.trim()) {
      setMessage("Company code is required.");
      return;
    }

    try {
      setSaving(true);

      const organizationId = "7208169c-4e3f-4d6b-b068-31931a39120f";

      const { error } = await supabase.from("companies").insert({
        organization_id: organizationId,
        company_name: companyName.trim(),
        company_code: companyCode.trim(),
        status,
      });

      if (error) throw error;

      router.push("/companies");
    } catch (error: any) {
      setMessage(error.message || "Failed to save company.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Add Company</h1>
          <p className="text-gray-500">Create a company for work orders and sites.</p>
        </div>

        <Link href="/companies" className="rounded-lg border px-4 py-2">
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
          <label className="mb-1 block text-sm font-medium">Company Name *</label>
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="w-full rounded border px-3 py-2"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Company Code *</label>
          <input
            value={companyCode}
            onChange={(e) => setCompanyCode(e.target.value.toUpperCase())}
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
          onClick={saveCompany}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Company"}
        </button>
      </div>
    </div>
  );
}