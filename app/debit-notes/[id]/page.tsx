"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Building2, ExternalLink, FileMinus, Paperclip } from "lucide-react";
import AuditTrailCard from "@/components/AuditTrailCard";
import { supabase } from "@/lib/supabase";
import { formatIstTimestamp } from "@/lib/dateTime";
import { recordClientAuditEvent } from "@/lib/clientAudit";

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
}

function formatDateTime(value: string | null | undefined) {
  return formatIstTimestamp(value);
}

function auditName(name?: string | null, email?: string | null) {
  return name || email || "-";
}

export default function DebitNoteDetailPage() {
  const params = useParams();
  const debitNoteId = params.id as string;

  const [note, setNote] = useState<any>(null);
  const [workOrder, setWorkOrder] = useState<any>(null);
  const [company, setCompany] = useState<any>(null);
  const [site, setSite] = useState<any>(null);
  const [vendor, setVendor] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadDebitNote();
  }, [debitNoteId]);

  async function loadDebitNote() {
    try {
      setLoading(true);
      setMessage("");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) throw new Error("Unable to load Debit Note: missing auth session.");
      const response = await fetch(`/api/debit-notes/${encodeURIComponent(debitNoteId)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const detail = await response.json();
      if (!response.ok) throw new Error(detail.error || "Failed to load Debit Note.");
      const noteData = { ...detail.note, source_purchase_order: detail.source_purchase_order };
      setNote(noteData);
      setWorkOrder(detail.work_order);
      setCompany(detail.company);
      setSite(detail.site);
      setVendor(detail.vendor);

      if (session.access_token) {
        const response = await fetch(
          `/api/debit-notes/documents?debit_note_id=${encodeURIComponent(debitNoteId)}`,
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          }
        );
        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || "Failed to load Debit Note documents.");
        }

        setDocuments(result.documents || []);
      }
    } catch (error: any) {
      setMessage(error.message || "Failed to load Debit Note.");
    } finally {
      setLoading(false);
    }
  }

  function openDocument(document: any) {
    recordClientAuditEvent({ eventType: "view_document", entityType: "debit_note", recordId: debitNoteId, documentId: document.id, source: "debit_note_detail" });
    if (!document.signed_url) {
      setMessage(
        document.signed_url_error ||
          "Unable to open Debit Note file. Signed URL was not available."
      );
      return;
    }

    window.open(document.signed_url, "_blank", "noopener,noreferrer");
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading Debit Note...</p>;
  }

  if (message) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {message}
      </div>
    );
  }

  if (!note) return null;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
            <FileMinus className="h-3.5 w-3.5" />
            Debit Note Detail
          </div>
          <h1 className="text-3xl font-bold text-slate-950">
            Debit Note {note.debit_note_number || "-"}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Created against WO {workOrder?.wo_number || "-"}.
          </p>
        </div>

        <Link
          href="/debit-notes"
          className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Debit Notes
        </Link>
        {note.source_purchase_order_id && String(note.status || "").toLowerCase() === "draft" && String(note.approval_status || "").toLowerCase() === "pending" && (
          <Link href={`/debit-notes/new?recovery_draft_id=${encodeURIComponent(debitNoteId)}`} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Edit</Link>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Summary title="Debit Note Amount" value={money(note.total_amount || note.gross_amount)} />
        <Summary title="Type" value={note.debit_note_type || "-"} />
        <Summary title="Approval Status" value={note.approval_status || "-"} />
      </div>

      {note.source_purchase_order && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-950">Source Purchase Order</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-4">
            <Info label="PO Number" value={note.source_purchase_order.po_number || "-"} />
            <Info label="PO Date" value={note.source_purchase_order.po_date || "-"} />
            <Info label="Vendor" value={note.source_purchase_order.vendor_name_snapshot || vendor?.vendor_name || "-"} />
            <Info label="Purpose" value={note.source_purchase_order.purpose || "General Purchase"} />
            <Info label="Basic Amount" value={money(note.source_purchase_order.total_basic_amount)} />
            <Info label="GST Amount" value={money(note.source_purchase_order.total_gst_amount)} />
            <Info label="Total Amount" value={money(note.source_purchase_order.total_amount)} />
            <Info label="PO Status" value={note.source_purchase_order.status || "-"} />
          </div>
        </section>
      )}

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Building2 className="h-5 w-5 text-slate-400" />
          <h2 className="text-xl font-semibold text-slate-950">
            Work Order & Vendor Details
          </h2>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          <Info label="Work Order" value={workOrder?.wo_number || "-"} />
          <Info label="Company" value={company?.company_name || "-"} />
          <Info label="Site" value={site?.site_name || "-"} />
          <Info label="Vendor" value={vendor?.vendor_name || "-"} />
          <Info label="WO Date" value={workOrder?.wo_date || "-"} />
          <Info label="WO Value" value={money(workOrder?.wo_value)} />
          <Info label="PAN" value={vendor?.pan || "-"} />
          <Info label="GSTIN" value={vendor?.gstin || "-"} />
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold text-slate-950">
          Debit Note Information
        </h2>
        <div className="grid gap-4 md:grid-cols-4">
          <Info label="Debit Note Number" value={note.debit_note_number || "-"} />
          <Info label="Debit Note Date" value={note.debit_note_date || "-"} />
          <Info label="Debit Note Type" value={note.debit_note_type || "-"} />
          <Info label="Status" value={note.status || "-"} />
          <Info label="Approval Status" value={note.approval_status || "-"} />
          <Info label="Created By" value={auditName(note.created_by_name, note.created_by_email)} />
          <Info label="Created At" value={formatDateTime(note.created_at)} />
          <Info label="Approved By" value={auditName(note.approved_by_name, note.approved_by_email)} />
          <Info label="Approved At" value={formatDateTime(note.approved_at)} />
        </div>

        {note.reason && (
          <div className="mt-6 border-t pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Reason
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-700">{note.reason}</p>
          </div>
        )}
      </section>

      <AuditTrailCard
        createdBy={note.created_by_name || note.created_by_email}
        createdAt={note.created_at}
        approvedBy={note.approved_by_name || note.approved_by_email}
        approvedAt={note.approved_at}
        rejectedBy={note.rejected_by_name || note.rejected_by_email}
        rejectedAt={note.rejected_at}
        rejectReason={note.rejection_reason}
      />

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Paperclip className="h-5 w-5 text-slate-400" />
          <h2 className="text-xl font-semibold text-slate-950">
            Debit Note Attachments
          </h2>
        </div>

        {documents.length === 0 ? (
          <p className="text-sm text-red-600">No attachments found.</p>
        ) : (
          <div className="space-y-3">
            {documents.map((document) => (
              <div
                key={document.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-3"
              >
                <div>
                  <p className="font-medium text-slate-950">
                    {document.file_name || "Attachment"}
                  </p>
                  <p className="text-xs text-slate-500">
                    Uploaded: {formatDateTime(document.uploaded_at)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openDocument(document)}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800"
                >
                  Open
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function Summary({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {title}
      </p>
      <p className="mt-2 text-lg font-bold text-slate-950">{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 font-medium text-slate-950">{value}</p>
    </div>
  );
}
