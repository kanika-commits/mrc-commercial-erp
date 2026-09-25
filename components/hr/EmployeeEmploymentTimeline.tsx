"use client";

import { useMemo, useState } from "react";
import type { EmployeeEmploymentHistory, HrEmployee } from "@/types/hr";
import {
  EMPLOYMENT_HISTORY_EVENTS,
  EMPLOYMENT_HISTORY_FIELD_LABELS,
  employmentEventLabel,
} from "@/lib/hr/employmentHistory";
import { apiFetch, formatDate, labelize } from "./hrClient";

type LookupItem = {
  id: string;
  label?: string;
  company_name?: string;
  site_name?: string;
  department_name?: string;
  designation_name?: string;
  employee_name?: string;
  employee_code?: string;
};

type Props = {
  employee: HrEmployee;
  history: EmployeeEmploymentHistory[];
  setHistory: (history: EmployeeEmploymentHistory[]) => void;
  canEdit: boolean;
  lookups: {
    companies: LookupItem[];
    sites: LookupItem[];
    departments: LookupItem[];
    designations: LookupItem[];
    employees: LookupItem[];
  };
  onError: (message: string) => void;
  platformOwner?: boolean;
};

const initialForm = {
  event_type: "correction",
  event_date: "",
  effective_from: "",
  effective_to: "",
  title: "",
  description: "",
  reason: "",
  company_id: "",
  site_id: "",
  department_id: "",
  designation_id: "",
  reporting_manager_id: "",
  employment_type: "",
  shift: "",
  employment_status: "",
};

