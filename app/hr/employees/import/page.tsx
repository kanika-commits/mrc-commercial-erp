"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Play, RefreshCw, Upload } from "lucide-react";
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
  import_result?: Record<string, any> | null;
  final_status?: string;
  reason?: string;
};

const FIELD_OPTIONS = [
  ["", "Do not import"],
  ["source_serial_no", "SrNo"],
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
  ["employee_photo_drive_url", "Employee Photo Drive Link"],
  ["aadhaar_front_drive_url", "Aadhaar Front Drive Link"],
  ["aadhaar_back_drive_url", "Aadhaar Back Drive Link"],
  ["aadhaar_combined_drive_url", "Combined Aadhaar Drive Link"],
  ["pan_drive_url", "PAN Drive Link"],
  ["bank_proof_drive_url", "Bank Proof Drive Link"],
  ["resume_drive_url", "Resume Drive Link"],
  ["offer_letter_drive_url", "Offer Letter Drive Link"],
  ["appointment_letter_drive_url", "Appointment Letter Drive Link"],
  ["experience_letter_drive_url", "Experience Letter Drive Link"],
  ["education_certificate_drive_url", "Education Certificate Drive Link"],
  ["medical_certificate_drive_url", "Medical Certificate Drive Link"],
  ["police_verification_drive_url", "Police Verification Drive Link"],
  ["other_document_drive_url", "Other Document Drive Link"],
  ["legacy_remark", "Remark"],
];

const MASTER_MAPPING_KEY = "__master_mappings";

