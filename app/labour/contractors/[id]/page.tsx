"use client";

import Link from "next/link";
import { FileUp, Pencil } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAccessContext } from "@/components/AccessContext";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { LABOUR_CONTRACTOR_DOCUMENT_TYPES, labelFromCode } from "@/lib/labour/constants";
import { supabase } from "@/lib/supabase";

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function badgeClass(tone: string) {
  return tone === "red"
    ? "border-red-200 bg-red-50 text-red-700"
    : "border-amber-200 bg-amber-50 text-amber-700";
}

const contractorActivityLabels: Record<string, string> = {
  contractor_code: "Contractor Code",
  contractor_status: "Status",
  labour_licence_number: "Labour Licence No.",
  labour_licence_valid_to: "Licence Expiry",
  epf_registration_number: "EPF Registration",
  esi_registration_number: "ESIC Registration",
  remarks: "Remarks",
  change_reason: "Reason",
  document_type: "Document Type",
  version: "Version",
  file_name: "File Name",
};

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return "Updated";
  return String(value);
}

function activityChanges(log: any) {
  const oldValues = log.old_values || {};
  const newValues = log.new_values || {};
  return Array.from(new Set([...Object.keys(oldValues), ...Object.keys(newValues)]))
    .filter((field) => !["organization_id", "record_id", "id", "created_by", "updated_by"].includes(field))
    .filter((field) => oldValues[field] !== newValues[field])
    .map((field) => ({
      field,
      label: contractorActivityLabels[field] || field.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
      oldValue: formatValue(oldValues[field]),
      newValue: formatValue(newValues[field]),
    }));
}

