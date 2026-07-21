"use client";

import {
  BriefcaseBusiness,
  Camera,
  FileText,
  History,
  IndianRupee,
  Pencil,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ErpAuditLog } from "@/types/hr";
import { formatDate, labelize } from "./hrClient";

type Props = {
  logs: ErpAuditLog[];
};

export default function EmployeeAuditTrail({ logs }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    date_from: "",
    date_to: "",
    action: "",
    user: "",
    search: "",
  });

  const filteredLogs = useMemo(() => {
    const searchText = filters.search.trim().toLowerCase();
    const userText = filters.user.trim().toLowerCase();
    return logs.filter((log) => {
      if (filters.action && log.action !== filters.action) return false;
      if (filters.date_from && log.created_at < `${filters.date_from}T00:00:00`) return false;
      if (filters.date_to && log.created_at > `${filters.date_to}T23:59:59`) return false;
      if (userText && !`${log.created_by_name || ""} ${log.created_by_email || ""}`.toLowerCase().includes(userText)) return false;
      if (
        searchText &&
        !`${log.action || ""} ${log.description || ""} ${log.created_by_name || ""} ${log.created_by_email || ""}`.toLowerCase().includes(searchText)
      ) {
        return false;
      }
      return true;
    });
  }, [filters, logs]);

  const actions = useMemo(
    () => Array.from(new Set(logs.map((log) => log.action).filter(Boolean))).sort(),
    [logs],
  );

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-950">Change History</h2>
        <p className="mt-1 text-sm text-slate-500">A readable history of changes made to this employee record.</p>
      </div>

      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-5">
        <Filter label="From">
          <input type="date" value={filters.date_from} onChange={(event) => setFilters((prev) => ({ ...prev, date_from: event.target.value }))} className={inputClass} />
        </Filter>
        <Filter label="To">
          <input type="date" value={filters.date_to} onChange={(event) => setFilters((prev) => ({ ...prev, date_to: event.target.value }))} className={inputClass} />
        </Filter>
        <Filter label="Action">
          <select value={filters.action} onChange={(event) => setFilters((prev) => ({ ...prev, action: event.target.value }))} className={inputClass}>
            <option value="">All Actions</option>
            {actions.map((action) => <option key={action} value={action}>{labelize(action)}</option>)}
          </select>
        </Filter>
        <Filter label="User">
          <input value={filters.user} onChange={(event) => setFilters((prev) => ({ ...prev, user: event.target.value }))} className={inputClass} placeholder="Name or email" />
        </Filter>
        <Filter label="Search">
          <input value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} className={inputClass} placeholder="Action, user, description" />
        </Filter>
      </div>

      {filteredLogs.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <History className="h-6 w-6" />
          </div>
          <p className="mt-4 text-sm font-semibold text-slate-950">No changes have been recorded for this employee yet.</p>
        </div>
      ) : (
        <div className="relative space-y-5 before:absolute before:left-6 before:top-4 before:h-[calc(100%-2rem)] before:w-px before:bg-slate-200">
          {filteredLogs.map((log) => {
            const expanded = expandedId === log.id;
            const rows = changeRows(log);
            const details = eventDetails(log);
            const Icon = eventIcon(log);
            return (
              <article key={log.id} className="relative pl-16">
                <div className="absolute left-0 top-1 z-10 flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-950">{eventTitle(log)}</h3>
                      <p className="mt-2 text-sm text-slate-600">
                        Changed by <span className="font-semibold text-slate-900">{actorLabel(log)}</span>
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-500">{formatDate(log.created_at)}</p>
                    </div>
                    <Badge>{moduleLabel(log)}</Badge>
                  </div>

                  {details.length > 0 && (
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {details.map((detail) => (
                        <div key={detail.label} className="rounded-xl bg-slate-50 px-3 py-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{detail.label}</p>
                          <p className="mt-1 text-sm font-semibold text-slate-900">{detail.value}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {rows.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : log.id)}
                        className="mt-4 rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-slate-50"
                      >
                        {expanded ? "Hide Changes" : "View Changes"}
                      </button>

                      {expanded && (
                        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
                          <table className="min-w-full divide-y divide-slate-200 text-sm">
                            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                              <tr>
                                <th className="px-4 py-3">Field</th>
                                <th className="px-4 py-3">Old Value</th>
                                <th className="px-4 py-3">New Value</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {rows.map((row) => (
                                <tr key={row.field}>
                                  <td className="px-4 py-3 font-semibold text-slate-900">{row.label}</td>
                                  <td className="px-4 py-3 text-slate-600">{row.oldValue}</td>
                                  <td className="px-4 py-3 text-slate-950">
                                    <span className="mr-2 text-slate-400">↓</span>
                                    {row.newValue}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}

                  {rows.length === 0 && details.length === 0 && log.description && (
                    <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">{log.description}</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
      {children}
    </span>
  );
}

type ChangeRow = {
  field: string;
  label: string;
  oldValue: string;
  newValue: string;
};

const fieldLabels: Record<string, string> = {
  employee_code: "Employee Code",
  employee_name: "Employee Name",
  email: "Official Email",
  phone: "Primary Mobile",
  personal_email: "Personal Email",
  personal_phone: "Personal Mobile",
  department_id: "Department",
  designation_id: "Designation",
  reporting_manager_id: "Reporting Manager",
  company_id: "Company",
  site_id: "Site",
  status: "Status",
  employment_status: "Employment Status",
  employment_type: "Employee Type",
  shift: "Shift",
  date_of_joining: "Joining Date",
  confirmation_date: "Confirmation Date",
  resignation_date: "Resignation Date",
  date_of_exit: "Relieving Date",
  exit_remark: "Exit Remark",
  date_of_birth: "Date of Birth",
  gender: "Gender",
  nationality: "Nationality",
  blood_group: "Blood Group",
  marital_status: "Marital Status",
  father_name: "Father Name",
  mother_name: "Mother Name",
  spouse_name: "Spouse Name",
  emergency_contact_name: "Emergency Contact",
  emergency_contact_phone: "Emergency Number",
  emergency_contact_relationship: "Emergency Relationship",
  current_address_line1: "Current Address Line 1",
  current_address_line2: "Current Address Line 2",
  current_address_city: "Current City",
  current_address_state: "Current State",
  current_address_country: "Current Country",
  current_address_pin_code: "Current PIN Code",
  permanent_address_line1: "Permanent Address Line 1",
  permanent_address_line2: "Permanent Address Line 2",
  permanent_address_city: "Permanent City",
  permanent_address_state: "Permanent State",
  permanent_address_country: "Permanent Country",
  permanent_address_pin_code: "Permanent PIN Code",
  document_type: "Document Type",
  document_name: "Document Name",
  document_number: "Document Number",
  version: "Version",
  expiry_date: "Expiry",
  issue_date: "Issue Date",
  issuing_authority: "Issuing Authority",
  basic_salary: "Basic Salary",
  gross_salary: "Gross Salary",
  net_salary: "Net Salary",
  ctc: "CTC",
  employee_pf: "Employee PF",
  employer_pf: "Employer PF",
  employee_esic: "Employee ESIC",
  employer_esic: "Employer ESIC",
  professional_tax: "Professional Tax",
  tds: "TDS",
  other_salary_deductions: "Other Salary Deductions",
  bonus: "Bonus",
  revision_type: "Revision Type",
  effective_from: "Effective From",
  effective_to: "Effective To",
  reason: "Reason",
  remarks: "Remarks",
};

function actorLabel(log: ErpAuditLog) {
  return log.created_by_name || log.created_by_email || "System";
}

function moduleLabel(log: ErpAuditLog) {
  if (log.module_code === "hr_salary") return "Salary";
  if (log.entity_type === "employee_document") return "Document";
  if (log.action.startsWith("photo_")) return "Photo";
  if (log.action === "employment_change" || log.entity_type === "employee_employment_history") return "Employment";
  return "Employee";
}

function eventTitle(log: ErpAuditLog) {
  if (log.action === "document_upload") return "Document Uploaded";
  if (log.action === "document_replace") return "Document Replaced";
  if (log.action === "document_delete") return "Document Deleted";
  if (log.action === "photo_upload") return "Photo Uploaded";
  if (log.action === "photo_replace") return "Photo Replaced";
  if (log.action === "salary_revision") return "Salary Revised";
  if (log.action === "employment_change" || log.entity_type === "employee_employment_history") return employmentTitle(log);
  if (log.action === "permission_change") return "Permission Changed";
  if (log.action === "create") return "Employee Created";
  if (log.action === "update") return "Employee Updated";
  if (log.action === "delete") return "Employee Deleted";
  return labelize(log.action);
}

function employmentTitle(log: ErpAuditLog) {
  const type = String(log.new_values?.event_type || log.old_values?.event_type || "").toLowerCase();
  if (type.includes("promotion")) return "Promotion";
  if (type.includes("transfer")) return "Transfer";
  if (type.includes("department")) return "Department Change";
  if (type.includes("manager") || type.includes("reporting")) return "Reporting Manager Change";
  if (type.includes("status")) return "Status Change";
  if (type.includes("confirmation")) return "Confirmation";
  if (type.includes("exit") || type.includes("resign")) return "Exit";
  return "Employment Updated";
}

function eventIcon(log: ErpAuditLog) {
  if (log.action.startsWith("document_")) return FileText;
  if (log.action.startsWith("photo_")) return Camera;
  if (log.action === "salary_revision") return IndianRupee;
  if (log.action === "employment_change" || log.entity_type === "employee_employment_history") return BriefcaseBusiness;
  if (log.action === "permission_change") return ShieldCheck;
  if (log.action === "create") return UserRound;
  return Pencil;
}

function eventDetails(log: ErpAuditLog) {
  if (log.action.startsWith("photo_")) return [];

  const values = { ...(log.old_values || {}), ...(log.new_values || {}) };
  if (log.action.startsWith("document_")) {
    return [
      detail("Document Type", values.document_type),
      detail("Document Number", values.document_number),
      detail("Version", values.version ? `V${values.version}` : null),
      detail("Expiry", values.expiry_date),
    ].filter((item): item is { label: string; value: string } => Boolean(item));
  }

  if (log.action === "salary_revision") {
    return [detail("Effective From", values.effective_from)].filter((item): item is { label: string; value: string } => Boolean(item));
  }

  if (log.action === "employment_change" || log.entity_type === "employee_employment_history") {
    return [
      detail("Event", values.title || values.event_type),
      detail("Effective From", values.effective_from || values.event_date),
    ].filter((item): item is { label: string; value: string } => Boolean(item));
  }

  return [];
}

function detail(label: string, value: unknown) {
  const formatted = formatValue(value);
  return formatted === "-" ? null : { label, value: formatted };
}

function changeRows(log: ErpAuditLog): ChangeRow[] {
  const oldValues = log.old_values || {};
  const newValues = log.new_values || {};
  const keys = Array.from(new Set([...Object.keys(oldValues), ...Object.keys(newValues)]));

  return keys
    .filter((key) => shouldShowField(key, log))
    .map((key) => ({
      field: key,
      label: fieldLabels[key] || labelize(key),
      oldValue: formatValue(oldValues[key]),
      newValue: formatValue(newValues[key]),
    }))
    .filter((row) => row.oldValue !== row.newValue);
}

function shouldShowField(key: string, log: ErpAuditLog) {
  if (["id", "organization_id", "employee_id", "created_at", "updated_at", "created_by", "updated_by", "created_by_email", "updated_by_email", "created_by_name", "updated_by_name", "storage_path", "file_url", "signed_url", "source", "source_system", "source_record_id", "import_batch_id", "previous_values", "new_values"].includes(key)) {
    return false;
  }
  if (log.action.startsWith("photo_")) return false;
  return true;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(formatValue).join(", ") || "-";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== null && entryValue !== undefined && entryValue !== "")
      .map(([entryKey, entryValue]) => `${fieldLabels[entryKey] || labelize(entryKey)}: ${formatValue(entryValue)}`);
    return entries.join(", ") || "-";
  }
  return labelize(String(value));
}

const inputClass = "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100";
