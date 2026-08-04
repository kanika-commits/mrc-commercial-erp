"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronRight, Play, RefreshCw, Upload } from "lucide-react";
import AlertMessage from "@/components/AlertMessage";
import HrSectionNav from "@/components/hr/HrSectionNav";
import { apiFetch, getAccessToken, labelize } from "@/components/hr/hrClient";
import { useHrLookups } from "@/components/hr/useHrLookups";
import { can } from "@/lib/accessControl";
import { useAccessContext } from "@/components/AccessContext";

type Batch = {
  id: string;
  original_file_name: string;
  sheet_name?: string | null;
  status: string;
  summary?: Record<string, number>;
};

type Row = {
  id: string;
  source_row_number: number;
  employee_code?: string | null;
  employee_name?: string | null;
  source_site?: string | null;
  source_column: string;
  source_drive_url: string;
  drive_file_id?: string | null;
  document_type: string;
  selected_action: string;
  validation_status: string;
  validation_errors: string[];
  validation_warnings: string[];
  execution_status: string;
  execution_error?: string | null;
  matched_employee_id?: string | null;
  matched_employee?: {
    id: string;
    employee_code?: string | null;
    employee_name?: string | null;
  } | null;
  document_metadata?: {
    source_father_name?: string | null;
    [key: string]: unknown;
  } | null;
};

type EmployeePreviewGroup = {
  key: string;
  sourceRowNumber: number;
  employeeName: string;
  fatherName: string;
  sourceSite: string;
  matchedEmployee?: Row["matched_employee"];
  matchStatus: "matched" | "not_found" | "multiple" | "pending";
  rows: Row[];
  ready: number;
  warning: number;
  invalid: number;
  imported: number;
  failed: number;
  skipped: number;
};

