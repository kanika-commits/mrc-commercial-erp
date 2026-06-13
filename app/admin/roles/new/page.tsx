"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function NewRolePage() {
  const router = useRouter();

  const [roleName, setRoleName] = useState("");
  const [roleCode, setRoleCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  function generateCode(value: string) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    if (!roleName.trim()) {
      setMessage("Role Name is required.");
      return;
    }

    try {
      setSaving(true);

      const finalRoleCode =
        roleCode.trim() || generateCode(roleName);

      const { error } = await supabase
        .from("roles")
        .insert({
          role_name: roleName.trim(),
          role_code: finalRoleCode,
          status: "active",
          is_system_role: false,
        });

      if (error) throw error;

      router.push("/admin/roles");
    } catch (error: any) {
      setMessage(error.message || "Failed to create role.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">
            Create Role
          </h1>

          <p className="text-gray-500">
            Create a new ERP role.
          </p>
        </div>

        <Link
          href="/admin/roles"
          className="rounded-lg border px-4 py-2"
        >
          Back
        </Link>
      </div>

      {message && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {message}
        </div>
      )}

      <section className="rounded-lg border bg-white p-6">
        <div className="grid gap-4 md:grid-cols-2">

          <div>
            <label className="mb-1 block text-sm font-medium">
              Role Name *
            </label>

            <input
              value={roleName}
              onChange={(e) => {
                setRoleName(e.target.value);
                setRoleCode(generateCode(e.target.value));
              }}
              className="w-full rounded-lg border px-3 py-2"
              placeholder="Site Engineer"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Role Code
            </label>

            <input
              value={roleCode}
              onChange={(e) => setRoleCode(e.target.value)}
              className="w-full rounded-lg border px-3 py-2"
              placeholder="site_engineer"
            />
          </div>

        </div>
      </section>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-60"
        >
          {saving ? "Saving..." : "Create Role"}
        </button>
      </div>
    </form>
  );
}