async function parsePayload(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

export default function LabourContractorDetailPage() {
  const params = useParams<{ id: string }>();
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const global = hasGlobalAccess(access);
  const canEdit = global || can(permissions, "labour_contractors", "edit");
  const canViewDocuments = global || can(permissions, "labour_documents", "view");
  const canUpload = global || can(permissions, "labour_documents", "upload");
  const canDelete = global || can(permissions, "labour_documents", "delete");
  const [data, setData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "documents" | "activity">("overview");
  const [documentType, setDocumentType] = useState("Labour Licence");
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [showAdditionalCompliance, setShowAdditionalCompliance] = useState(false);
  const [showContractorDocuments, setShowContractorDocuments] = useState(false);
  const [vendorDocuments, setVendorDocuments] = useState<any[] | null>(null);
  const [vendorDocumentsLoading, setVendorDocumentsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [expandedLogId, setExpandedLogId] = useState("");
  const [activityLimit, setActivityLimit] = useState(10);

  async function token() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  }

  async function load() {
    const response = await fetch(`/api/labour/contractors/${params.id}`, { headers: { Authorization: `Bearer ${await token()}` } });
    const payload = await parsePayload(response);
    if (response.ok) setData(payload);
    else setError(payload.error || "Failed to load contractor.");
  }

  useEffect(() => { load(); }, [params.id]);

  async function openDoc(id: string) {
    setError("");
    const response = await fetch(`/api/labour/contractors/${params.id}/documents?document_id=${id}`, { headers: { Authorization: `Bearer ${await token()}` } });
    const payload = await parsePayload(response);
    if (!response.ok) return setError(payload.error || "Could not open document.");
    if (payload.url) window.open(payload.url, "_blank");
  }

  async function loadVendorDocuments() {
    setError("");
    setVendorDocumentsLoading(true);
    const response = await fetch(`/api/vendors/${contractor.vendor_id}`, { headers: { Authorization: `Bearer ${await token()}` } });
    const payload = await parsePayload(response);
    setVendorDocumentsLoading(false);
    if (!response.ok) return setError(payload.error || "Could not load Vendor Documents.");
    setVendorDocuments(payload.documents || []);
  }

  async function openVendorDocument(document: any) {
    setError("");
    const response = await fetch(`/api/vendors/${contractor.vendor_id}`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ document_id: document.id }),
    });
    const payload = await parsePayload(response);
    if (!response.ok || !payload.signedUrl) return setError(payload.error || "Could not open Vendor Document.");
    window.open(payload.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function uploadDoc() {
    if (!file) {
      setError("Choose a document file before uploading.");
      return;
    }
    setError("");
    setSuccess("");
    setUploading(true);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("document_type", documentType);
      const response = await fetch(`/api/labour/contractors/${params.id}/documents`, { method: "POST", headers: { Authorization: `Bearer ${await token()}` }, body });
      const payload = await parsePayload(response);
      if (!response.ok) return setError(payload.error || "Upload failed.");
      setFile(null);
      setFileInputKey((key) => key + 1);
      setSuccess("Document uploaded successfully.");
      await load();
    } catch (uploadError: any) {
      setError(uploadError?.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function deleteDoc(id: string) {
    if (!window.confirm("Delete this document?")) return;
    setError("");
    setSuccess("");
    const response = await fetch(`/api/labour/contractors/${params.id}/documents?document_id=${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${await token()}` } });
    const payload = await parsePayload(response);
    if (!response.ok) return setError(payload.error || "Could not delete document.");
    setSuccess("Document deleted successfully.");
    await load();
  }

  const contractor = data?.contractor;
  if (!contractor) return <section className="p-8 text-sm text-slate-500">{error || "Loading..."}</section>;

  const summary = data.summary || {};
  const contact = contractor.primary_contact || {};
  const tabClass = (tab: typeof activeTab) => activeTab === tab ? "border-slate-950 text-slate-950" : "border-transparent text-slate-500";

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 md:px-10">
      <div className="mx-auto max-w-[1400px] space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Labour Contractor</p>
            <h1 className="text-3xl font-semibold">{contractor.vendors?.vendor_name || contractor.contractor_code}</h1>
            <p className="text-sm text-slate-600">{contractor.contractor_code || "-"} · {labelFromCode(contractor.contractor_status)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/vendors/${contractor.vendor_id}`} className="rounded-lg border px-4 py-2 text-sm font-semibold">Linked Vendor</Link>
            {canEdit && <Link href={`/labour/contractors/${params.id}/edit`} className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold"><Pencil className="h-4 w-4" /> Edit</Link>}
          </div>
        </header>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
        {success && <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-700">{success}</div>}

        <div className="rounded-lg border bg-white shadow-sm">
          <div className="flex flex-wrap gap-4 border-b px-5">
            {(["overview", "documents", "activity"] as const).map((tab) => (
              <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`border-b-2 py-4 text-sm font-semibold ${tabClass(tab)}`}>{labelFromCode(tab)}</button>
            ))}
          </div>

          {activeTab === "overview" && (
            <div className="space-y-5 p-5">
              {(contractor.compliance_warnings || []).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {contractor.compliance_warnings.map((warning: any) => <span key={warning.label} className={`rounded-full border px-2 py-1 text-xs font-semibold ${badgeClass(warning.tone)}`}>{warning.label}</span>)}
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-4">
                <Summary label="Active Labour" value={summary.active_labour_count || 0} />
                <Summary label="Daily Wage Labour" value={summary.daily_wage_labour_count || 0} />
                <Summary label="Contract Basis Labour" value={summary.contract_basis_labour_count || 0} />
                <Summary label="Active Sites" value={summary.active_site_count || 0} />
              </div>
              <div className="grid gap-4 text-sm md:grid-cols-3">
                <Info label="Contractor Name" value={contractor.vendors?.vendor_name} />
                <Info label="Contractor Code" value={contractor.contractor_code} />
                <Info label="Status" value={labelFromCode(contractor.contractor_status)} />
                <Info label="Contact Person" value={contact.contact_name} />
                <Info label="Mobile" value={contact.contact_number} />
                <Info label="Email" value={contact.email} />
                <Info label="PAN" value={contractor.vendors?.pan} />
                <Info label="GSTIN" value={contractor.vendors?.gstin} />
                <Info label="Remarks" value={contractor.remarks} wide />
              </div>
              <div>
                <button type="button" onClick={() => setShowAdditionalCompliance(!showAdditionalCompliance)} className="rounded-md border px-3 py-2 text-sm font-semibold">
                  {showAdditionalCompliance ? "Hide" : "Show"} Additional Compliance
                </button>
                {showAdditionalCompliance && (
                  <div className="mt-3 grid gap-4 rounded-lg border bg-slate-50 p-3 text-sm md:grid-cols-4">
                    <Info label="Labour Licence Number" value={contractor.labour_licence_number} />
                    <Info label="Licence Expiry" value={contractor.labour_licence_valid_to} />
                    <Info label="EPF Registration" value={contractor.epf_registration_number} />
                    <Info label="ESIC Registration" value={contractor.esi_registration_number} />
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "documents" && (
            <div className="space-y-4 p-5">
              <section className="rounded-lg border bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h2 className="font-semibold">Vendor Documents</h2><p className="text-sm text-slate-600">These documents are maintained in Vendor Master.</p></div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={loadVendorDocuments} className="rounded-md border bg-white px-3 py-2 text-sm font-semibold">{vendorDocumentsLoading ? "Loading..." : "Load Vendor Documents"}</button>
                    <Link href={`/vendors/${contractor.vendor_id}`} className="rounded-md border bg-white px-3 py-2 text-sm font-semibold">Open Vendor</Link>
                  </div>
                </div>
                {vendorDocuments && (
                  <div className="mt-4 overflow-x-auto rounded-lg border bg-white">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{["Document Type", "File Name", "Uploaded At", "Open"].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr></thead>
                      <tbody className="divide-y">
                        {vendorDocuments.length === 0 ? <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-500">No Vendor Documents found.</td></tr> : vendorDocuments.map((document) => (
                          <tr key={document.id}>
                            <td className="px-3 py-3 font-semibold">{document.document_type || "-"}</td>
                            <td className="px-3 py-3">{document.file_name || "-"}</td>
                            <td className="px-3 py-3">{formatDateTime(document.uploaded_at)}</td>
                            <td className="px-3 py-3"><button type="button" onClick={() => openVendorDocument(document)} className="rounded-md border px-3 py-1">Open</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="rounded-lg border bg-white p-4">
                <button type="button" onClick={() => setShowContractorDocuments(!showContractorDocuments)} className="rounded-md border px-3 py-2 text-sm font-semibold">
                  {showContractorDocuments ? "Hide" : "Show"} Additional Contractor Documents
                </button>
                {showContractorDocuments && (
                  <div className="mt-4 space-y-4">
                    {canUpload && (
                      <div className="grid gap-3 rounded-lg border bg-slate-50 p-3 md:grid-cols-[220px_1fr_auto]">
                        <select value={documentType} onChange={(event) => setDocumentType(event.target.value)} className="h-10 rounded-lg border px-3 text-sm">{LABOUR_CONTRACTOR_DOCUMENT_TYPES.map((type) => <option key={type}>{type}</option>)}</select>
                        <div>
                          <label className="inline-flex h-10 cursor-pointer items-center rounded-lg border bg-white px-3 text-sm font-semibold">
                            Choose File
                            <input key={fileInputKey} type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} className="hidden" />
                          </label>
                          <p className="mt-1 text-xs text-slate-600">{file ? `Selected: ${file.name}` : "No file selected."}</p>
                        </div>
                        <button type="button" onClick={uploadDoc} disabled={!documentType || !file || uploading} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white disabled:opacity-60"><FileUp className="h-4 w-4" /> {uploading ? "Uploading..." : "Upload"}</button>
                      </div>
                    )}
                    {!canViewDocuments ? (
                      <p className="text-sm text-slate-500">You do not have permission to view contractor documents.</p>
                    ) : (
                      <div className="overflow-x-auto rounded-lg border">
                        <table className="min-w-full text-sm">
                          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{["Type", "File Name", "Uploaded At", "Uploaded By", "Open", "Delete"].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr></thead>
                          <tbody className="divide-y">
                            {(data.documents || []).length === 0 ? <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No additional contractor documents uploaded.</td></tr> : (data.documents || []).map((doc: any) => (
                              <tr key={doc.id}>
                                <td className="px-3 py-3 font-semibold">{doc.document_type}</td>
                                <td className="px-3 py-3">{doc.original_file_name}</td>
                                <td className="px-3 py-3">{formatDateTime(doc.uploaded_at)}</td>
                                <td className="px-3 py-3">{doc.uploaded_by_name || "-"}</td>
                                <td className="px-3 py-3"><button type="button" onClick={() => openDoc(doc.id)} className="rounded-md border px-3 py-1">Open</button></td>
                                <td className="px-3 py-3">{canDelete ? <button type="button" onClick={() => deleteDoc(doc.id)} className="rounded-md border border-red-200 px-3 py-1 text-red-600">Delete</button> : "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === "activity" && (
            <div className="overflow-x-auto p-5">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>{["Date", "User", "Action", "Changed", "Reason", "Details"].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr>
                </thead>
                <tbody className="divide-y">
                  {(data.activity_logs || []).slice(0, activityLimit).map((log: any) => {
                    const changes = activityChanges(log);
                    const isExpanded = expandedLogId === log.id;
                    return (
                      <Fragment key={log.id}>
                        <tr>
                          <td className="px-3 py-3">{formatDateTime(log.created_at)}</td>
                          <td className="px-3 py-3">{log.created_by_name || log.created_by_email || "-"}</td>
                          <td className="px-3 py-3">{labelFromCode(log.action)}</td>
                          <td className="px-3 py-3">{changes.length ? `${changes.length} ${changes.length === 1 ? "field" : "fields"}` : "-"}</td>
                          <td className="px-3 py-3">{log.new_values?.change_reason || "-"}</td>
                          <td className="px-3 py-3"><button type="button" onClick={() => setExpandedLogId(isExpanded ? "" : log.id)} className="rounded-md border px-3 py-1.5 text-xs font-semibold">{isExpanded ? "Hide Details" : "View Details"}</button></td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={6} className="bg-slate-50 px-3 py-3">
                              <div className="space-y-2 rounded-lg border bg-white p-3">
                                {changes.map((change) => <div key={change.field} className="grid gap-1 text-sm md:grid-cols-[220px_1fr]"><span className="font-semibold text-slate-700">{change.label}</span><span className="text-slate-600">{change.oldValue} → <b className="text-slate-900">{change.newValue}</b></span></div>)}
                                {!changes.length && <p className="text-sm text-slate-500">No field-level changes recorded.</p>}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {!data.activity_logs?.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No contractor activity recorded yet.</td></tr>}
                </tbody>
              </table>
              {(data.activity_logs || []).length > activityLimit && <div className="border-t p-3 text-center"><button type="button" onClick={() => setActivityLimit(activityLimit + 10)} className="rounded-md border px-4 py-2 text-sm font-semibold">Load More</button></div>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Summary({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-lg border bg-slate-50 p-4">
      <p className="text-xs font-bold uppercase text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Info({ label, value, wide }: { label: string; value: any; wide?: boolean }) {
  return (
    <div className={wide ? "md:col-span-3" : ""}>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-slate-950">{value || "-"}</p>
    </div>
  );
}
