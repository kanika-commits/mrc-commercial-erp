"use client";

import Link from "next/link";
import { ArrowLeft, ReceiptText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AlertMessage from "@/components/AlertMessage";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import ReimbursementForm, { type ReimbursementFormValues } from "@/components/hr/ReimbursementForm";
import DocumentUploader from "@/components/hr/DocumentUploader";
import { apiFetch, getAccessToken } from "@/components/hr/hrClient";
import { useHrLookups } from "@/components/hr/useHrLookups";

export default function NewReimbursementPage() {
  const router = useRouter();
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const canUpload = can(permissions, "reimbursements", "upload");
  const lookups = useHrLookups();
  const [claimId, setClaimId] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");

  async function save(values: ReimbursementFormValues) {
    setMessage("");
    setSuccess("");
    setSaving(true);
    try {
      const result = await apiFetch("/api/hr/reimbursements", {
        method: "POST",
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
      setClaimId(result.reimbursement.id);
      setSuccess("Claim saved. You can upload documents now or open the claim.");
    } catch (error: any) {
      setMessage(error.message || "Failed to create reimbursement.");
    } finally {
      setSaving(false);
    }
  }

  async function upload(files: FileList, documentType: string) {
    if (!claimId) return;
    setUploading(true);
    setMessage("");
    try {
      const token = await getAccessToken();
      const form = new FormData();
      form.set("document_type", documentType);
      Array.from(files).forEach((file) => form.append("files", file));
      const response = await fetch(`/api/hr/reimbursements/${claimId}/documents`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Failed to upload documents.");
      router.push(`/hr/reimbursements/${claimId}`);
    } catch (error: any) {
      setMessage(error.message || "Failed to upload documents.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="space-y-6">
      <Header title="New Reimbursement" />
      <AlertMessage type="error" message={message || lookups.error} onClose={() => setMessage("")} />
      <AlertMessage type="success" message={success} onClose={() => setSuccess("")} />
      {lookups.loading ? (
        <div className="rounded-2xl border bg-white p-8 text-sm text-slate-500 shadow-sm">Loading form...</div>
      ) : (
        <ReimbursementForm employees={lookups.employees} saving={saving || Boolean(claimId)} onSubmit={save} />
      )}
      {claimId && (
        <div className="space-y-4">
          {canUpload ? (
            <DocumentUploader uploading={uploading} onUpload={upload} />
          ) : (
            <div className="rounded-2xl border bg-white p-5 text-sm text-slate-500 shadow-sm">
              Claim saved. You do not have permission to upload reimbursement documents.
            </div>
          )}
          <div className="flex justify-end">
            <Link href={`/hr/reimbursements/${claimId}`} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">Open Claim</Link>
          </div>
        </div>
      )}
    </section>
  );
}

function Header({ title }: { title: string }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
          <ReceiptText className="h-3.5 w-3.5" />
          HR
        </div>
        <h1 className="text-3xl font-bold text-slate-950">{title}</h1>
      </div>
      <Link href="/hr/reimbursements" className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>
    </header>
  );
}
