"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function LabourAttendanceImportPage() {
  const [lookups, setLookups] = useState<any>({ companies: [], sites: [], contractors: [] });
  const [file, setFile] = useState<File | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [contractorProfileId, setContractorProfileId] = useState("");
  const [periodMonth, setPeriodMonth] = useState("");
  const [batchId, setBatchId] = useState("");
  const [preview, setPreview] = useState<any>({ rows: [] });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function token() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  }

  async function parseResponse(response: Response) {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { error: text || "Request failed." };
    }
  }

  useEffect(() => {
    token()
      .then((t) => fetch("/api/labour/lookups?purpose=labour_attendance", { headers: { Authorization: `Bearer ${t}` } }))
      .then((r) => r.json())
      .then(setLookups)
      .catch((error) => setMessage(error.message || "Failed to load lookups."));
  }, []);

  const sites = useMemo(() => lookups.sites || [], [lookups.sites]);

  async function upload() {
    if (!file) return setMessage("Select an attendance workbook first.");
    if (!companyId || !siteId) return setMessage("Company and site are required.");
    setLoading(true);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("company_id", companyId);
      body.set("site_id", siteId);
      if (contractorProfileId) body.set("contractor_profile_id", contractorProfileId);
      if (periodMonth) body.set("period_month", periodMonth);
      const response = await fetch("/api/labour/attendance-import/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${await token()}` },
        body,
      });
      const payload = await parseResponse(response);
      if (!response.ok) return setMessage(payload.error || "Upload failed.");
      setBatchId(payload.batch_id);
      setMessage(`Uploaded ${payload.rows} attendance rows from ${payload.sheet_name}.`);
      setPreview({ rows: [] });
    } finally {
      setLoading(false);
    }
  }

  async function validate() {
    if (!batchId) return;
    setLoading(true);
    try {
      const response = await fetch("/api/labour/attendance-import/validate", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ batch_id: batchId }),
      });
      const payload = await parseResponse(response);
      if (!response.ok) return setMessage(payload.error || "Validation failed.");
      setMessage(`Ready ${payload.summary.ready_rows}, blocked ${payload.summary.blocked_rows}.`);
      await loadPreview();
    } finally {
      setLoading(false);
    }
  }

  async function loadPreview() {
    if (!batchId) return;
    const response = await fetch(`/api/labour/attendance-import/preview?batch_id=${batchId}`, {
      headers: { Authorization: `Bearer ${await token()}` },
    });
    const payload = await parseResponse(response);
    if (response.ok) setPreview(payload);
    else setMessage(payload.error || "Preview failed.");
  }

  async function execute() {
    if (!window.confirm("Execute ready labour attendance import rows?")) return;
    setLoading(true);
    try {
      const response = await fetch("/api/labour/attendance-import/execute", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ batch_id: batchId }),
      });
      const payload = await parseResponse(response);
      if (!response.ok) return setMessage(payload.error || "Execute failed.");
      setMessage(`Executed ${payload.executed}, failed ${payload.failed}.`);
      await loadPreview();
    } finally {
      setLoading(false);
    }
  }

  async function downloadReport() {
    if (!batchId) return;
    const response = await fetch(`/api/labour/attendance-import/report?batch_id=${batchId}`, {
      headers: { Authorization: `Bearer ${await token()}` },
    });
    const text = await response.text();
    if (!response.ok) return setMessage(text || "Report download failed.");
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `labour-attendance-import-${batchId}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function setRowAction(rowId: string, selectedAction: "import" | "skip") {
    const previousRows = preview.rows || [];
    setPreview({
      ...preview,
      rows: previousRows.map((row: any) => row.id === rowId ? { ...row, selected_action: selectedAction } : row),
    });
    const response = await fetch(`/api/labour/attendance-import/rows/${rowId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ selected_action: selectedAction }),
    });
    if (!response.ok) {
      const payload = await parseResponse(response);
      setPreview({ ...preview, rows: previousRows });
      setMessage(payload.error || "Failed to update row action.");
    }
  }

  const rows = preview.rows || [];
  const summary = {
    total: rows.length,
    ready: rows.filter((row: any) => ["ready", "warning"].includes(row.validation_status) && row.selected_action === "import").length,
    blocked: rows.filter((row: any) => row.validation_status === "blocked").length,
    executed: rows.filter((row: any) => row.execution_status === "executed").length,
  };

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 md:px-10">
      <div className="mx-auto max-w-[1400px] space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Labour Attendance Import</p>
            <h1 className="text-3xl font-semibold">Labour Attendance Import</h1>
            <p className="text-sm text-slate-600">Upload monthly muster or transaction-format attendance, validate, preview and execute.</p>
          </div>
          <Link href="/labour" className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold">Back to Labour</Link>
        </header>

        {message && <div className="rounded-lg border bg-white p-3 text-sm font-semibold">{message}</div>}

        <section className="grid gap-3 rounded-lg border bg-white p-4 shadow-sm md:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto_auto_auto]">
          <input type="file" accept=".xlsx,.xlsm" onChange={(e) => setFile(e.target.files?.[0] || null)} className="h-11 rounded-lg border px-3 py-2" />
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="h-11 rounded-lg border px-3">
            <option value="">Select company</option>
            {lookups.companies.map((company: any) => <option key={company.id} value={company.id}>{company.company_name}</option>)}
          </select>
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="h-11 rounded-lg border px-3">
            <option value="">Select site</option>
            {sites.map((site: any) => <option key={site.id} value={site.id}>{site.site_name}</option>)}
          </select>
          <select value={contractorProfileId} onChange={(e) => setContractorProfileId(e.target.value)} className="h-11 rounded-lg border px-3">
            <option value="">All Contractors</option>
            {lookups.contractors.map((contractor: any) => <option key={contractor.id} value={contractor.id}>{contractor.vendors?.vendor_name || contractor.contractor_code}</option>)}
          </select>
          <input type="month" value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value)} className="h-11 rounded-lg border px-3" />
          <button disabled={loading} onClick={upload} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 font-semibold text-white"><Upload className="h-4 w-4" />Upload</button>
          <button disabled={loading || !batchId} onClick={validate} className="rounded-lg border bg-white px-4 font-semibold">Validate</button>
          <button disabled={loading || !batchId || summary.ready === 0} onClick={execute} className="rounded-lg bg-emerald-700 px-4 font-semibold text-white disabled:opacity-50">Execute</button>
        </section>

        {batchId && (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={loadPreview} className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold">Refresh Preview</button>
            <button onClick={downloadReport} className="inline-flex items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm font-semibold"><Download className="h-4 w-4" /> Error Report</button>
            <span className="text-sm text-slate-600">Rows: {summary.total} · Ready: {summary.ready} · Blocked: {summary.blocked} · Executed: {summary.executed}</span>
          </div>
        )}

        <section className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>{["Row", "Column", "Labour Code", "Worker", "Date", "Code", "Validation", "Warnings", "Errors", "Action", "Execution"].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row: any) => (
                <tr key={row.id}>
                  <td className="px-3 py-3">{row.source_row_number}</td>
                  <td className="px-3 py-3">{row.source_column || "-"}</td>
                  <td className="px-3 py-3">{row.labour_code || "-"}</td>
                  <td className="px-3 py-3">{row.worker_name || "-"}</td>
                  <td className="px-3 py-3">{row.attendance_date || "-"}</td>
                  <td className="px-3 py-3">{row.attendance_code || "-"}</td>
                  <td className="px-3 py-3">{row.validation_status}</td>
                  <td className="px-3 py-3">{(row.validation_warnings || []).join("; ")}</td>
                  <td className="px-3 py-3 text-red-600">{(row.validation_errors || []).join("; ")}</td>
                  <td className="px-3 py-3">
                    <select value={row.selected_action || "import"} onChange={(e) => setRowAction(row.id, e.target.value as "import" | "skip")} className="h-9 rounded-lg border px-2">
                      <option value="import">Import</option>
                      <option value="skip">Skip</option>
                    </select>
                  </td>
                  <td className="px-3 py-3">{row.execution_status}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-500">Upload and validate a workbook to preview attendance rows.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </section>
  );
}
