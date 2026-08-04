"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";
import AlertMessage from "@/components/AlertMessage";
import { useAccessContext } from "@/components/AccessContext";
import { apiFetch } from "@/components/hr/hrClient";
import { can } from "@/lib/accessControl";
import { EMPLOYEE_STANDARD_WORKING_HOURS } from "@/lib/hr/attendance";

export default function EmployeeAttendancePolicyPage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const canView = can(permissions, "hr_employee_attendance_policy", "view");
  const canEdit =
    can(permissions, "hr_employee_attendance_policy", "add") ||
    can(permissions, "hr_employee_attendance_policy", "edit");
  const [lookups, setLookups] = useState<{ companies: any[]; sites: any[]; policies: any[] }>({ companies: [], sites: [], policies: [] });
  const [users, setUsers] = useState<any[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [approvalLevelCount, setApprovalLevelCount] = useState("1");
  const [approvalLayers, setApprovalLayers] = useState<Array<{ level_sequence: number; stage_name: string; approver_user_id: string }>>([
    { level_sequence: 1, stage_name: "Level 1 Approval", approver_user_id: "" },
  ]);
  const [lockAfterHours, setLockAfterHours] = useState("5");
  const [postLockUserIds, setPostLockUserIds] = useState<string[]>([]);
  const [status, setStatus] = useState("active");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");

  const visibleSites = useMemo(
    () => companyId ? lookups.sites.filter((site) => site.scope_company_id === companyId) : lookups.sites,
    [companyId, lookups.sites],
  );

  const selectedPolicy = useMemo(
    () => lookups.policies.find((policy) => policy.company_id === companyId && policy.site_id === siteId) || null,
    [companyId, lookups.policies, siteId],
  );

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const payload = await apiFetch("/api/hr/attendance/policy");
      setLookups({ companies: payload.companies || [], sites: payload.sites || [], policies: payload.policies || [] });
      setUsers(payload.users || []);
    } catch (error: any) {
      setMessage(error.message || "Failed to load employee attendance policies.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!selectedPolicy) {
      setStatus("active");
      setApprovalLevelCount("1");
      setApprovalLayers([{ level_sequence: 1, stage_name: "Level 1 Approval", approver_user_id: "" }]);
      setLockAfterHours("5");
      setPostLockUserIds([]);
      return;
    }
    setStatus(selectedPolicy.status === "inactive" ? "inactive" : "active");
    const count = Math.max(0, Math.min(3, Number(selectedPolicy.approval_level_count ?? 1)));
    setApprovalLevelCount(String(count));
    setApprovalLayers(Array.from({ length: count }, (_, index) => {
      const layer = (selectedPolicy.approval_layers || []).find((item: any) => Number(item.level_sequence) === index + 1) || {};
      return {
        level_sequence: index + 1,
        stage_name: `Level ${index + 1} Approval`,
        approver_user_id: layer.approver_user_id || "",
      };
    }));
    setLockAfterHours(String(selectedPolicy.lock_after_hours ?? 5));
    setPostLockUserIds((selectedPolicy.post_lock_editors || []).map((item: any) => item.user_id).filter(Boolean));
  }, [selectedPolicy]);

  function updateApprovalLevelCount(value: string) {
    const count = Number(value);
    if (!Number.isInteger(count) || count < 0 || count > 3) return;
    setApprovalLevelCount(String(count));
    setApprovalLayers((current) => Array.from({ length: count }, (_, index) => {
      const existing = current[index];
      return existing || { level_sequence: index + 1, stage_name: `Level ${index + 1} Approval`, approver_user_id: "" };
    }).map((layer, index) => ({ ...layer, level_sequence: index + 1, stage_name: `Level ${index + 1} Approval` })));
  }

  function updateLayer(index: number, patch: Partial<{ approver_user_id: string }>) {
    setApprovalLayers((current) => current.map((layer, layerIndex) => layerIndex === index ? { ...layer, ...patch } : layer));
  }

  function toggleValue(values: string[], value: string, checked: boolean) {
    return checked ? Array.from(new Set([...values, value])) : values.filter((item) => item !== value);
  }

  async function save() {
    if (!companyId || !siteId) {
      setMessage("Select company and site.");
      return;
    }
    setSaving(true);
    setMessage("");
    setSuccess("");
    try {
      await apiFetch("/api/hr/attendance/policy", {
        method: "PUT",
        body: JSON.stringify({
          company_id: companyId,
          site_id: siteId,
          attendance_lock_rule: "configured_hours_after_day_end",
          approval_level_count: Number(approvalLevelCount),
          approval_layers: approvalLayers,
          lock_after_hours: Number(lockAfterHours),
          post_lock_user_ids: postLockUserIds,
          status,
        }),
      });
      setSuccess("Employee attendance policy saved.");
      await load();
    } catch (error: any) {
      setMessage(error.message || "Failed to save employee attendance policy.");
    } finally {
      setSaving(false);
    }
  }

  if (!canView) {
    return <div className="rounded-2xl border bg-white p-8 text-sm text-slate-500 shadow-sm">Employee Attendance Policy is not available for your permissions.</div>;
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">Employee Attendance Policy</h1>
          <p className="text-sm text-slate-500">Configure manual HR attendance entry and the existing period approval workflow by company and site.</p>
        </div>
        <Link href="/modules/settings" className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      </header>

      <AlertMessage type="error" message={message} onClose={() => setMessage("")} />
      <AlertMessage type="success" message={success} onClose={() => setSuccess("")} />

      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <Select label="Company" value={companyId} onChange={(value) => { setCompanyId(value); setSiteId(""); }} options={lookups.companies} />
          <Select label="Site" value={siteId} onChange={setSiteId} options={visibleSites} />
          <ReadOnlyField label="Attendance Method" value="Manual HR Entry" />
          <ReadOnlyField label="Standard Working Day" value={`${EMPLOYEE_STANDARD_WORKING_HOURS} hours`} />
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Approval Levels</span>
            <select value={approvalLevelCount} onChange={(event) => updateApprovalLevelCount(event.target.value)} disabled={!canEdit || saving} className="h-10 w-full rounded-xl border px-3 text-sm disabled:bg-slate-50">
              {[0, 1, 2, 3].map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Lock After Hours</span>
            <input type="number" min="0" max="168" step="1" value={lockAfterHours} onChange={(event) => {
              const value = event.target.value;
              if (value === "" || /^\d+$/.test(value)) setLockAfterHours(value);
            }} disabled={!canEdit || saving} className="h-10 w-full rounded-xl border px-3 text-sm disabled:bg-slate-50" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)} disabled={!canEdit || saving} className="h-10 w-full rounded-xl border px-3 text-sm disabled:bg-slate-50">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>
        <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">Attendance locks the configured whole hours after the attendance date ends at 11:59 PM. Platform Owner and Super Admin can always edit after lock with a reason.</p>

        {approvalLayers.length > 0 && (
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {approvalLayers.map((layer, index) => (
              <div key={layer.level_sequence} className="rounded-xl border bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-950">Level {layer.level_sequence} Approval</p>
                <div className="mt-3 grid gap-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Approver</span>
                    <select value={layer.approver_user_id} onChange={(event) => updateLayer(index, { approver_user_id: event.target.value })} disabled={!canEdit || saving} className="h-10 w-full rounded-xl border px-3 text-sm disabled:bg-slate-50">
                      <option value="">Select Approver</option>
                      {users.map((user) => <option key={user.id} value={user.id}>{user.label}{user.email ? ` — ${user.email}` : ""}</option>)}
                    </select>
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border bg-white p-3">
            <p className="text-sm font-semibold text-slate-950">Users Allowed to Update Locked Attendance</p>
            <div className="mt-3 max-h-44 space-y-2 overflow-auto">
              {!users.length && <p className="text-sm text-slate-500">No active users found.</p>}
              {users.map((user) => (
                <label key={user.id} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={postLockUserIds.includes(user.id)} disabled={!canEdit || saving} onChange={(event) => setPostLockUserIds((current) => toggleValue(current, user.id, event.target.checked))} />
                  <span>{user.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          {canEdit && (
            <button type="button" onClick={save} disabled={saving || loading} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : "Save Policy"}
            </button>
          )}
        </div>
      </section>

      <section className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
        <div className="border-b p-4">
          <h2 className="font-semibold text-slate-950">Configured Policies</h2>
          <p className="text-sm text-slate-500">Only saved Employee Attendance policies are listed here.</p>
        </div>
        <table className="min-w-[760px] w-full text-left text-sm">
          <thead className="border-b bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Company</th>
              <th className="px-3 py-3">Site</th>
              <th className="px-3 py-3">Method</th>
              <th className="px-3 py-3">Working Day</th>
              <th className="px-3 py-3">Approval Levels</th>
              <th className="px-3 py-3">Lock After</th>
              <th className="px-3 py-3">Post-Lock Editors</th>
              <th className="px-3 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {lookups.policies.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">No Employee Attendance Policies have been configured.</td></tr>
            ) : lookups.policies.map((policy) => {
              const company = lookups.companies.find((item) => item.id === policy.company_id);
              const site = lookups.sites.find((item) => item.scope_company_id === policy.company_id && item.id === policy.site_id);
              return (
                <tr key={policy.id || `${policy.company_id}:${policy.site_id}`}>
                  <td className="px-4 py-3 font-medium text-slate-950">{company?.label || "-"}</td>
                  <td className="px-3 py-3 text-slate-700">{site?.label || "-"}</td>
                  <td className="px-3 py-3 text-slate-700">Manual HR Entry</td>
                  <td className="px-3 py-3 text-slate-700">{EMPLOYEE_STANDARD_WORKING_HOURS} hours</td>
                  <td className="px-3 py-3 text-slate-700">{formatApprovalLevels(policy.approval_level_count ?? 1)}</td>
                  <td className="px-3 py-3 text-slate-700">{policy.lock_after_hours ?? 5} hours</td>
                  <td className="px-3 py-3 text-slate-700">{formatPostLockUsers(policy.post_lock_editors || [], users)}</td>
                  <td className="px-3 py-3">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{policy.status || "active"}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </section>
  );
}

function formatApprovalLevels(value: unknown) {
  const count = Number(value || 0);
  return `${count} ${count === 1 ? "Level" : "Levels"}`;
}

function formatPostLockUsers(editors: any[], users: any[]) {
  const userIds = editors.map((editor) => editor.user_id).filter(Boolean);
  if (!userIds.length) return "Platform/Super Admin";
  return userIds
    .map((userId) => users.find((user) => user.id === userId)?.label || "User")
    .join(", ");
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { id: string; label: string }[] }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-xl border px-3 text-sm">
        <option value="">Select {label}</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <input value={value} readOnly className="h-10 w-full rounded-xl border bg-slate-50 px-3 text-sm text-slate-600" />
    </label>
  );
}
