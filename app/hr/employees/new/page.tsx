"use client";

import Link from "next/link";
import { ArrowLeft, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AlertMessage from "@/components/AlertMessage";
import EmployeeForm from "@/components/hr/EmployeeForm";
import { apiFetch } from "@/components/hr/hrClient";
import { useHrLookups } from "@/components/hr/useHrLookups";

export default function NewEmployeePage() {
  const router = useRouter();
  const lookups = useHrLookups();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save(values: any) {
    setMessage("");
    setSaving(true);
    try {
      const result = await apiFetch("/api/hr/employees", {
        method: "POST",
        body: JSON.stringify({
          ...values,
          site_id: values.site_id || null,
          department_id: values.department_id || null,
          designation_id: values.designation_id || null,
          reporting_manager_id: values.reporting_manager_id || null,
        }),
      });
      router.push(`/hr/employees/${result.employee_id}`);
    } catch (error: any) {
      setMessage(error.message || "Failed to create employee.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-6">
      <Header title="New Employee" />
      <AlertMessage type="error" message={message || lookups.error} onClose={() => setMessage("")} />
      {lookups.loading ? (
        <div className="rounded-2xl border bg-white p-8 text-sm text-slate-500 shadow-sm">Loading form...</div>
      ) : (
        <EmployeeForm companies={lookups.companies} sites={lookups.sites} departments={lookups.departments} designations={lookups.designations} managers={lookups.employees} saving={saving} onSubmit={save} />
      )}
    </section>
  );
}

function Header({ title }: { title: string }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
          <UsersRound className="h-3.5 w-3.5" />
          HR
        </div>
        <h1 className="text-3xl font-bold text-slate-950">{title}</h1>
      </div>
      <Link href="/hr/employees" className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>
    </header>
  );
}
