"use client";

import { useMemo, useState } from "react";
import type { EmployeeDocument } from "@/types/hr";
import { formatDate, getAccessToken } from "./hrClient";

export const employeeComplianceDocumentTypes = [
  "Employee Photo",
  "Aadhaar Card",
  "PAN Card",
  "Passport",
  "Driving Licence",
  "Voter ID",
  "ESIC Card",
  "PF Document",
  "Bank Proof",
  "Cancelled Cheque",
  "Employment Contract",
  "Offer Letter",
  "Appointment Letter",
  "Confirmation Letter",
  "Resignation Letter",
  "Relieving Letter",
  "Experience Letter",
  "Educational Certificate",
  "Professional Certificate",
  "Police Verification",
  "Medical Certificate",
  "Visa",
  "Work Permit",
  "Other",
];

type Props = {
  employeeId: string;
  documents: EmployeeDocument[];
  canEdit: boolean;
  uploading: boolean;
  onUploaded: (documents: EmployeeDocument[]) => void;
  onDelete: (document: EmployeeDocument) => void;
  onError: (message: string) => void;
  setUploading: (uploading: boolean) => void;
};

const initialForm = {
  document_type: "Aadhaar Card",
  document_number: "",
  issue_date: "",
  expiry_date: "",
  issuing_authority: "",
  issue_country: "",
  issue_state: "",
  remarks: "",
  qualification: "",
  university: "",
  passing_year: "",
  bank_name: "",
  account_number: "",
  ifsc: "",
  document_date: "",
  title: "",
};

