"use client";

import Link from "next/link";
import { ArrowLeft, ReceiptText } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AlertMessage from "@/components/AlertMessage";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import ReimbursementForm, { type ReimbursementFormValues } from "@/components/hr/ReimbursementForm";
import DocumentGallery from "@/components/hr/DocumentGallery";
import DocumentUploader from "@/components/hr/DocumentUploader";
import { apiFetch, getAccessToken } from "@/components/hr/hrClient";
import { useHrLookups } from "@/components/hr/useHrLookups";
import type { ReimbursementClaim, ReimbursementDocument } from "@/types/hr";

function isEditable(status: string) {
  const key = String(status || "").toLowerCase();
  return key === "draft" || key === "rejected";
}

export default function EditReimbursementPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { access } = useAccessContext();
  const canUpload = can(access?.permissions || [], "reimbursements", "upload");
  const lookups = useHrLookups();
  const [claim, setClaim] = useState<ReimbursementClaim | null>(null);
  const [documents, setDocuments] = useState<ReimbursementDocument[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const [result, documentsResult] = await Promise.all([
          apiFetch(`/api/hr/reimbursements/${params.id}`),
          apiFetch(`/api/hr/reimbursements/${params.id}/documents`),
        ]);
        if (!isEditable(result.reimbursement.status)) {
          setMessage("Only draft or rejected claims can be edited.");
        }
        setClaim(result.reimbursement);
        setDocuments(documentsResult.documents || []);
      } catch (error: any) {
        setMessage(error.message || "Failed to load reimbursement.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.id]);

  async function save(values: ReimbursementFormValues) {
    setMessage("");
    setSaving(true);
    try {
      await apiFetch(`/api/hr/reimbursements/${params.id}`, {
        method: "PUT",
        body: JSON.stringify({
          employee_id: values.employee_id,
          claim_number: values.claim_number,
          claim_date: values.claim_date,
          claim_type: values.claim_type,
          description: values.description || values.claim_for,
          amount: Number(values.amount || 0),
          gst_amount: Number(values.gst_amount || 0),
        }),
      });
      router.push(`/hr/reimbursements/${params.id}`);
    } catch (error: any) {
      setMessage(error.message || "Failed to update reimbursement.");
    } finally {
      setSaving(false);
    }
  }

  async function upload(files: FileList, documentType: string) {
    if (!claim || !isEditable(claim.status)) return;
    setUploading(true);
    setMessage("");
    try {
      const token = await getAccessToken();
      const form = new FormData();
      form.set("document_type", documentType);
      Array.from(files).forEach((file) => form.append("files", file));
      const response = await fetch(`/api/hr/reimbursements/${params.id}/documents`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Failed to upload documents.");
      setDocuments(result.documents || []);
    } catch (error: any) {
      setMessage(error.message || "Failed to upload documents.");
    } finally {
      setUploading(false);
    }
  }

  async function deleteDocument(document: ReimbursementDocument) {
    if (!claim || !isEditable(claim.status)) return;
    if (!window.confirm(`Delete document "${document.file_name || "Document"}"?`)) return;
    try {
      await apiFetch(`/api/hr/reimbursements/${params.id}/documents/${document.id}`, { method: "DELETE" });
      setDocuments((prev) => prev.filter((item) => item.id !== document.id));
    } catch (error: any) {
      setMessage(error.message || "Failed to delete document.");
    }
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <ReceiptText className="h-3.5 w-3.5" />
            HR
          </div>
          <h1 className="text-3xl font-bold text-slate-950">Edit Reimbursement</h1>
        </div>
        <Link href={`/hr/reimbursements/${params.id}`} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      </header>
      <AlertMessage type="error" message={message || lookups.error} onClose={() => setMessage("")} />
      {loading || lookups.loading ? (
        <div className="rounded-2xl border bg-white p-8 text-sm text-slate-500 shadow-sm">Loading form...</div>
      ) : claim && isEditable(claim.status) ? (
        <>
          <ReimbursementForm initialClaim={claim} employees={lookups.employees} saving={saving} onSubmit={save} />
          {canUpload && <DocumentUploader uploading={uploading} onUpload={upload} />}
          <DocumentGallery documents={documents} canDelete={canUpload} onDelete={deleteDocument} />
        </>
      ) : null}
    </section>
  );
}
