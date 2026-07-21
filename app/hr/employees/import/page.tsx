"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, FileSpreadsheet, Play, RefreshCw, Upload } from "lucide-react";
import AlertMessage from "@/components/AlertMessage";
import HrSectionNav from "@/components/hr/HrSectionNav";
import { apiFetch, formatDate, getAccessToken, labelize } from "@/components/hr/hrClient";
import { can } from "@/lib/accessControl";
import { useAccessContext } from "@/components/AccessContext";

type ImportBatch = {
  id: string;
  source_file_name: string;
  source_sheet_name?: string | null;
  status: string;
  mapping?: Record<string, string>;
  summary?: Record<string, number>;
  created_at?: string;
};

type ImportMasters = {
  companies: any[];
  sites: any[];
  departments: any[];
  designations: any[];
};

type ImportRow = {
  id: string;
  source_row_number: number;
  raw_data: Record<string, string>;
  normalized_data: Record<string, any>;
  validation_status: string;
  import_status: string;
  errors: string[];
  warnings: string[];
};

const FIELD_OPTIONS = [
  ["", "Do not import"],
  ["source_serial_no", "SrNo"],
  ["employee_code", "Employee Code"],
  ["employee_title", "Employee Title"],
  ["work_id", "Work ID"],
  ["employee_name", "Employee Name"],
  ["company_name", "Company"],
  ["site_name", "Site"],
  ["department_name", "Department"],
  ["designation_name", "Designation"],
  ["shift", "Shift"],
  ["father_name", "Father/Husband Name"],
  ["mother_name", "Mother Name"],
  ["spouse_name", "Spouse Name"],
  ["date_of_birth", "Date of Birth"],
  ["gender", "Gender"],
  ["blood_group", "Blood Group"],
  ["marital_status", "Marital Status"],
  ["marriage_anniversary", "Marriage Anniversary"],
  ["current_address_line1", "Local Address"],
  ["current_address_city", "Local City"],
  ["email", "Work Email"],
  ["phone", "Work Number"],
  ["personal_email", "Personal Email / Local Email"],
  ["personal_phone", "Personal Mobile / Local Mobile"],
  ["permanent_address_line1", "Permanent Address"],
  ["permanent_address_city", "Permanent City"],
  ["permanent_mobile_no", "Permanent Mobile No (fallback only)"],
  ["permanent_email_id", "Permanent Email ID (fallback only)"],
  ["interview_date", "Interview Date"],
  ["date_of_joining", "Joining Date"],
  ["is_confirmed", "Is Confirm"],
  ["confirmation_date", "Confirm Date"],
  ["reporting_manager_name", "Reporting Employee Name"],
  ["reporting_local_mobile", "Reporting Local Mobile"],
  ["reporting_permanent_mobile", "Reporting Permanent Mobile"],
  ["driving_license_number", "Driving License No"],
  ["driving_license_valid_till", "Driving License Valid Till"],
  ["passport_number", "Passport No"],
  ["passport_issue_country", "Passport Issue Country"],
  ["passport_issue_date", "Passport Issue Date"],
  ["passport_expiry_date", "Passport Expiry Date"],
  ["bank_account_number", "Bank A/C No"],
  ["bank_name", "Bank Name"],
  ["bank_ifsc", "Bank IFSC"],
  ["pf_number", "PF No"],
  ["pf_joining_date", "PF Joining Date"],
  ["pan_number", "PAN No"],
  ["esi_number", "ESIC No"],
  ["aadhaar_number", "Aadhaar No"],
  ["voter_id", "Voter ID"],
  ["uan_number", "UNI/UAN No"],
  ["branch_from_date", "Branch From Date"],
  ["branch_to_date", "Branch To Date"],
  ["is_active", "Is Active"],
  ["inactive_mode", "Inactive Mode"],
  ["date_of_exit", "Relieving Date"],
  ["company_address1", "Company Address 1"],
  ["company_address2", "Company Address 2"],
  ["company_address3", "Company Address 3"],
  ["company_city", "Company City"],
  ["branch_address1", "Branch Address 1"],
  ["branch_address2", "Branch Address 2"],
  ["branch_address3", "Branch Address 3"],
  ["branch_city", "Branch City"],
  ["joining_salary", "Joining Salary"],
  ["joining_salary_words", "Joining Salary Words"],
  ["joining_net_salary", "Joining Net Salary"],
  ["joining_net_salary_words", "Joining Net Salary Words"],
  ["joining_salary_effective_date", "Joining Salary Effective Date"],
  ["gross_salary", "Current Salary"],
  ["current_salary_words", "Current Salary Words"],
  ["net_salary", "Current Net Salary"],
  ["current_net_salary_words", "Current Net Salary Words"],
  ["current_salary_effective_date", "Current Salary Effective Date"],
  ["employment_type", "Employment Type"],
  ["resignation_date", "Resignation Date"],
  ["notice_period_from", "Notice From"],
  ["notice_period_to", "Notice To"],
  ["exit_remark", "Resign Remark"],
  ["remarks", "Employee Remark"],
  ["legacy_remark", "Remark"],
];

