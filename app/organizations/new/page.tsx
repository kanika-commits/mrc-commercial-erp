"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function NewOrganizationPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [form, setForm] = useState({
    organization_name: "",
    organization_code: "",
    company_name: "",
    company_code: "",
    admin_name: "",
    admin_email: "",
    admin_password: "",
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    try {
      setSaving(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const response = await fetch("/api/admin/create-organization", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(form),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to create organization.");
      }

      router.push(`/organizations/${result.organization_id}`);
    } catch (error: any) {
      setMessage(error.message || "Failed to create organization.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "w-full rounded-lg border px-3 py-2";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">New Organization</h1>
          <p className="text-gray-500">
            Create organization, first company and super admin in one step.
          </p>
        </div>

        <Link href="/organizations" className="rounded-lg border px-4 py-2">
          Back
        </Link>
      </div>

      {message && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {message}
        </div>
      )}

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Organization</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">
              Organization Name *
            </label>
            <input
              name="organization_name"
              value={form.organization_name}
              onChange={handleChange}
              className={inputClass}
              placeholder="ABC Group"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Organization Code *
            </label>
            <input
              name="organization_code"
              value={form.organization_code}
              onChange={handleChange}
              className={inputClass}
              placeholder="ABC"
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">First Company</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">
              Company Name *
            </label>
            <input
              name="company_name"
              value={form.company_name}
              onChange={handleChange}
              className={inputClass}
              placeholder="ABC Construction Pvt. Ltd."
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Company Code *
            </label>
            <input
              name="company_code"
              value={form.company_code}
              onChange={handleChange}
              className={inputClass}
              placeholder="ABCCON"
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Super Admin</h2>

        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Name *</label>
            <input
              name="admin_name"
              value={form.admin_name}
              onChange={handleChange}
              className={inputClass}
              placeholder="Amit Sharma"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Email *</label>
            <input
              name="admin_email"
              type="email"
              value={form.admin_email}
              onChange={handleChange}
              className={inputClass}
              placeholder="amit@abc.com"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Temporary Password *
            </label>
            <input
              name="admin_password"
              type="password"
              value={form.admin_password}
              onChange={handleChange}
              className={inputClass}
              placeholder="Minimum 6 characters"
            />
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-5 py-2 text-white disabled:opacity-60"
        >
          {saving ? "Creating..." : "Create Organization"}
        </button>
      </div>
    </form>
  );
}
