"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import AlertMessage from "@/components/AlertMessage";
import EmployeeForm from "@/components/hr/EmployeeForm";
import HrSectionNav from "@/components/hr/HrSectionNav";
import { apiFetch, getAccessToken } from "@/components/hr/hrClient";
import { useHrLookups } from "@/components/hr/useHrLookups";

export default function NewEmployeePage() {
  const router = useRouter();
  const lookups = useHrLookups();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);

  async function uploadPhoto(employeeId: string, file: File) {
    const token = await getAccessToken();
    const form = new FormData();
    form.set("photo", file);
    const response = await fetch(`/api/hr/employees/${employeeId}/photo`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Failed to upload employee photo.");
  }

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
      if (selectedPhoto) {
        await uploadPhoto(result.employee_id, selectedPhoto);
      }
      router.push(`/hr/employees/${result.employee_id}`);
    } catch (error: any) {
      setMessage(error.message || "Failed to create employee.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-6">
      <HrSectionNav />
      <AlertMessage type="error" message={message || lookups.error} onClose={() => setMessage("")} />
      {lookups.loading && (
        <div className="rounded-2xl border bg-white p-4 text-sm text-slate-500 shadow-sm">
          Loading dropdown options...
        </div>
      )}
      <EmployeeForm
        mode="create"
        companies={lookups.companies}
        sites={lookups.sites}
        departments={lookups.departments}
        designations={lookups.designations}
        managers={lookups.employees}
        saving={saving || lookups.loading}
        onSubmit={save}
        selectedPhoto={selectedPhoto}
        onPhotoChange={setSelectedPhoto}
      />
    </section>
  );
}