function formatFileSize(size?: number | null) {
  if (!size) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function expiryStatus(expiry?: string | null) {
  if (!expiry) return { label: "No Expiry", className: "bg-slate-100 text-slate-700" };
  const today = new Date();
  const expiryDate = new Date(`${expiry}T00:00:00`);
  const days = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return { label: "Expired", className: "bg-red-100 text-red-700" };
  if (days <= 90) return { label: "Expiring Soon", className: "bg-amber-100 text-amber-700" };
  return { label: "Valid", className: "bg-emerald-100 text-emerald-700" };
}

export default function EmployeeComplianceDocuments({
  employeeId,
  documents,
  canEdit,
  uploading,
  onUploaded,
  onDelete,
  onError,
  setUploading,
}: Props) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [file, setFile] = useState<File | null>(null);
  const [historyType, setHistoryType] = useState("");

  const activeDocuments = useMemo(
    () => documents.filter((document) => document.is_active !== false),
    [documents],
  );
  const historyDocuments = useMemo(
    () => documents.filter((document) => document.document_type === historyType).sort((a, b) => Number(b.version || 1) - Number(a.version || 1)),
    [documents, historyType],
  );

  function update(name: string, value: string) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function submit() {
    if (!file) {
      onError("Upload file is required.");
      return;
    }

    setUploading(true);
    onError("");
    try {
      const token = await getAccessToken();
      const body = new FormData();
      Object.entries(form).forEach(([key, value]) => body.set(key, value));
      body.set("file", file);
      const response = await fetch(`/api/hr/employees/${employeeId}/documents`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Failed to upload employee document.");
      onUploaded(result.documents || []);
      setForm(initialForm);
      setFile(null);
      setShowForm(false);
    } catch (error: any) {
      onError(error.message || "Failed to upload employee document.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Documents & Compliance</h2>
          <p className="mt-1 text-sm text-slate-500">Add import-ready identity and compliance documents with version history.</p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setShowForm((prev) => !prev)}
            className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            + Add Document
          </button>
        )}
      </div>

      {showForm && canEdit && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Document Type">
              <select value={form.document_type} onChange={(event) => update("document_type", event.target.value)} className={inputClass}>
                {employeeComplianceDocumentTypes.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </Field>
            <Field label={numberLabel(form.document_type)}>
              <input value={form.document_number} onChange={(event) => update("document_number", event.target.value)} className={inputClass} />
            </Field>
            {form.document_type === "Passport" && (
              <Field label="Issue Country">
                <input value={form.issue_country} onChange={(event) => update("issue_country", event.target.value)} className={inputClass} />
              </Field>
            )}
            {form.document_type === "Driving Licence" && (
              <Field label="Issue State">
                <input value={form.issue_state} onChange={(event) => update("issue_state", event.target.value)} className={inputClass} />
              </Field>
            )}
            {needsIssueDate(form.document_type) && (
              <Field label="Issue Date">
                <input type="date" value={form.issue_date} onChange={(event) => update("issue_date", event.target.value)} className={inputClass} />
              </Field>
            )}
            {needsExpiryDate(form.document_type) && (
              <Field label="Expiry Date">
                <input type="date" value={form.expiry_date} onChange={(event) => update("expiry_date", event.target.value)} className={inputClass} />
              </Field>
            )}
            {form.document_type === "Educational Certificate" && (
              <>
                <Field label="Qualification">
                  <input value={form.qualification} onChange={(event) => update("qualification", event.target.value)} className={inputClass} />
                </Field>
                <Field label="University">
                  <input value={form.university} onChange={(event) => update("university", event.target.value)} className={inputClass} />
                </Field>
                <Field label="Passing Year">
                  <input value={form.passing_year} onChange={(event) => update("passing_year", event.target.value)} className={inputClass} />
                </Field>
              </>
            )}
            {form.document_type === "Bank Proof" && (
              <>
                <Field label="Bank Name">
                  <input value={form.bank_name} onChange={(event) => update("bank_name", event.target.value)} className={inputClass} />
                </Field>
                <Field label="Account Number">
                  <input value={form.account_number} onChange={(event) => update("account_number", event.target.value)} className={inputClass} />
                </Field>
                <Field label="IFSC">
                  <input value={form.ifsc} onChange={(event) => update("ifsc", event.target.value)} className={inputClass} />
                </Field>
              </>
            )}
            {needsDocumentDate(form.document_type) && (
              <Field label="Document Date">
                <input type="date" value={form.document_date} onChange={(event) => update("document_date", event.target.value)} className={inputClass} />
              </Field>
            )}
            {form.document_type === "Other" && (
              <Field label="Title">
                <input value={form.title} onChange={(event) => update("title", event.target.value)} className={inputClass} />
              </Field>
            )}
            <Field label="Issuing Authority">
              <input value={form.issuing_authority} onChange={(event) => update("issuing_authority", event.target.value)} className={inputClass} />
            </Field>
            <Field label="Upload File">
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} className={inputClass} />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Remarks">
              <textarea value={form.remarks} onChange={(event) => update("remarks", event.target.value)} className={textareaClass} />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50">Cancel</button>
            <button type="button" disabled={uploading} onClick={submit} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {uploading ? "Uploading..." : "Save Document"}
            </button>
          </div>
        </div>
      )}

      {activeDocuments.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          No compliance documents uploaded yet.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {activeDocuments.map((document) => {
            const status = expiryStatus(document.expiry_date);
            return (
              <article key={document.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-950">{document.document_type || "Document"}</h3>
                    <p className="mt-1 text-sm text-slate-500">{document.file_name || document.document_name || "Uploaded file"}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}>{status.label}</span>
                </div>
                <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                  <Meta label="Number" value={document.document_number || "-"} />
                  <Meta label="Version" value={`v${document.version || 1}`} />
                  <Meta label="Issue" value={formatDate(document.issue_date)} />
                  <Meta label="Expiry" value={formatDate(document.expiry_date)} />
                  <Meta label="Country" value={document.issue_country || "-"} />
                  <Meta label="State" value={document.issue_state || "-"} />
                  <Meta label="Size" value={formatFileSize(document.file_size)} />
                  <Meta label="Uploaded" value={formatDate(document.uploaded_at)} />
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  {document.signed_url && <a href={document.signed_url} target="_blank" rel="noopener noreferrer" className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-slate-50">View</a>}
                  {canEdit && <button type="button" onClick={() => { setForm((prev) => ({ ...prev, document_type: document.document_type || "Other" })); setShowForm(true); }} className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-slate-50">Replace</button>}
                  <button type="button" onClick={() => setHistoryType(historyType === document.document_type ? "" : document.document_type || "")} className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-slate-50">History</button>
                  {canEdit && <button type="button" onClick={() => onDelete(document)} className="rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50">Delete</button>}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {historyType && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-950">{historyType} Version History</h3>
          <div className="mt-4 space-y-3">
            {historyDocuments.map((document) => (
              <div key={document.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-sm">
                <div>
                  <p className="font-semibold text-slate-950">v{document.version || 1} {document.is_active !== false ? "(current)" : ""}</p>
                  <p className="text-slate-500">{document.file_name || document.document_name} · {formatDate(document.uploaded_at)}</p>
                </div>
                {document.signed_url && <a href={document.signed_url} target="_blank" rel="noopener noreferrer" className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-slate-50">Open</a>}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function numberLabel(type: string) {
  if (type === "PAN Card") return "PAN Number";
  if (type === "Aadhaar Card") return "Aadhaar Number";
  if (type === "Passport") return "Passport Number";
  if (type === "Driving Licence") return "Licence Number";
  return "Document Number";
}

function needsIssueDate(type: string) {
  return ["Passport", "Driving Licence", "Medical Certificate", "Visa", "Work Permit"].includes(type);
}

function needsExpiryDate(type: string) {
  return ["Passport", "Driving Licence", "Medical Certificate", "Visa", "Work Permit"].includes(type);
}

function needsDocumentDate(type: string) {
  return ["Offer Letter", "Appointment Letter", "Confirmation Letter", "Resignation Letter", "Relieving Letter", "Experience Letter"].includes(type);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
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
