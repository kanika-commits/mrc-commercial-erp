"use client";

import Link from "next/link";
import { ArrowLeft, CheckCircle2, Pencil, ReceiptText, Trash2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import AlertMessage from "@/components/AlertMessage";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import type { ReimbursementClaim, ReimbursementDocument, ReimbursementHistoryRow } from "@/types/hr";
import StatusBadge from "@/components/hr/StatusBadge";
import DocumentGallery from "@/components/hr/DocumentGallery";
import DocumentUploader from "@/components/hr/DocumentUploader";
import StatusTimeline from "@/components/hr/StatusTimeline";
import { apiFetch, formatCurrency, formatDate, getAccessToken, labelize } from "@/components/hr/hrClient";
import { useHrLookups } from "@/components/hr/useHrLookups";

function isEditable(status: string) {
  const key = String(status || "").toLowerCase();
  return key === "draft" || key === "rejected";
}

export default function ReimbursementDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const canEdit = can(permissions, "reimbursements", "edit");
  const canDelete = can(permissions, "reimbursements", "delete");
  const canUpload = can(permissions, "reimbursements", "upload");
  const canSubmit = can(permissions, "reimbursements", "submit");
  const canApprove = can(permissions, "reimbursements", "approve");
  const canReject = can(permissions, "reimbursements", "reject");
  const canMarkPaid = can(permissions, "reimbursements", "mark_paid");
  const lookups = useHrLookups();
  const [claim, setClaim] = useState<ReimbursementClaim | null>(null);
  const [documents, setDocuments] = useState<ReimbursementDocument[]>([]);
  const [history, setHistory] = useState<ReimbursementHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const [claimResult, docsResult, historyResult] = await Promise.all([
        apiFetch(`/api/hr/reimbursements/${params.id}`),
        apiFetch(`/api/hr/reimbursements/${params.id}/documents`),
        apiFetch(`/api/hr/reimbursements/${params.id}/history`),
      ]);
      setClaim(claimResult.reimbursement);
      setDocuments(docsResult.documents || []);
      setHistory(historyResult.history || []);
    } catch (error: any) {
      setMessage(error.message || "Failed to load reimbursement.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const labels = useMemo(() => {
    const employee = lookups.employees.find((item) => item.id === claim?.employee_id);
    const company = lookups.companies.find((item) => item.id === claim?.company_id)?.label || "-";
    const site = lookups.sites.find((item) => item.id === claim?.site_id)?.label || "-";
    return { employee, company, site };
  }, [claim, lookups]);

  async function runAction(action: "submit" | "approve" | "reject" | "mark-paid") {
    if (!claim) return;
    let body: any = undefined;
    if (action === "reject") {
      const reason = window.prompt("Enter rejection reason (minimum 10 characters)");
      if (!reason) return;
      body = JSON.stringify({ rejection_reason: reason });
    }
    if (action === "mark-paid") {
      const paymentId = window.prompt("Payment ID (optional)") || "";
      body = JSON.stringify({ payment_id: paymentId.trim() || null });
    }
    setWorking(true);
    setMessage("");
    setSuccess("");
    try {
      await apiFetch(`/api/hr/reimbursements/${claim.id}/${action}`, {
        method: "POST",
        ...(body ? { body } : {}),
      });
      setSuccess("Action completed.");
      await load();
    } catch (error: any) {
      setMessage(error.message || "Action failed.");
    } finally {
      setWorking(false);
    }
  }

  async function deleteClaim() {
    if (!claim || !window.confirm(`Delete reimbursement "${claim.claim_number}"?`)) return;
    try {
      await apiFetch(`/api/hr/reimbursements/${claim.id}`, { method: "DELETE" });
      router.push("/hr/reimbursements");
    } catch (error: any) {
      setMessage(error.message || "Failed to delete reimbursement.");
    }
  }

  async function upload(files: FileList, documentType: string) {
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
      await load();
    } catch (error: any) {
      setMessage(error.message || "Failed to upload documents.");
    } finally {
      setUploading(false);
    }
  }

  async function deleteDocument(document: ReimbursementDocument) {
    if (!window.confirm(`Delete document "${document.file_name || "Document"}"?`)) return;
    try {
      await apiFetch(`/api/hr/reimbursements/${params.id}/documents/${document.id}`, { method: "DELETE" });
      setDocuments((prev) => prev.filter((item) => item.id !== document.id));
    } catch (error: any) {
      setMessage(error.message || "Failed to delete document.");
    }
  }

  const status = String(claim?.status || "").toLowerCase();

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <ReceiptText className="h-3.5 w-3.5" />
            HR
          </div>
          <h1 className="text-3xl font-bold text-slate-950">{claim?.claim_number || "Reimbursement"}</h1>
          {claim && <p className="text-sm text-slate-500">{labels.employee?.employee_name || "-"} • {formatDate(claim.claim_date)}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {claim && isEditable(claim.status) && canEdit && <Link href={`/hr/reimbursements/${claim.id}/edit`} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"><Pencil className="h-4 w-4" />Edit</Link>}
          {claim && isEditable(claim.status) && canDelete && <button onClick={deleteClaim} className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" />Delete</button>}
          <Link href="/hr/reimbursements" className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"><ArrowLeft className="h-4 w-4" />Back</Link>
        </div>
      </header>

      <AlertMessage type="error" message={message || lookups.error} onClose={() => setMessage("")} />
      <AlertMessage type="success" message={success} onClose={() => setSuccess("")} />

      {loading || lookups.loading ? (
        <div className="rounded-2xl border bg-white p-8 text-sm text-slate-500 shadow-sm">Loading reimbursement...</div>
      ) : claim ? (
        <>
          <section className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <h2 className="text-xl font-semibold text-slate-950">Claim Details</h2>
              <StatusBadge status={claim.status} />
            </div>
            <div className="mt-5 grid gap-5 md:grid-cols-4">
              <Info label="Employee" value={labels.employee?.employee_name || "-"} />
              <Info label="Company" value={labels.company} />
              <Info label="Site" value={labels.site} />
              <Info label="Type" value={labelize(claim.claim_type)} />
              <Info label="Amount" value={formatCurrency(claim.amount)} />
              <Info label="GST" value={formatCurrency(claim.gst_amount)} />
              <Info label="Total" value={formatCurrency(claim.total_amount)} />
              <Info label="Payment" value={claim.payment_id || "-"} />
              <Info label="Description" value={claim.description || "-"} />
              {claim.rejection_reason && <Info label="Rejection Reason" value={claim.rejection_reason} />}
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap gap-2">
              {isEditable(status) && canSubmit && <button disabled={working} onClick={() => runAction("submit")} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Submit</button>}
              {status === "pending" && canApprove && <button disabled={working} onClick={() => runAction("approve")} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"><CheckCircle2 className="h-4 w-4" />Approve</button>}
              {status === "pending" && canReject && <button disabled={working} onClick={() => runAction("reject")} className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 disabled:opacity-60">Reject</button>}
              {status === "approved" && canMarkPaid && <button disabled={working} onClick={() => runAction("mark-paid")} className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Mark Paid</button>}
            </div>
          </section>

          {isEditable(status) && canUpload && <DocumentUploader uploading={uploading} onUpload={upload} />}
          <DocumentGallery documents={documents} canDelete={isEditable(status) && canUpload} onDelete={deleteDocument} />
          <StatusTimeline history={history} />
        </>
      ) : null}
    </section>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><div className="mt-1 text-base font-semibold text-slate-950">{value}</div></div>;
}