function statusClass(status: string) {
  if (["ready", "valid", "imported", "completed", "imported_successfully"].includes(status)) return "bg-emerald-50 text-emerald-700";
  if (["invalid", "failed", "completed_with_errors", "validation_failed", "import_failed"].includes(status)) return "bg-red-50 text-red-700";
  if (["warning", "validated", "already_exists", "skipped"].includes(status)) return "bg-amber-50 text-amber-700";
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
  const [mappingDirty, setMappingDirty] = useState(false);
  const [importSummary, setImportSummary] = useState<Record<string, number> | null>(null);
  const [importReportRows, setImportReportRows] = useState<ImportRow[] | null>(null);
  const [importProgress, setImportProgress] = useState("");

  const headers = useMemo(() => Object.keys(mapping).filter((header) => header !== MASTER_MAPPING_KEY), [mapping]);
  const summary = batch?.summary || {};
  const readyImportRows = useMemo(
    () => rows.filter((row) => isReadyForImport(row)),
    [rows],
  );
  const readyImportRowCount = rows.length > 0 ? readyImportRows.length : Number(summary.ready || 0);
  const importInProgress = loading || batch?.status === "executing";
  const executeDisabledReason = !batch
    ? "Upload and validate a workbook first."
    : !canExecute
      ? "You do not have permission to execute employee imports."
      : mappingDirty
          ? "Save mapping changes before importing."
          : importInProgress
            ? "Batch is currently importing."
            : readyImportRowCount <= 0
              ? "No Ready rows are available to import."
              : "";
  const canRunImport = Boolean(batch && canExecute && !mappingDirty && !importInProgress && readyImportRowCount > 0);
  const notImportedRows = useMemo(
    () => (importReportRows || rows).filter((row) => row.import_status !== "imported"),
    [importReportRows, rows],
  );
  const shouldShowImportSummary = Boolean(importSummary || (batch && ["completed", "completed_with_errors"].includes(batch.status)));
  const importCompleted = Boolean(batch && shouldShowImportSummary);
  const displayedRows = importCompleted ? (importReportRows || rows) : rows;
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
    setMappingDirty(false);
  }

  async function loadImportReport(batchId: string) {
    const result = await apiFetch(`/api/hr/employee-import/report?batch_id=${batchId}`);
    setImportSummary(result.summary || null);
    setImportReportRows(result.rows || []);
  }

  function updateMasterMapping(group: string, sourceValue: string, targetId: string) {
    const sourceKey = masterMappingKey(sourceValue);
    setMappingDirty(true);
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
    setImportProgress("");
    setImportSummary(null);
    setImportReportRows(null);

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
      setMappingDirty(false);
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
    setImportProgress("");
    try {
      const result = await apiFetch("/api/hr/employee-import/mapping", {
        method: "PUT",
        body: JSON.stringify({ batch_id: batch.id, mapping }),
      });
      setBatch(result.batch);
      setMappingDirty(false);
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
      setMappingDirty(false);
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
    if (!window.confirm(`Import ${readyImportRowCount} ready employee${readyImportRowCount === 1 ? "" : "s"} from this batch? This cannot be undone from this screen.`)) return;
    setLoading(true);
    setMessage("");
    setSuccess("");
    setImportProgress(`Importing 0 / ${readyImportRowCount} employees...`);
    try {
      const result = await apiFetch("/api/hr/employee-import/execute", {
        method: "POST",
        body: JSON.stringify({ batch_id: batch.id }),
      });
      setBatch(result.batch);
      setImportSummary(result.summary || null);
      setImportProgress(`${result.summary?.imported || 0} / ${readyImportRowCount} imported.`);
      const generatedCodes = (result.results || []).map((row: any) => row.employeeCode || row.employee_code).filter(Boolean);
      setSuccess(`Import finished. Imported Successfully: ${result.summary?.imported || 0}, Already Exists: ${result.summary?.skipped || 0}, Validation Failed: ${result.summary?.invalid || 0}, Import Failed: ${result.summary?.failed || 0}.${generatedCodes.length ? ` Generated Employee Codes: ${generatedCodes.slice(0, 8).join(", ")}${generatedCodes.length > 8 ? ", ..." : ""}.` : ""}`);
      await loadPreview(batch.id);
      await loadImportReport(batch.id);
    } catch (error: any) {
      setMessage(error.message || "Failed to execute import.");
    } finally {
      setLoading(false);
    }
  }

  async function downloadRemainingWorkbook() {
    if (!batch) return;
    try {
      setMessage("");
      const token = await getAccessToken();
      const response = await fetch(`/api/hr/employee-import/remaining?batch_id=${batch.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to download remaining employees workbook.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "Download Remaining Employees.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      setMessage(error.message || "Failed to download remaining employees workbook.");
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
          <h1 className="text-3xl font-bold text-slate-950">Unified Employee Import</h1>
          <p className="text-sm text-slate-500">Upload the official workbook with employee details and direct Google Drive document links in the same row.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/templates/ConstructIQ_Employee_Import_Template.xlsx" className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">
            <Download className="h-4 w-4" />
            Download Official Template
          </a>
          <Link href="/hr/employees" className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" />
            Back to Employees
          </Link>
        </div>
      </header>

      <HrSectionNav />
      <AlertMessage type="error" message={message} onClose={() => setMessage("")} />
      <AlertMessage type="success" message={success} onClose={() => setSuccess("")} />

      {!importCompleted && (
      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Completed Employee Import Workbook</label>
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
      )}

      {batch && !importCompleted && (
        <section className="grid gap-4 lg:grid-cols-4">
          <Summary label="Batch" value={batch.source_file_name} detail={batch.source_sheet_name || "-"} />
          <Summary label="Status" value={labelize(batch.status)} detail={formatDate(batch.created_at)} />
          <Summary label="Rows" value={String(summary.total || total || 0)} detail={`${summary.ready || 0} ready`} />
          <Summary label="Issues" value={String(summary.invalid || 0)} detail={`${summary.failed || 0} failed imports`} />
          <Summary label="Documents" value={String(summary.documents_found || 0)} detail={`${summary.document_errors || 0} document errors`} />
        </section>
      )}

      {batch && !importCompleted && headers.length > 0 && (
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
                  onChange={(event) => {
                    setMappingDirty(true);
                    setMapping((prev) => ({ ...prev, [header]: event.target.value }));
                  }}
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
              <div className="text-right">
                <button type="button" onClick={executeBatch} disabled={!canRunImport} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                  <Play className="h-4 w-4" />
                  {readyImportRowCount > 0 ? `Import ${readyImportRowCount} Employee${readyImportRowCount === 1 ? "" : "s"}` : "Execute Import"}
                </button>
                {!canRunImport && executeDisabledReason && (
                  <p className="mt-1 max-w-xs text-xs text-slate-500">{executeDisabledReason}</p>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {importProgress && !importCompleted && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm font-semibold text-sky-800">
          {importProgress}
        </div>
      )}

      {batch && shouldShowImportSummary && (
        <section className="rounded-2xl border bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
            <div>
              <h2 className="text-lg font-bold text-slate-950">Import Summary</h2>
              <p className="text-sm text-slate-500">Every row ends in Imported Successfully, Already Exists, Validation Failed or Import Failed.</p>
            </div>
            {notImportedRows.length > 0 && (
              <button
                type="button"
                onClick={downloadRemainingWorkbook}
                className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
              >
                <Download className="h-4 w-4" />
                Download Remaining Employees.xlsx
              </button>
            )}
          </div>
          <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-5">
            <Summary label="Total Rows" value={String((importSummary || summary).total || total || 0)} detail="Rows staged from workbook" />
            <Summary label="Imported Successfully" value={String((importSummary || summary).imported || 0)} detail="Employee records created" />
            <Summary label="Already Exists" value={String((importSummary || summary).skipped || 0)} detail="Skipped idempotently" />
            <Summary label="Validation Failed" value={String((importSummary || summary).invalid || 0)} detail="Not imported" />
            <Summary label="Import Failed" value={String((importSummary || summary).failed || 0)} detail="Ready row failures" />
          </div>
        </section>
      )}

      {batch && !importCompleted && (
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
              <h2 className="text-lg font-bold text-slate-950">{importCompleted ? "Import Results" : "Preview Rows"}</h2>
              <p className="text-sm text-slate-500">
                {importCompleted
                  ? "Final status for every staged employee row."
                  : "Showing the first 100 staged rows. Ready rows can be imported while invalid rows remain for correction."}
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                {importCompleted ? (
                  <tr>
                    <th className="px-4 py-3">Generated Employee Code</th>
                    <th className="px-4 py-3">Employee Name</th>
                    <th className="px-4 py-3">Company</th>
                    <th className="px-4 py-3">Site</th>
                    <th className="px-4 py-3">Final Status</th>
                    <th className="px-4 py-3">Reason</th>
                  </tr>
                ) : (
                  <tr>
                    <th className="px-4 py-3">Row</th>
                    <th className="px-4 py-3">Employee Code</th>
                    <th className="px-4 py-3">Employee Name</th>
                    <th className="px-4 py-3">Company / Site</th>
                    <th className="px-4 py-3">Department / Designation</th>
                    <th className="px-4 py-3">Reporting Manager</th>
                    <th className="px-4 py-3">Documents</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Import</th>
                    <th className="px-4 py-3">Issues</th>
                  </tr>
                )}
              </thead>
              <tbody className="divide-y">
                {displayedRows.map((row) => (
                  importCompleted ? (
                    <tr key={row.id}>
                      <td className="px-4 py-3 font-mono text-xs">{row.import_result?.employeeCode || row.import_result?.employee_code || row.normalized_data?.employee_code || "-"}</td>
                      <td className="px-4 py-3 font-semibold text-slate-950">{row.normalized_data?.employee_name || "-"}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">{row.normalized_data?.company_name || "-"}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">{row.normalized_data?.site_name || "-"}</td>
                      <td className="px-4 py-3"><Badge value={finalRowStatus(row)} /></td>
                      <td className="px-4 py-3 text-xs text-slate-600">{rowFailureReason(row)}</td>
                    </tr>
                  ) : (
                    <tr key={row.id}>
                      <td className="px-4 py-3 font-mono text-xs">{row.source_row_number}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">Generated automatically</td>
                      <td className="px-4 py-3 font-semibold text-slate-950">{row.normalized_data?.employee_name || "-"}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        <p>{row.normalized_data?.company_name || "-"}</p>
                        <p>{row.normalized_data?.site_name || "-"}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        <p>{row.normalized_data?.department_name || "-"} / {row.normalized_data?.designation_name || "-"}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{row.normalized_data?.reporting_manager_name || "-"}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">{row.normalized_data?.documents_found || 0}/{row.normalized_data?.documents_expected || 0}</td>
                      <td className="px-4 py-3"><Badge value={row.validation_status} /></td>
                      <td className="px-4 py-3"><Badge value={finalRowStatus(row)} /></td>
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
                  )
                ))}
                {displayedRows.length === 0 && (
                  <tr>
                    <td colSpan={importCompleted ? 6 : 10} className="px-4 py-8 text-center text-sm text-slate-500">
                      {importCompleted ? "No import result rows were returned." : "Upload a workbook to preview employee rows."}
                    </td>
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

function isReadyForImport(row: ImportRow) {
  return ["valid", "warning"].includes(row.validation_status) && row.import_status === "pending";
}

function rowFailureReason(row: ImportRow) {
  const issues = [...(row.errors || []), ...(row.warnings || [])].filter(Boolean);
  if (issues.length > 0) return issues.join("; ");
  if (row.reason) return row.reason;
  if (row.import_result?.message) return String(row.import_result.message);
  if (row.import_status === "skipped") return "Employee already exists.";
  if (row.import_status === "pending" && row.validation_status === "invalid") return "Row has validation issues.";
  if (row.import_status === "pending") return "Row was not selected for this import run.";
  return "Not imported.";
}

function finalRowStatus(row: ImportRow) {
  if (row.final_status) return row.final_status;
  if (row.import_status === "imported") return "imported_successfully";
  if (row.import_status === "skipped") return "already_exists";
  if (row.import_status === "failed") return "import_failed";
  if (row.validation_status === "invalid") return "validation_failed";
  return row.import_status || row.validation_status || "not_imported";
}

function suggestedAction(row: ImportRow, reason: string) {
  const text = reason.toLowerCase();
  if (row.import_status === "skipped" || text.includes("already exists")) return "No action needed unless the existing employee needs manual review.";
  if (text.includes("drive") || text.includes("document")) return "Check the Drive link and file access, then revalidate.";
  if (text.includes("company") || text.includes("site") || text.includes("department") || text.includes("designation")) return "Correct the master value or mapping, then save mapping and revalidate.";
  if (text.includes("date of birth") || text.includes("dob")) return "Correct the DOB or clear it with acknowledgement, then revalidate.";
  return "Correct the row value in the workbook or mapping, then revalidate/import again.";
}

function escapeReportCell(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function downloadNotImportedReport(rows: ImportRow[]) {
  const headers = [
    "Excel Row",
    "Generated Employee Code",
    "Employee Name",
    "Company",
    "Site",
    "Final Status",
    "Exact Reason",
    "Suggested Action",
  ];
  const body = rows.map((row) => {
    const reason = rowFailureReason(row);
    return [
      row.source_row_number,
      row.import_result?.employeeCode || row.import_result?.employee_code || row.normalized_data?.employee_code || "",
      row.normalized_data?.employee_name || "",
      row.normalized_data?.company_name || "",
      row.normalized_data?.site_name || "",
      labelize(finalRowStatus(row)),
      reason,
      suggestedAction(row, reason),
    ];
  });
  const tableRows = [headers, ...body]
    .map((cells) => `<tr>${cells.map((cell) => `<td>${escapeReportCell(cell)}</td>`).join("")}</tr>`)
    .join("");
  const html = `<html><head><meta charset="utf-8" /></head><body><table>${tableRows}</table></body></html>`;
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "Employee_Import_Not_Imported_Report.xls";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
