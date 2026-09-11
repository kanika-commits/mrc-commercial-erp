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
  const [assignments, setAssignments] = useState<any[]>([]);
  const [assignmentForm, setAssignmentForm] = useState({ id: "", company_id: "", designation_id: "", status: "active" });
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const activeAssignmentCompanyIds = new Set(
    assignments.filter((assignment) => assignment.status === "active").map((assignment) => assignment.company_id),
  );
  const assignmentCompanyOptions = lookups.companies.filter(
    (company) => assignmentForm.id || !activeAssignmentCompanyIds.has(company.id),
  );

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
        const [result, usersResult, assignmentsResult] = await Promise.all([
          apiFetch(`/api/hr/employees/${params.id}`),
          apiFetch(`/api/hr/employees/users?employee_id=${params.id}`),
          apiFetch(`/api/hr/employees/${params.id}/assignments`),
        ]);
        setEmployee(result.employee);
        setErpUsers(usersResult.users || []);
        setAssignments(assignmentsResult.assignments || []);
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

  function editAssignment(assignment: any) {
    setAssignmentForm({ id: assignment.id, company_id: assignment.company_id, designation_id: assignment.designation_id, status: assignment.status });
    setAssignmentOpen(true);
  }

  async function saveAssignment() {
    try {
      const payload = { company_id: assignmentForm.company_id, designation_id: assignmentForm.designation_id, status: assignmentForm.status };
      await apiFetch(`/api/hr/employees/${params.id}/assignments`, { method: assignmentForm.id ? "PATCH" : "POST", body: JSON.stringify(assignmentForm.id ? { ...payload, assignment_id: assignmentForm.id } : payload) });
      const refreshed = await apiFetch(`/api/hr/employees/${params.id}/assignments`);
      setAssignments(refreshed.assignments || []); setAssignmentOpen(false); setAssignmentForm({ id: "", company_id: "", designation_id: "", status: "active" }); setMessage("Company assignment saved.");
    } catch (error: any) { setMessage(error.message || "Failed to save company assignment."); }
  }

  async function inactivateAssignment(assignment: any) {
    if (!window.confirm(`Inactivate the ${assignment.company?.company_name || "selected"} assignment?`)) return;
    try { await apiFetch(`/api/hr/employees/${params.id}/assignments`, { method: "PATCH", body: JSON.stringify({ assignment_id: assignment.id, status: "inactive" }) }); const refreshed = await apiFetch(`/api/hr/employees/${params.id}/assignments`); setAssignments(refreshed.assignments || []); setMessage("Company assignment updated."); } catch (error: any) { setMessage(error.message || "Failed to inactivate company assignment."); }
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
        <>
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
        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Company Assignments</h2><p className="mt-1 text-sm text-slate-500">The existing Company and Designation fields remain the employee&apos;s primary HR assignment. Use this list for additional company-specific assignments.</p></div><button type="button" onClick={() => { if (!assignmentCompanyOptions.length) { setMessage("All available companies already have active assignments for this employee."); return; } setAssignmentForm({ id: "", company_id: "", designation_id: "", status: "active" }); setAssignmentOpen(true); }} className="rounded-lg border px-3 py-2 text-sm font-semibold">+ Add Company Assignment</button></div>
          {assignmentOpen && <div className="mt-5 grid gap-3 rounded-xl border bg-slate-50 p-4 md:grid-cols-4"><select value={assignmentForm.company_id} onChange={(e) => setAssignmentForm((v) => ({ ...v, company_id: e.target.value }))} className="h-10 rounded-lg border bg-white px-3"><option value="">Company</option>{assignmentCompanyOptions.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select><select value={assignmentForm.designation_id} onChange={(e) => setAssignmentForm((v) => ({ ...v, designation_id: e.target.value }))} className="h-10 rounded-lg border bg-white px-3"><option value="">Designation</option>{lookups.designations.map((row) => <option key={row.id} value={row.id}>{row.designation_name}</option>)}</select><select value={assignmentForm.status} onChange={(e) => setAssignmentForm((v) => ({ ...v, status: e.target.value }))} className="h-10 rounded-lg border bg-white px-3"><option value="active">Active</option><option value="inactive">Inactive</option></select><div className="flex gap-2"><button type="button" onClick={saveAssignment} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">Save</button><button type="button" onClick={() => setAssignmentOpen(false)} className="rounded-lg border px-3 py-2 text-sm font-semibold">Cancel</button></div></div>}
          <div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-slate-500"><th className="p-2">Company</th><th className="p-2">Designation</th><th className="p-2">Status</th><th className="p-2">Actions</th></tr></thead><tbody>{assignments.map((assignment) => <tr key={assignment.id} className="border-b"><td className="p-2">{assignment.company?.company_name || "-"}</td><td className="p-2">{assignment.designation?.designation_name || "-"}</td><td className="p-2">{assignment.status}</td><td className="p-2"><div className="flex gap-3"><button type="button" onClick={() => editAssignment(assignment)} className="font-semibold">Edit</button>{assignment.status === "active" && <button type="button" onClick={() => inactivateAssignment(assignment)} className="font-semibold text-amber-700">Inactivate</button>}</div></td></tr>)}{!assignments.length && <tr><td colSpan={4} className="p-4 text-slate-500">No company assignments configured.</td></tr>}</tbody></table></div>
        </section>
        </>
      )}
    </section>
  );
}