const MASTER_MAPPING_KEY = "__master_mappings";

function statusClass(status: string) {
  if (["ready", "valid", "imported", "completed"].includes(status)) return "bg-emerald-50 text-emerald-700";
  if (["invalid", "failed", "completed_with_errors"].includes(status)) return "bg-red-50 text-red-700";
  if (["warning", "validated"].includes(status)) return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

export default function EmployeeImportPage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const canView = can(permissions, "hr_employee_import", "view");
  const canUpload = can(permissions, "hr_employee_import", "upload");
  const canExecute = can(permissions, "hr_employee_import", "execute");
  const [file, setFile] = useState<File | null>(null);
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [masters, setMasters] = useState<ImportMasters>({ companies: [], sites: [], departments: [], designations: [] });
  const [total, setTotal] = useState(0);
  const [mapping, setMapping] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");
  const [dobEdits, setDobEdits] = useState<Record<string, string>>({});

  const headers = useMemo(() => Object.keys(mapping).filter((header) => header !== MASTER_MAPPING_KEY), [mapping]);
  const summary = batch?.summary || {};
  const canRunImport = Boolean(batch && canExecute && summary.invalid === 0 && rows.some((row) => row.import_status === "pending"));
  const sourceMasterValues = useMemo(() => ({
    companies: uniqueValues(rows.map((row) => row.normalized_data?.company_name)),
    sites: uniqueValues(rows.map((row) => row.normalized_data?.site_name)),
    departments: uniqueValues(rows.map((row) => row.normalized_data?.department_name)),
    designations: uniqueValues(rows.map((row) => row.normalized_data?.designation_name)),
  }), [rows]);

  const masterMappings = (mapping[MASTER_MAPPING_KEY] || {}) as Record<string, Record<string, string>>;

  async function loadPreview(batchId: string) {
    const result = await apiFetch(`/api/hr/employee-import/preview?batch_id=${batchId}&page_size=100`);
    setBatch(result.batch);
    setRows(result.rows || []);
    setMasters(result.masters || { companies: [], sites: [], departments: [], designations: [] });
    setTotal(Number(result.total || 0));
    setMapping(result.batch?.mapping || {});
  }

  function updateMasterMapping(group: string, sourceValue: string, targetId: string) {
    const sourceKey = masterMappingKey(sourceValue);
    setMapping((prev) => {
      const previousMasters = ((prev[MASTER_MAPPING_KEY] || {}) as Record<string, Record<string, string>>);
      const groupMappings = { ...(previousMasters[group] || {}) };
      if (targetId) groupMappings[sourceKey] = targetId;
      else delete groupMappings[sourceKey];
      return {
        ...prev,
        [MASTER_MAPPING_KEY]: {
          ...previousMasters,
          [group]: groupMappings,
        },
      };
    });
  }

  async function uploadWorkbook() {
    if (!file) {
      setMessage("Choose the Head Office workbook first.");
      return;
    }

    setLoading(true);
    setMessage("");
    setSuccess("");

    try {
      const token = await getAccessToken();
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/hr/employee-import/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Workbook upload failed.");
      setBatch(result.batch);
      setMapping(result.batch?.mapping || {});
      setSuccess(`Parsed ${result.parsed_rows || 0} rows from ${result.batch?.source_sheet_name || "workbook"}.`);
      await loadPreview(result.batch.id);
    } catch (error: any) {
      setMessage(error.message || "Failed to upload workbook.");
    } finally {
      setLoading(false);
    }
  }

  async function saveMapping() {
    if (!batch) return;
    setLoading(true);
    setMessage("");
    setSuccess("");
    try {
      const result = await apiFetch("/api/hr/employee-import/mapping", {
        method: "PUT",
        body: JSON.stringify({ batch_id: batch.id, mapping }),
      });
      setBatch(result.batch);
      setSuccess("Mapping saved and rows revalidated.");
      await loadPreview(batch.id);
    } catch (error: any) {
      setMessage(error.message || "Failed to save mapping.");
    } finally {
      setLoading(false);
    }
  }

  async function validateBatch() {
    if (!batch) return;
    setLoading(true);
    setMessage("");
    setSuccess("");
    try {
      const result = await apiFetch("/api/hr/employee-import/validate", {
        method: "POST",
        body: JSON.stringify({ batch_id: batch.id }),
      });
      setBatch(result.batch);
      setSuccess("Import batch revalidated against current HR masters.");
      await loadPreview(batch.id);
    } catch (error: any) {
      setMessage(error.message || "Failed to validate batch.");
    } finally {
      setLoading(false);
    }
  }

  async function executeBatch() {
    if (!batch) return;
    if (!window.confirm("Import all valid rows from this batch? This cannot be undone from this screen.")) return;
    setLoading(true);
    setMessage("");
    setSuccess("");
    try {
      const result = await apiFetch("/api/hr/employee-import/execute", {
        method: "POST",
        body: JSON.stringify({ batch_id: batch.id }),
      });
      setBatch(result.batch);
      setSuccess(`Import finished. Imported: ${result.summary?.imported || 0}, failed: ${result.summary?.failed || 0}.`);
      await loadPreview(batch.id);
    } catch (error: any) {
      setMessage(error.message || "Failed to execute import.");
    } finally {
      setLoading(false);
    }
  }

  async function saveDobCorrection(row: ImportRow, clearDob = false) {
    if (!batch) return;
    const value = clearDob ? "" : String(dobEdits[row.id] ?? row.normalized_data?.date_of_birth ?? "").trim();
    if (!clearDob && !value) {
      setMessage("Enter a corrected DOB or clear it with acknowledgement.");
      return;
    }
    if (clearDob && !window.confirm("Clear this DOB for import? The original workbook value will remain in raw import metadata.")) {
      return;
    }

    setLoading(true);
    setMessage("");
    setSuccess("");
    try {
      const result = await apiFetch(`/api/hr/employee-import/rows/${row.id}`, {
        method: "PUT",
        body: JSON.stringify({
          batch_id: batch.id,
          normalized_patch: { date_of_birth: value },
          warning_acknowledged: clearDob,
        }),
      });
      setBatch(result.batch);
      setSuccess("DOB correction saved and row revalidated.");
      setDobEdits((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      await loadPreview(batch.id);
    } catch (error: any) {
      setMessage(error.message || "Failed to save DOB correction.");
    } finally {
      setLoading(false);
    }
  }

  if (!canView && !canUpload) {
    return (
      <section className="space-y-4">
        <HrSectionNav />
        <div className="rounded-2xl border bg-white p-6 text-sm text-slate-500 shadow-sm">
          You do not have permission to access employee imports.
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Employee Import</p>
          <h1 className="text-3xl font-bold text-slate-950">Head Office Employee Import</h1>
          <p className="text-sm text-slate-500">Upload the approved workbook, review mappings, validate rows and import only after the preview is clean.</p>
        </div>
        <Link href="/hr/employees" className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" />
          Back to Employees
        </Link>
      </header>

      <HrSectionNav />
      <AlertMessage type="error" message={message} onClose={() => setMessage("")} />
      <AlertMessage type="success" message={success} onClose={() => setSuccess("")} />

      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Head Office Workbook</label>
            <input
              type="file"
              accept=".xlsx,.xlsm"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
              className="w-full rounded-xl border bg-white px-3 py-2 text-sm"
              disabled={!canUpload || loading}
            />
            <p className="mt-1 text-xs text-slate-500">No import is executed during upload. Rows are parsed and staged for preview only.</p>
          </div>
          {canUpload && (
            <button
              type="button"
              onClick={uploadWorkbook}
              disabled={loading || !file}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              Upload & Preview
            </button>
          )}
        </div>
      </section>

      {batch && (
        <section className="grid gap-4 lg:grid-cols-4">
          <Summary label="Batch" value={batch.source_file_name} detail={batch.source_sheet_name || "-"} />
          <Summary label="Status" value={labelize(batch.status)} detail={formatDate(batch.created_at)} />
          <Summary label="Rows" value={String(summary.total || total || 0)} detail={`${summary.ready || 0} ready`} />
          <Summary label="Issues" value={String(summary.invalid || 0)} detail={`${summary.failed || 0} failed imports`} />
        </section>
      )}

      {batch && headers.length > 0 && (
        <section className="rounded-2xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="text-lg font-bold text-slate-950">Master Mapping Review</h2>
            <p className="text-sm text-slate-500">Confirm how workbook columns map to ERP employee fields before import.</p>
          </div>
          <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
            {headers.map((header) => (
              <label key={header} className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{header}</span>
                <select
                  value={mapping[header] || ""}
                  onChange={(event) => setMapping((prev) => ({ ...prev, [header]: event.target.value }))}
                  disabled={!canUpload || loading}
                  className="h-10 w-full rounded-xl border bg-white px-3 text-sm"
                >
                  {FIELD_OPTIONS.map(([value, label]) => (
                    <option key={`${header}-${value}`} value={value}>{label}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t p-5">
            {canUpload && (
              <>
                <button type="button" onClick={validateBatch} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">
                  <RefreshCw className="h-4 w-4" />
                  Revalidate
                </button>
                <button type="button" onClick={saveMapping} disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  <CheckCircle2 className="h-4 w-4" />
                  Save Mapping
                </button>
              </>
            )}
            {canExecute && (
              <button type="button" onClick={executeBatch} disabled={loading || !canRunImport} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                <Play className="h-4 w-4" />
                Execute Import
              </button>
            )}
          </div>
        </section>
      )}

      {batch && (
        <section className="rounded-2xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="text-lg font-bold text-slate-950">ERP Master Value Mapping</h2>
            <p className="text-sm text-slate-500">Map workbook values to existing ERP masters. Saved mappings are applied to all staged rows during validation.</p>
          </div>
          <div className="grid gap-4 p-5 xl:grid-cols-2">
            <MasterMappingGroup
              title="Companies"
              sourceValues={sourceMasterValues.companies}
              options={masters.companies}
              optionLabel={(row) => `${row.company_name}${row.company_code ? ` / ${row.company_code}` : ""}`}
              mappings={masterMappings.companies || {}}
              onChange={(source, value) => updateMasterMapping("companies", source, value)}
              disabled={!canUpload || loading}
            />
            <MasterMappingGroup
              title="Sites"
              sourceValues={sourceMasterValues.sites}
              options={masters.sites}
              optionLabel={(row) => `${row.site_name}${row.site_code ? ` / ${row.site_code}` : ""}`}
              mappings={masterMappings.sites || {}}
              onChange={(source, value) => updateMasterMapping("sites", source, value)}
              disabled={!canUpload || loading}
            />
            <MasterMappingGroup
              title="Departments"
              sourceValues={sourceMasterValues.departments}
              options={masters.departments}
              optionLabel={(row) => `${row.department_name}${row.department_code ? ` / ${row.department_code}` : ""}`}
              mappings={masterMappings.departments || {}}
              onChange={(source, value) => updateMasterMapping("departments", source, value)}
              disabled={!canUpload || loading}
            />
            <MasterMappingGroup
              title="Designations"
              sourceValues={sourceMasterValues.designations}
              options={masters.designations}
              optionLabel={(row) => `${row.designation_name}${row.designation_code ? ` / ${row.designation_code}` : ""}`}
              mappings={masterMappings.designations || {}}
              onChange={(source, value) => updateMasterMapping("designations", source, value)}
              disabled={!canUpload || loading}
            />
          </div>
          {canUpload && (
            <div className="flex justify-end border-t p-5">
              <button type="button" onClick={saveMapping} disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                <CheckCircle2 className="h-4 w-4" />
                Save Master Mapping
              </button>
            </div>
          )}
        </section>
      )}

      {batch && (
        <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b p-5">
            <FileSpreadsheet className="h-5 w-5 text-slate-500" />
            <div>
              <h2 className="text-lg font-bold text-slate-950">Preview Rows</h2>
              <p className="text-sm text-slate-500">Showing the first 100 staged rows. Invalid rows must be resolved before execution.</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Row</th>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Assignment</th>
                  <th className="px-4 py-3">Validation</th>
                  <th className="px-4 py-3">Import</th>
                  <th className="px-4 py-3">Issues</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-mono text-xs">{row.source_row_number}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-950">{row.normalized_data?.employee_name || "-"}</p>
                      <p className="text-xs text-slate-500">{row.normalized_data?.employee_code || "-"}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <p>{row.normalized_data?.site_name || "-"}</p>
                      <p>{row.normalized_data?.department_name || "-"} / {row.normalized_data?.designation_name || "-"}</p>
                    </td>
                    <td className="px-4 py-3"><Badge value={row.validation_status} /></td>
                    <td className="px-4 py-3"><Badge value={row.import_status} /></td>
                    <td className="px-4 py-3 text-xs">
                      {[...(row.errors || []), ...(row.warnings || [])].length === 0 ? (
                        <span className="text-slate-400">-</span>
                      ) : (
                        <div className="space-y-3">
                          <ul className="list-disc space-y-1 pl-4 text-slate-600">
                            {[...(row.errors || []), ...(row.warnings || [])].map((issue, index) => <li key={`${row.id}-${index}`}>{issue}</li>)}
                          </ul>
                          {canUpload && (row.errors || []).some((issue) => /date of birth/i.test(issue)) && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
                              <p className="font-semibold">DOB correction required</p>
                              <p className="mt-1 text-[11px]">Original workbook value is preserved in raw data. Correct the normalized DOB or clear it with acknowledgement before import.</p>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <input
                                  type="date"
                                  value={dobEdits[row.id] ?? row.normalized_data?.date_of_birth ?? ""}
                                  onChange={(event) => setDobEdits((prev) => ({ ...prev, [row.id]: event.target.value }))}
                                  disabled={loading}
                                  className="h-9 rounded-lg border bg-white px-2 text-xs text-slate-900"
                                />
                                <button
                                  type="button"
                                  onClick={() => saveDobCorrection(row)}
                                  disabled={loading}
                                  className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                                >
                                  Save DOB
                                </button>
                                <button
                                  type="button"
                                  onClick={() => saveDobCorrection(row, true)}
                                  disabled={loading}
                                  className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                                >
                                  Clear with warning
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">Upload a workbook to preview employee rows.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}

function Summary({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 truncate text-lg font-bold text-slate-950">{value}</p>
      <p className="text-xs text-slate-500">{detail}</p>
    </div>
  );
}

function Badge({ value }: { value: string }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(value)}`}>
      {labelize(value)}
    </span>
  );
}

function normalizeMasterText(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function masterMappingKey(value: unknown) {
  return normalizeMasterText(value);
}

function uniqueValues(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
}

function MasterMappingGroup({
  title,
  sourceValues,
  options,
  optionLabel,
  mappings,
  onChange,
  disabled,
}: {
  title: string;
  sourceValues: string[];
  options: any[];
  optionLabel: (row: any) => string;
  mappings: Record<string, string>;
  onChange: (sourceValue: string, targetId: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="rounded-xl border bg-slate-50 p-4">
      <h3 className="text-sm font-bold text-slate-950">{title}</h3>
      <div className="mt-3 space-y-2">
        {sourceValues.length === 0 ? (
          <p className="text-xs text-slate-500">No source values found.</p>
        ) : sourceValues.map((source) => (
          <label key={`${title}-${source}`} className="grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{source}</span>
            <select
              value={mappings[masterMappingKey(source)] || ""}
              onChange={(event) => onChange(source, event.target.value)}
              disabled={disabled}
              className="h-10 rounded-xl border bg-white px-3 text-sm"
            >
              <option value="">Auto match by name/code</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>{optionLabel(option)}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}
