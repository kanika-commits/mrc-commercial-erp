"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, Pencil, Plus, Trash2 } from "lucide-react";
import AlertMessage from "@/components/AlertMessage";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import { apiFetch, labelize } from "@/components/hr/hrClient";
import type { HrDepartment } from "@/types/hr";

type FormState = {
  department_name: string;
  department_code: string;
  status: string;
};

const emptyForm: FormState = {
  department_name: "",
  department_code: "",
  status: "active",
};

export default function DepartmentsPage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const canAdd = can(permissions, "hr_employees", "add");
  const canEdit = can(permissions, "hr_employees", "edit");
  const canDelete = can(permissions, "hr_employees", "delete");
  const [departments, setDepartments] = useState<HrDepartment[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editing, setEditing] = useState<HrDepartment | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");

  async function loadDepartments() {
    setLoading(true);
    setMessage("");
    try {
      const result = await apiFetch("/api/hr/departments");
      setDepartments(result.departments || []);
    } catch (error: any) {
      setMessage(error.message || "Failed to load departments.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDepartments();
  }, []);

  function startEdit(department: HrDepartment) {
    setEditing(department);
    setForm({
      department_name: department.department_name || "",
      department_code: department.department_code || "",
      status: department.status || "active",
    });
    setSuccess("");
    setMessage("");
  }

  function cancelEdit() {
    setEditing(null);
    setForm(emptyForm);
  }

  async function saveDepartment(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setSuccess("");
    try {
      await apiFetch(
        editing ? `/api/hr/departments/${editing.id}` : "/api/hr/departments",
        {
          method: editing ? "PUT" : "POST",
          body: JSON.stringify(form),
        },
      );
      setSuccess(editing ? "Department updated." : "Department added.");
      cancelEdit();
      await loadDepartments();
    } catch (error: any) {
      setMessage(error.message || "Failed to save department.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteDepartment(department: HrDepartment) {
    if (!window.confirm(`Delete department "${department.department_name}"?`)) return;
    setMessage("");
    setSuccess("");
    try {
      await apiFetch(`/api/hr/departments/${department.id}`, { method: "DELETE" });
      setSuccess("Department deleted.");
      setDepartments((prev) => prev.filter((item) => item.id !== department.id));
    } catch (error: any) {
      setMessage(error.message || "Failed to delete department.");
    }
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
            <Building2 className="h-3.5 w-3.5" />
            HR
          </div>
          <h1 className="text-3xl font-bold text-slate-950">Departments</h1>
          <p className="text-sm text-slate-500">Maintain HR department master data.</p>
        </div>
        <Link href="/modules/hr" className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" />
          Back to HR
        </Link>
      </header>

      <AlertMessage type="error" message={message} onClose={() => setMessage("")} />
      <AlertMessage type="success" message={success} onClose={() => setSuccess("")} />

      {(canAdd || editing) && (
        <form onSubmit={saveDepartment} className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold text-slate-950">
              {editing ? "Edit Department" : "Add Department"}
            </h2>
            {editing && (
              <button type="button" onClick={cancelEdit} className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-slate-50">
                Cancel
              </button>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Department Name *">
              <input value={form.department_name} onChange={(event) => setForm((prev) => ({ ...prev, department_name: event.target.value }))} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400" />
            </Field>
            <Field label="Code">
              <input value={form.department_code} onChange={(event) => setForm((prev) => ({ ...prev, department_code: event.target.value }))} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400" />
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400">
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </Field>
          </div>
          <div className="mt-4 flex justify-end">
            <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
              <Plus className="h-4 w-4" />
              {saving ? "Saving..." : editing ? "Update Department" : "Add Department"}
            </button>
          </div>
        </form>
      )}

      <section className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
        <table className="min-w-[760px] w-full text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">S. No.</th>
              <th className="px-4 py-3">Department Name</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Loading departments...</td></tr>
            ) : departments.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No departments found.</td></tr>
            ) : (
              departments.map((department, index) => (
                <tr key={department.id}>
                  <td className="px-4 py-3">{index + 1}</td>
                  <td className="px-4 py-3 font-semibold text-slate-950">{department.department_name}</td>
                  <td className="px-4 py-3">{department.department_code || "-"}</td>
                  <td className="px-4 py-3">{labelize(department.status || "active")}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {canEdit && (
                        <button type="button" onClick={() => startEdit(department)} className="inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-slate-50">
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                      )}
                      {canDelete && (
                        <button type="button" onClick={() => deleteDepartment(department)} className="inline-flex items-center gap-1 rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50">
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-slate-700">{label}</span>
      {children}
    </label>
  );
}