function statusClass(status: string) {
  if (["ready", "imported", "completed"].includes(status)) return "bg-emerald-50 text-emerald-700";
  if (["invalid", "failed", "completed_with_errors"].includes(status)) return "bg-red-50 text-red-700";
  if (["warning", "validated"].includes(status)) return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

function validationDisplayStatus(row: Row) {
  if (row.validation_status === "invalid") return "invalid";
  if ((row.validation_warnings || []).length > 0) return "warning";
  return row.validation_status;
}

function isExecutableRow(row: Row) {
  return row.validation_status === "ready" && row.execution_status === "pending" && row.selected_action !== "skip";
}

function rowMessages(row: Row) {
  return [...(row.validation_errors || []), ...(row.validation_warnings || [])];
}

function isNotFound(row: Row) {
  return (row.validation_errors || []).includes("Employee not found.");
}

function isMultipleMatch(row: Row) {
  return (row.validation_errors || []).includes("Multiple employees found.");
}

function employeeMatchStatus(rows: Row[]): EmployeePreviewGroup["matchStatus"] {
  if (rows.some(isMultipleMatch)) return "multiple";
  if (rows.some(isNotFound)) return "not_found";
  if (rows.some((row) => row.matched_employee_id)) return "matched";
  return "pending";
}

function groupKey(row: Row) {
  return `${row.source_row_number}-${row.employee_name || ""}-${row.document_metadata?.source_father_name || ""}`;
}

export default function EmployeeDocumentImportPage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const canView = can(permissions, "hr_employee_document_import", "view");
  const canUpload = can(permissions, "hr_employee_document_import", "upload");
  const canExecute = can(permissions, "hr_employee_document_import", "execute");
  const lookups = useHrLookups({ includeEmployees: false });
  const [companyId, setCompanyId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState("all");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [savingRows, setSavingRows] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");

  const visibleSites = useMemo(
    () => companyId ? lookups.sites.filter((site) => !site.meta || site.meta === companyId) : lookups.sites,
    [companyId, lookups.sites],
  );
  const employeeGroups = useMemo<EmployeePreviewGroup[]>(() => {
    const grouped = new Map<string, Row[]>();
    for (const row of rows) grouped.set(groupKey(row), [...(grouped.get(groupKey(row)) || []), row]);
    return Array.from(grouped.entries())
      .map(([key, groupRows]) => {
        const first = groupRows[0];
        const matchStatus = employeeMatchStatus(groupRows);
        return {
          key,
          sourceRowNumber: first.source_row_number,
          employeeName: first.employee_name || "-",
          fatherName: first.document_metadata?.source_father_name || "-",
          sourceSite: first.source_site || "-",
          matchedEmployee: groupRows.find((row) => row.matched_employee)?.matched_employee || null,
          matchStatus,
          rows: groupRows,
          ready: groupRows.filter(isExecutableRow).length,
          warning: groupRows.filter((row) => (row.validation_warnings || []).length > 0).length,
          invalid: groupRows.filter((row) => row.validation_status === "invalid").length,
          imported: groupRows.filter((row) => row.execution_status === "imported").length,
          failed: groupRows.filter((row) => row.execution_status === "failed").length,
          skipped: groupRows.filter((row) => row.execution_status === "skipped").length,
        };
      })
      .sort((a, b) => a.sourceRowNumber - b.sourceRowNumber);
  }, [rows]);
  const employeeSummary = useMemo(() => ({
    employees: employeeGroups.length,
    matched: employeeGroups.filter((group) => group.matchStatus === "matched").length,
    not_found: employeeGroups.filter((group) => group.matchStatus === "not_found").length,
    multiple: employeeGroups.filter((group) => group.matchStatus === "multiple").length,
    documents: rows.length,
    ready: rows.filter(isExecutableRow).length,
    invalid: rows.filter((row) => row.validation_status === "invalid").length,
    imported: rows.filter((row) => row.execution_status === "imported").length,
  }), [employeeGroups, rows]);
  const filteredGroups = employeeGroups.filter((group) => {
    const matchesRowFilter = (row: Row) => {
      if (filter === "ready") return isExecutableRow(row);
      if (filter === "warnings") return (row.validation_warnings || []).length > 0;
      if (filter === "errors") return row.validation_status === "invalid";
      if (filter === "imported") return row.execution_status === "imported";
      if (filter === "failed") return row.execution_status === "failed";
      return true;
    };
    return group.rows.some(matchesRowFilter);
  });
  const canRun = Boolean(batch && canExecute && rows.some(isExecutableRow));

  function toggleGroup(key: string) {
    setExpandedGroups((current) => ({ ...current, [key]: !current[key] }));
  }

  async function loadPreview(batchId: string) {
    const result = await apiFetch(`/api/hr/employee-document-import/preview?batch_id=${batchId}&page_size=200`);
    setBatch(result.batch);
    setRows(result.rows || []);
  }

  async function uploadWorkbook() {
    if (!canUpload) return;
    if (!companyId || !siteId || !file) {
      setMessage("Select company, site and workbook before upload.");
      return;
    }

    setLoading(true);
    setMessage("");
    setSuccess("");
    try {
      const token = await getAccessToken();
      const form = new FormData();
      form.append("company_id", companyId);
      form.append("site_id", siteId);
      if (sheetName.trim()) form.append("sheet_name", sheetName.trim());
      form.append("file", file);
      const response = await fetch("/api/hr/employee-document-import/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Workbook upload failed.");
      setBatch(result.batch);
      setSuccess(`Parsed ${result.file_rows || 0} document link row(s) from ${result.batch?.sheet_name || "workbook"}.`);
      await loadPreview(result.batch.id);
    } catch (error: any) {
      setMessage(error.message || "Failed to upload workbook.");
    } finally {
      setLoading(false);
    }
  }

  async function validateBatch() {
    if (!batch || !canUpload) return;
    setLoading(true);
    setMessage("");
    try {
      await apiFetch("/api/hr/employee-document-import/validate", {
        method: "POST",
        body: JSON.stringify({ batch_id: batch.id }),
      });
      await loadPreview(batch.id);
      setSuccess("Document import rows revalidated.");
    } catch (error: any) {
      setMessage(error.message || "Validation failed.");
    } finally {
      setLoading(false);
    }
  }

  async function updateAction(row: Row, selectedAction: string) {
    if (!batch || !canUpload) return;
    setMessage("");
    const previousRows = rows;
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, selected_action: selectedAction } : item));
    setSavingRows((current) => ({ ...current, [row.id]: true }));
    try {
      const result = await apiFetch(`/api/hr/employee-document-import/rows/${row.id}`, {
        method: "PUT",
        body: JSON.stringify({ batch_id: batch.id, selected_action: selectedAction }),
      });
      if (result.row) {
        setRows((current) => current.map((item) => item.id === row.id ? { ...item, ...result.row } : item));
      }
    } catch (error: any) {
      setRows(previousRows);
      setMessage(error.message || "Failed to update row action.");
    } finally {
      setSavingRows((current) => ({ ...current, [row.id]: false }));
    }
  }

  async function executeBatch() {
    if (!batch || !canRun) return;
    if (!window.confirm("Import confirmed document rows now? Apps Script download support must already be deployed.")) return;
    setLoading(true);
    setMessage("");
    setSuccess("");
    try {
      const result = await apiFetch("/api/hr/employee-document-import/execute", {
        method: "POST",
        body: JSON.stringify({ batch_id: batch.id }),
      });
      setBatch(result.batch);
      await loadPreview(batch.id);
      setSuccess(`Execution finished. Imported: ${result.summary?.imported || 0}, failed: ${result.summary?.failed || 0}.`);
    } catch (error: any) {
      setMessage(error.message || "Execution failed.");
    } finally {
      setLoading(false);
    }
  }

  if (!canView && !canUpload) {
    return (
      <section className="space-y-6">
        <HrSectionNav />
        <div className="rounded-2xl border bg-white p-8 text-sm text-slate-500 shadow-sm">
          You do not have permission to access employee document imports.
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
            Employee Document Import
          </div>
          <h1 className="text-3xl font-bold text-slate-950">Site-wise Employee Document Import</h1>
          <p className="max-w-3xl text-sm text-slate-500">Upload one site workbook, preview Drive links, choose duplicate actions and import files into private employee documents.</p>
        </div>
        <Link href="/hr/employees" className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" />
          Back to Employees
        </Link>
      </header>
      <HrSectionNav />

      <AlertMessage type="error" message={message || lookups.error} onClose={() => setMessage("")} />
      <AlertMessage type="success" message={success} onClose={() => setSuccess("")} />

      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr_1.5fr_auto]">
          <Select label="Company" value={companyId} onChange={(value) => { setCompanyId(value); setSiteId(""); }} options={lookups.companies} />
          <Select label="Site" value={siteId} onChange={setSiteId} options={visibleSites} />
          <label>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Sheet Name</span>
            <input value={sheetName} onChange={(event) => setSheetName(event.target.value)} placeholder="Optional" className="h-10 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400" />
          </label>
          <label>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Workbook</span>
            <input type="file" accept=".xlsx,.xlsm" onChange={(event) => setFile(event.target.files?.[0] || null)} className="h-10 w-full rounded-xl border px-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold" />
          </label>
          <button type="button" disabled={loading || !canUpload} onClick={uploadWorkbook} className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
            <Upload className="h-4 w-4" />
            Upload
          </button>
        </div>
      </section>

      {batch && (
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{batch.original_file_name}</h2>
              <p className="text-sm text-slate-500">Sheet: {batch.sheet_name || "-"} · Status: {labelize(batch.status)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={validateBatch} disabled={loading || !canUpload} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">
                <RefreshCw className="h-4 w-4" />
                Revalidate
              </button>
              <button type="button" onClick={executeBatch} disabled={loading || !canRun} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                <Play className="h-4 w-4" />
                Execute
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-4 xl:grid-cols-8">
            {[
              ["employees", "Employees in workbook"],
              ["matched", "Employees matched"],
              ["not_found", "Employees not found"],
              ["multiple", "Multiple matches"],
              ["documents", "Total documents"],
              ["ready", "Documents ready"],
              ["invalid", "Documents invalid"],
              ["imported", "Documents imported"],
            ].map(([key, label]) => (
              <div key={key} className="rounded-xl border bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-1 text-xl font-bold text-slate-950">{Number(employeeSummary[key as keyof typeof employeeSummary] || 0)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Preview</h2>
            <p className="text-sm text-slate-500">Employees are grouped first. Expand an employee to review each document link.</p>
          </div>
          <select value={filter} onChange={(event) => setFilter(event.target.value)} className="h-10 rounded-xl border px-3 text-sm">
            <option value="all">All</option>
            <option value="ready">Ready</option>
            <option value="warnings">Warnings</option>
            <option value="errors">Errors</option>
            <option value="imported">Imported</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1300px] w-full text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Row</th>
                <th className="px-4 py-3">Excel Employee</th>
                <th className="px-4 py-3">Father's Name</th>
                <th className="px-4 py-3">Source Site</th>
                <th className="px-4 py-3">Matched ERP Employee</th>
                <th className="px-4 py-3">Match</th>
                <th className="px-4 py-3">Docs</th>
                <th className="px-4 py-3">Ready</th>
                <th className="px-4 py-3">Warning</th>
                <th className="px-4 py-3">Invalid</th>
                <th className="px-4 py-3">Execution</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredGroups.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-8 text-center text-slate-500">Upload a workbook to preview document links.</td></tr>
              ) : filteredGroups.map((group) => (
                <Fragment key={group.key}>
                  <tr className="bg-white">
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => toggleGroup(group.key)} className="inline-flex items-center gap-2 font-semibold text-slate-950">
                        {expandedGroups[group.key] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        {group.sourceRowNumber}
                      </button>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-950">{group.employeeName}</td>
                    <td className="px-4 py-3">{group.fatherName}</td>
                    <td className="px-4 py-3">{group.sourceSite}</td>
                    <td className="px-4 py-3">
                      {group.matchedEmployee ? (
                        <>
                          <p className="font-semibold text-slate-950">{group.matchedEmployee.employee_name || "-"}</p>
                          <p className="text-xs text-slate-500">{group.matchedEmployee.employee_code || group.matchedEmployee.id}</p>
                        </>
                      ) : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${group.matchStatus === "matched" ? "bg-emerald-50 text-emerald-700" : group.matchStatus === "pending" ? "bg-slate-100 text-slate-700" : "bg-red-50 text-red-700"}`}>
                        {labelize(group.matchStatus)}
                      </span>
                    </td>
                    <td className="px-4 py-3">{group.rows.length}</td>
                    <td className="px-4 py-3">{group.ready}</td>
                    <td className="px-4 py-3">{group.warning}</td>
                    <td className="px-4 py-3">{group.invalid}</td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-slate-500">Imported {group.imported} · Failed {group.failed} · Skipped {group.skipped}</p>
                    </td>
                  </tr>
                  {expandedGroups[group.key] && (
                    <tr key={`${group.key}-details`} className="bg-slate-50">
                      <td colSpan={11} className="px-4 py-4">
                        <table className="w-full text-left text-xs">
                          <thead className="uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="px-3 py-2">Source Column</th>
                              <th className="px-3 py-2">Document Type</th>
                              <th className="px-3 py-2">Drive File</th>
                              <th className="px-3 py-2">Validation</th>
                              <th className="px-3 py-2">Action</th>
                              <th className="px-3 py-2">Execution</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {group.rows.map((row) => (
                              <tr key={row.id}>
                                <td className="px-3 py-2">{row.source_column}</td>
                                <td className="px-3 py-2">{row.document_type}</td>
                                <td className="max-w-[220px] px-3 py-2">
                                  <p className="truncate text-slate-500">{row.drive_file_id || "-"}</p>
                                  <a href={row.source_drive_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-sky-700 hover:underline">Source link</a>
                                </td>
                                <td className="px-3 py-2">
                                  <span className={`rounded-full px-2.5 py-1 font-semibold ${statusClass(validationDisplayStatus(row))}`}>{labelize(validationDisplayStatus(row))}</span>
                                  {rowMessages(row).length > 0 && (
                                    <ul className="mt-2 space-y-1 text-slate-500">
                                      {rowMessages(row).map((item) => <li key={item}>{item}</li>)}
                                    </ul>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  <select value={row.selected_action} onChange={(event) => updateAction(row, event.target.value)} disabled={!canUpload || row.execution_status === "imported" || savingRows[row.id]} className="h-9 rounded-xl border bg-white px-2">
                                    <option value="pending">Pending</option>
                                    <option value="skip">Skip</option>
                                    <option value="new_version">New Version</option>
                                  </select>
                                  {savingRows[row.id] && <p className="mt-1 text-slate-500">Saving...</p>}
                                </td>
                                <td className="px-3 py-2">
                                  <span className={`rounded-full px-2.5 py-1 font-semibold ${statusClass(row.execution_status)}`}>{labelize(row.execution_status)}</span>
                                  {row.execution_error && <p className="mt-1 text-red-600">{row.execution_error}</p>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ id: string; label: string }> }) {
  return (
    <label>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400">
        <option value="">Select {label}</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  );
}
