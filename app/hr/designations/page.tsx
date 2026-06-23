"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, Pencil, Plus, Trash2 } from "lucide-react";
import AlertMessage from "@/components/AlertMessage";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import { apiFetch, labelize } from "@/components/hr/hrClient";
import { useHrLookups } from "@/components/hr/useHrLookups";
import type { HrDesignation } from "@/types/hr";

type FormState = {
  designation_name: string;
  department_id: string;
  designation_code: string;
  status: string;
};

const emptyForm: FormState = {
  designation_name: "",
  department_id: "",
  designation_code: "",
  status: "active",
};

export default function DesignationsPage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const canAdd = can(permissions, "hr_employees", "add");
  const canEdit = can(permissions, "hr_employees", "edit");
  const canDelete = can(permissions, "hr_employees", "delete");
  const lookups = useHrLookups({ includeEmployees: false });
  const [designations, setDesignations] = useState<HrDesignation[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editing, setEditing] = useState<HrDesignation | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");

  const departmentNameById = useMemo(() => {
    return new Map(lookups.departments.map((department) => [department.id, department.department_name]));
  }, [lookups.departments]);

  async function loadDesignations() {
    setLoading(true);
    setMessage("");
    try {
      const result = await apiFetch("/api/hr/designations");
      setDesignations(result.designations || []);
    } catch (error: any) {
      setMessage(error.message || "Failed to load designations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDesignations();
  }, []);

  function startEdit(designation: HrDesignation) {
    setEditing(designation);
    setForm({
      designation_name: designation.designation_name || "",
      department_id: designation.department_id || "",
      designation_code: designation.designation_code || "",
      status: designation.status || "active",
    });
    setSuccess("");
    setMessage("");
  }

  function cancelEdit() {
    setEditing(null);
    setForm(emptyForm);
  }

  async function saveDesignation(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setSuccess("");
    try {
      await apiFetch(
        editing ? `/api/hr/designations/${editing.id}` : "/api/hr/designations",
        {
          method: editing ? "PUT" : "POST",
          body: JSON.stringify({
            ...form,
            department_id: form.department_id || null,
          }),
        },
      );
      setSuccess(editing ? "Designation updated." : "Designation added.");
      cancelEdit();
      await loadDesignations();
    } catch (error: any) {
      setMessage(error.message || "Failed to save designation.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteDesignation(designation: HrDesignation) {
    if (!window.confirm(`Delete designation "${designation.designation_name}"?`)) return;
    setMessage("");
    setSuccess("");
    try {
      await apiFetch(`/api/hr/designations/${designation.id}`, { method: "DELETE" });
      setSuccess("Designation deleted.");
      setDesignations((prev) => prev.filter((item) => item.id !== designation.id));
    } catch (error: any) {
      setMessage(error.message || "Failed to delete designation.");
    }
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
            <BadgeCheck className="h-3.5 w-3.5" />
            HR
          </div>
          <h1 className="text-3xl font-bold text-slate-950">Designations</h1>
          <p className="text-sm text-slate-500">Maintain HR designation master data.</p>
        </div>
        <Link href="/modules/hr" className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" />
          Back to HR
        </Link>
      </header>

      <AlertMessage type="error" message={message || lookups.error} onClose={() => setMessage("")} />
      <AlertMessage type="success" message={success} onClose={() => setSuccess("")} />

      {(canAdd || editing) && (
        <form onSubmit={saveDesignation} className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold text-slate-950">
              {editing ? "Edit Designation" : "Add Designation"}
            </h2>
            {editing && (
              <button type="button" onClick={cancelEdit} className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-slate-50">
                Cancel
              </button>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <Field label="Designation Name *">
              <input value={form.designation_name} onChange={(event) => setForm((prev) => ({ ...prev, designation_name: event.target.value }))} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400" />
            </Field>
            <Field label="Department">
              <select value={form.department_id} onChange={(event) => setForm((prev) => ({ ...prev, department_id: event.target.value }))} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400">
                <option value="">No department</option>
                {lookups.departments.map((department) => (
                  <option key={department.id} value={department.id}>{department.department_name}</option>
                ))}
              </select>
            </Field>
            <Field label="Code">
              <input value={form.designation_code} onChange={(event) => setForm((prev) => ({ ...prev, designation_code: event.target.value }))} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400" />
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))} className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400">
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </Field>
          </div>
          <div className="mt-4 flex justify-end">
            <button type="submit" disabled={saving || lookups.loading} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
              <Plus className="h-4 w-4" />
              {saving ? "Saving..." : editing ? "Update Designation" : "Add Designation"}
            </button>
          </div>
        </form>
      )}

      <section className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
        <table className="min-w-[860px] w-full text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">S. No.</th>
              <th className="px-4 py-3">Designation Name</th>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading designations...</td></tr>
            ) : designations.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No designations found.</td></tr>
            ) : (
              designations.map((designation, index) => (
                <tr key={designation.id}>
                  <td className="px-4 py-3">{index + 1}</td>
                  <td className="px-4 py-3 font-semibold text-slate-950">{designation.designation_name}</td>
                  <td className="px-4 py-3">{designation.department_id ? departmentNameById.get(designation.department_id) || "-" : "-"}</td>
                  <td className="px-4 py-3">{designation.designation_code || "-"}</td>
                  <td className="px-4 py-3">{labelize(designation.status || "active")}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {canEdit && (
                        <button type="button" onClick={() => startEdit(designation)} className="inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-slate-50">
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                      )}
                      {canDelete && (
                        <button type="button" onClick={() => deleteDesignation(designation)} className="inline-flex items-center gap-1 rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50">
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