export default function EmployeeEmploymentTimeline({
  employee,
  history,
  setHistory,
  canEdit,
  lookups,
  onError,
  platformOwner = false,
}: Props) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState({ event_type: "", source: "", date_from: "", date_to: "" });
  const [form, setForm] = useState(initialForm);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const scheduledTransfer = (employee as any)?.scheduled_transfer;
  const isTransfer = form.event_type === "transferred";

  const filteredHistory = useMemo(() => {
    return history.filter((event) => {
      if (filters.event_type && event.event_type !== filters.event_type) return false;
      if (filters.source && event.source !== filters.source) return false;
      if (filters.date_from && event.event_date < filters.date_from) return false;
      if (filters.date_to && event.event_date > filters.date_to) return false;
      return true;
    });
  }, [filters, history]);

  function update(name: string, value: string) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function submitManualEvent() {
    setSaving(true);
    onError("");
    try {
      if (form.event_type === "transferred" && (!form.company_id || !form.site_id || !(form.effective_from || form.event_date))) {
        throw new Error("Transferred events require destination company, destination site and effective date.");
      }
      const result = await apiFetch(`/api/hr/employees/${employee.id}/employment-history`, {
        method: "POST",
        body: JSON.stringify(isTransfer ? { ...form, event_date: form.effective_from, effective_to: "" } : form),
      });
      setHistory([result.history].concat(history));
      setForm(initialForm);
      setShowForm(false);
    } catch (error: any) {
      onError(error.message || "Failed to add employment event.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteManualEvent(event: EmployeeEmploymentHistory) {
    const eventName = event.title || employmentEventLabel(event.event_type);
    if (!window.confirm(`Delete manual employment event “${eventName}” dated ${event.event_date}?`)) return;
    onError("");
    try {
      await apiFetch(`/api/hr/employees/${employee.id}/employment-history?event_id=${encodeURIComponent(event.id)}`, { method: "DELETE" });
      setHistory(history.filter((item) => item.id !== event.id));
    } catch (error: any) {
      onError(error.message || "Failed to delete employment event.");
    }
  }

  async function updateScheduledTransfer(action: "cancel" | "reschedule") {
    if (!scheduledTransfer?.id || scheduleBusy) return;
    const nextDate = action === "reschedule" ? window.prompt("New future effective date (YYYY-MM-DD):", scheduledTransfer.effective_from) : null;
    if (action === "reschedule" && !nextDate) return;
    if (action === "cancel" && !window.confirm(`Cancel transfer scheduled for ${scheduledTransfer.effective_from}?`)) return;
    setScheduleBusy(true);
    try {
      await apiFetch(`/api/hr/employees/${employee.id}/transfer-schedules/${scheduledTransfer.id}`, {
        method: action === "cancel" ? "DELETE" : "PATCH",
        ...(nextDate ? { body: JSON.stringify({ effective_date: nextDate }) } : {}),
      });
      window.location.reload();
    } catch (error: any) { onError(error.message || "Failed to update scheduled transfer."); }
    finally { setScheduleBusy(false); }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Employment Timeline</h2>
          <p className="mt-1 text-sm text-slate-500">Chronological employment events, transfers, confirmations and status changes.</p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setShowForm((prev) => !prev)}
            className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            + Add Employment Event
          </button>
        )}
      </div>

      {scheduledTransfer && (
        <div className={`rounded-2xl border p-4 ${scheduledTransfer.status === "failed" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
          <p className="text-sm font-semibold text-slate-900">
            {scheduledTransfer.status === "failed" ? "Scheduled transfer failed" : `Transfer scheduled for ${scheduledTransfer.effective_from}`}
          </p>
          {scheduledTransfer.failure_reason && <p className="mt-1 text-sm text-red-700">{scheduledTransfer.failure_reason}</p>}
          {canEdit && scheduledTransfer.status === "pending" && (
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={scheduleBusy} onClick={() => void updateScheduledTransfer("reschedule")} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold">Reschedule</button>
              <button type="button" disabled={scheduleBusy} onClick={() => void updateScheduledTransfer("cancel")} className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700">Cancel transfer</button>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-4">
        <Filter label="Event Type">
          <select value={filters.event_type} onChange={(event) => setFilters((prev) => ({ ...prev, event_type: event.target.value }))} className={inputClass}>
            <option value="">All Events</option>
            {EMPLOYMENT_HISTORY_EVENTS.map((event) => (
              <option key={event.code} value={event.code}>{event.label}</option>
            ))}
          </select>
        </Filter>
        <Filter label="Source">
          <select value={filters.source} onChange={(event) => setFilters((prev) => ({ ...prev, source: event.target.value }))} className={inputClass}>
            <option value="">All Sources</option>
            <option value="system">System</option>
            <option value="manual">Manual</option>
            <option value="import">Import</option>
          </select>
        </Filter>
        <Filter label="From">
          <input type="date" value={filters.date_from} onChange={(event) => setFilters((prev) => ({ ...prev, date_from: event.target.value }))} className={inputClass} />
        </Filter>
        <Filter label="To">
          <input type="date" value={filters.date_to} onChange={(event) => setFilters((prev) => ({ ...prev, date_to: event.target.value }))} className={inputClass} />
        </Filter>
      </div>

      {showForm && canEdit && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-950">Add Employment Event</h3>
          <p className="mt-1 text-sm text-slate-500">Transferred uses the authorized assignment transfer flow. Other event types add history only.</p>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <Filter label="Event Type">
              <select value={form.event_type} onChange={(event) => update("event_type", event.target.value)} className={inputClass}>
                {EMPLOYMENT_HISTORY_EVENTS.map((event) => (
                  <option key={event.code} value={event.code}>{event.label}</option>
                ))}
              </select>
            </Filter>
            {!isTransfer && <Filter label="Event Date *">
              <input type="date" value={form.event_date} onChange={(event) => update("event_date", event.target.value)} className={inputClass} />
            </Filter>}
            {isTransfer && <Filter label="Future Effective Date *">
              <input type="date" value={form.effective_from} onChange={(event) => update("effective_from", event.target.value)} className={inputClass} />
            </Filter>}
            {!isTransfer && <Filter label="Effective From">
              <input type="date" value={form.effective_from} onChange={(event) => update("effective_from", event.target.value)} className={inputClass} />
            </Filter>}
            {!isTransfer && <Filter label="Effective To">
              <input type="date" value={form.effective_to} onChange={(event) => update("effective_to", event.target.value)} className={inputClass} />
            </Filter>}
            <Filter label={isTransfer ? "Destination Company *" : "Company"}>
              <select value={form.company_id} onChange={(event) => update("company_id", event.target.value)} className={inputClass}>
                <option value="">{isTransfer ? "Select destination company" : "Not specified"}</option>
                {lookups.companies.map((item) => <option key={item.id} value={item.id}>{item.label || item.company_name}</option>)}
              </select>
            </Filter>
            <Filter label={isTransfer ? "Destination Site *" : "Site"}>
              <select value={form.site_id} onChange={(event) => update("site_id", event.target.value)} className={inputClass}>
                <option value="">{isTransfer ? "Select destination site" : "Not specified"}</option>
                {lookups.sites.map((item) => <option key={item.id} value={item.id}>{item.label || item.site_name}</option>)}
              </select>
            </Filter>
            {!isTransfer && <Filter label="Department">
              <select value={form.department_id} onChange={(event) => update("department_id", event.target.value)} className={inputClass}>
                <option value="">Not specified</option>
                {lookups.departments.map((item) => <option key={item.id} value={item.id}>{item.department_name || item.label}</option>)}
              </select>
            </Filter>}
            {!isTransfer && <Filter label="Designation">
              <select value={form.designation_id} onChange={(event) => update("designation_id", event.target.value)} className={inputClass}>
                <option value="">Not specified</option>
                {lookups.designations.map((item) => <option key={item.id} value={item.id}>{item.designation_name || item.label}</option>)}
              </select>
            </Filter>}
            {!isTransfer && <Filter label="Reporting Manager">
              <select value={form.reporting_manager_id} onChange={(event) => update("reporting_manager_id", event.target.value)} className={inputClass}>
                <option value="">Not specified</option>
                {lookups.employees.filter((item) => item.id !== employee.id).map((item) => (
                  <option key={item.id} value={item.id}>{employeeName(item)}</option>
                ))}
              </select>
            </Filter>}
            {!isTransfer && <Filter label="Employee Type">
              <input value={form.employment_type} onChange={(event) => update("employment_type", event.target.value)} className={inputClass} />
            </Filter>}
            {!isTransfer && <Filter label="Shift">
              <input value={form.shift} onChange={(event) => update("shift", event.target.value)} className={inputClass} />
            </Filter>}
            {!isTransfer && <Filter label="Employment Status">
              <input value={form.employment_status} onChange={(event) => update("employment_status", event.target.value)} className={inputClass} />
            </Filter>}
          </div>
          {!isTransfer && <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Filter label="Title">
              <input value={form.title} onChange={(event) => update("title", event.target.value)} className={inputClass} />
            </Filter>
            <Filter label="Reason">
              <input value={form.reason} onChange={(event) => update("reason", event.target.value)} className={inputClass} />
            </Filter>
          </div>}
          {!isTransfer && <div className="mt-4">
            <Filter label="Description">
              <textarea value={form.description} onChange={(event) => update("description", event.target.value)} className={textareaClass} />
            </Filter>
          </div>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50">Cancel</button>
            <button type="button" disabled={saving} onClick={submitManualEvent} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {saving ? "Saving..." : isTransfer ? "Schedule Transfer" : "Save Event"}
            </button>
          </div>
        </div>
      )}

      {filteredHistory.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          No employment timeline events found.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredHistory.map((event) => (
            <article key={event.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-500">{formatDate(event.event_date)}</p>
                  <h3 className="mt-1 text-lg font-semibold text-slate-950">{event.title || employmentEventLabel(event.event_type)}</h3>
                  {event.description && <p className="mt-1 text-sm text-slate-600">{event.description}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge>{employmentEventLabel(event.event_type)}</Badge>
                  <Badge>{labelize(event.source)}</Badge>
                  {platformOwner && event.is_manual === true && (
                    <button type="button" onClick={() => void deleteManualEvent(event)} className="rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50">
                      Delete
                    </button>
                  )}
                </div>
              </div>
              <ChangeSummary event={event} resolveValue={(field, value) => resolveValue(field, value, lookups)} />
              <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                <Meta label="Company" value={resolveValue("company_id", event.company_id, lookups)} />
                <Meta label="Site" value={resolveValue("site_id", event.site_id, lookups)} />
                <Meta label="Department" value={resolveValue("department_id", event.department_id, lookups)} />
                <Meta label="Designation" value={resolveValue("designation_id", event.designation_id, lookups)} />
                <Meta label="Manager" value={resolveValue("reporting_manager_id", event.reporting_manager_id, lookups)} />
                <Meta label="Recorded By" value={event.created_by_name || event.created_by_email || "-"} />
              </div>
              {event.reason && <p className="mt-4 text-sm text-slate-600"><span className="font-semibold">Reason:</span> {event.reason}</p>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ChangeSummary({
  event,
  resolveValue,
}: {
  event: EmployeeEmploymentHistory;
  resolveValue: (field: string, value: unknown) => string;
}) {
  const previous = event.previous_values || {};
  const next = event.new_values || {};
  const fields = Array.from(new Set(Object.keys(previous).concat(Object.keys(next))));

  if (fields.length === 0) return null;

  return (
    <div className="mt-4 space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
      {fields.map((field) => (
        <p key={field}>
          <span className="font-semibold text-slate-700">{EMPLOYMENT_HISTORY_FIELD_LABELS[field] || labelize(field)}:</span>{" "}
          <span className="text-slate-500">{resolveValue(field, previous[field])}</span>
          <span className="mx-2 text-slate-400">-&gt;</span>
          <span className="font-semibold text-slate-950">{resolveValue(field, next[field])}</span>
        </p>
      ))}
    </div>
  );
}

function resolveValue(field: string, value: unknown, lookups: Props["lookups"]) {
  const id = String(value || "");
  if (!id) return "-";
  if (field === "company_id") return lookups.companies.find((item) => item.id === id)?.label || id;
  if (field === "site_id") return lookups.sites.find((item) => item.id === id)?.label || id;
  if (field === "department_id") return lookups.departments.find((item) => item.id === id)?.department_name || id;
  if (field === "designation_id") return lookups.designations.find((item) => item.id === id)?.designation_name || id;
  if (field === "reporting_manager_id") return employeeName(lookups.employees.find((item) => item.id === id)) || id;
  return labelize(id);
}

function employeeName(employee?: LookupItem) {
  if (!employee) return "";
  return employee.employee_code ? `${employee.employee_name} (${employee.employee_code})` : employee.employee_name || employee.label || "";
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{children}</span>;
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 font-semibold text-slate-950">{value}</div>
    </div>
  );
}

const inputClass = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100";
const textareaClass = "min-h-24 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100";
