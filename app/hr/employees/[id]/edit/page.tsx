"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AlertMessage from "@/components/AlertMessage";
import EmployeeForm from "@/components/hr/EmployeeForm";
import HrSectionNav from "@/components/hr/HrSectionNav";
import { apiFetch, getAccessToken } from "@/components/hr/hrClient";
import { useHrLookups } from "@/components/hr/useHrLookups";
import type { HrEmployee, HrEmployeeUserOption } from "@/types/hr";

export default function EditEmployeePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const lookups = useHrLookups();
  const [employee, setEmployee] = useState<HrEmployee | null>(null);
  const [erpUsers, setErpUsers] = useState<HrEmployeeUserOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [removingPhoto, setRemovingPhoto] = useState(false);
  const [message, setMessage] = useState("");

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

  async function removePhoto() {
    setMessage("");
    setRemovingPhoto(true);
    try {
      await apiFetch(`/api/hr/employees/${params.id}/photo`, { method: "DELETE" });
      setEmployee((prev) => prev ? { ...prev, photo_storage_path: null, photo_signed_url: null } : prev);
    } catch (error: any) {
      setMessage(error.message || "Failed to remove employee photo.");
    } finally {
      setRemovingPhoto(false);
    }
  }

  useEffect(() => {
    async function load() {
      try {
        const [result, usersResult] = await Promise.all([
          apiFetch(`/api/hr/employees/${params.id}`),
          apiFetch(`/api/hr/employees/users?employee_id=${params.id}`),
        ]);
        setEmployee(result.employee);
        setErpUsers(usersResult.users || []);
      } catch (error: any) {
        setMessage(error.message || "Failed to load employee.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.id]);

  async function save(values: any) {
    setMessage("");
    setSaving(true);
    try {
      await apiFetch(`/api/hr/employees/${params.id}`, {
        method: "PUT",
        body: JSON.stringify({
          ...values,
          site_id: values.site_id || null,
          department_id: values.department_id || null,
          designation_id: values.designation_id || null,
          reporting_manager_id: values.reporting_manager_id || null,
          user_id: values.user_id || null,
        }),
      });
      if (selectedPhoto) {
        await uploadPhoto(params.id, selectedPhoto);
      }
      router.push(`/hr/employees/${params.id}`);
    } catch (error: any) {
      setMessage(error.message || "Failed to update employee.");
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
      {loading ? (
        <div className="rounded-2xl border bg-white p-8 text-sm text-slate-500 shadow-sm">Loading form...</div>
      ) : (
        <EmployeeForm
          mode="edit"
          initialEmployee={employee}
          companies={lookups.companies}
          sites={lookups.sites}
          departments={lookups.departments}
          designations={lookups.designations}
          managers={lookups.employees}
          erpUsers={erpUsers}
          saving={saving || lookups.loading}
          onSubmit={save}
          selectedPhoto={selectedPhoto}
          onPhotoChange={setSelectedPhoto}
          onRemovePhoto={removePhoto}
          removingPhoto={removingPhoto}
          cancelHref={`/hr/employees/${params.id}`}
        />
      )}
    </section>
  );
}
