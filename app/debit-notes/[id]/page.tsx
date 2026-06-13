"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  FileMinus,
  Paperclip,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
}

function statusClass(value?: string | null) {
  const status = String(value || "").toLowerCase();

  if (status === "approved") return "border-green-200 bg-green-50 text-green-700";
  if (status === "pending") return "border-yellow-200 bg-yellow-50 text-yellow-700";
  if (status === "sent back") return "border-orange-200 bg-orange-50 text-orange-700";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-700";

  return "border-slate-200 bg-slate-50 text-slate-700";
}

export default function DebitNoteDetailPage() {
  const params = useParams();
  const debitNoteId = params.id as string;

  const [note, setNote] = useState<any>(null);
  const [workOrder, setWorkOrder] = useState<any>(null);
  const [company, setCompany] = useState<any>(null);
  const [site, setSite] = useState<any>(null);
  const [vendor, setVendor] = useState<any>(null);
  const [raBill, setRaBill] = useState<any>(null);
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

      const { data: noteData, error: noteError } = await supabase
        .from("debit_notes")
        .select("*")
        .eq("id", debitNoteId)
        .single();

      if (noteError) throw noteError;

      setNote(noteData);

      if (noteData.work_order_id) {
        const { data: woData, error: woError } = await supabase
          .from("work_orders")
          .select("id, wo_number, wo_value, wo_date, company_id, site_id")
          .eq("id", noteData.work_order_id)
          .maybeSingle();

        if (woError) throw woError;

        setWorkOrder(woData);

        if (woData?.company_id) {
          const { data: companyData } = await supabase
            .from("companies")
            .select("id, company_name, company_code")
            .eq("id", woData.company_id)
            .maybeSingle();

          setCompany(companyData);
        }

        if (woData?.site_id) {
          const { data: siteData } = await supabase
            .from("sites")
            .select("id, site_name, site_code")
            .eq("id", woData.site_id)
            .maybeSingle();

          setSite(siteData);
        }
      }

      if (noteData.vendor_id) {
        const { data: vendorData, error: vendorError } = await supabase
          .from("vendors")
          .select("id, vendor_name, pan, gstin")
          .eq("id", noteData.vendor_id)
          .maybeSingle();

        if (vendorError) throw vendorError;

        setVendor(vendorData);
      }

      if (noteData.ra_bill_id) {
        const { data: raData, error: raError } = await supabase
          .from("ra_bills")
          .select("id, ra_number, ra_date, gross_amount, net_amount, approval_status")
          .eq("id", noteData.ra_bill_id)
          .maybeSingle();

        if (raError) throw raError;

        setRaBill(raData);
      }

      const { data: documentData, error: documentError } = await supabase
        .from("debit_note_documents")
        .select("*")
        .eq("debit_note_id", debitNoteId)
        .order("uploaded_at", { ascending: false });

      if (documentError) throw documentError;

      setDocuments(documentData || []);
    } catch (error: any) {
      setMessage(error.message || "Failed to load Debit Note.");
    } finally {
      setLoading(false);
    }
  }

  async function openDocument(path: string | null) {
    if (!path) return;

    const { data, error } = await supabase.storage
      .from("debit-note-documents")
      .createSignedUrl(path, 60);

    if (error) {
      setMessage(error.message);
      return;
    }

    window.open(data.signedUrl, "_blank");
  }

  const amount = useMemo(() => {
    return Number(note?.total_amount || note?.gross_amount || 0);
  }, [note]);

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

  if (!note) {
    return <p className="text-red-600">Debit Note not found.</p>;
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
            <FileMinus className="h-3.5 w-3.5" />
            Debit Note Detail
          </div>

          <h1 className="text-3xl font-bold text-slate-950">
            Debit Note {note.debit_note_number}
          </h1>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(
                note.approval_status
              )}`}
            >
              {note.approval_status || "Pending"}
            </span>

            <span className="text-sm text-slate-500">
              Created against WO {workOrder?.wo_number || "-"}
            </span>
          </div>
        </div>

        <Link
          href="/debit-notes"
          className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Debit Notes
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Summary title="Debit Amount" value={money(amount)} />
        <Summary title="Type" value={note.debit_note_type || "-"} />
        <Summary title="Approval" value={note.approval_status || "Pending"} />
        <Summary title="Files" value={String(documents.length)} />
      </div>

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

        {note.work_order_id && (
          <Link
            href={`/work-orders/${note.work_order_id}`}
            className="mt-5 inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Open Work Order
            <ExternalLink className="h-4 w-4" />
          </Link>
        )}
      </section>

      {raBill && (
        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-xl font-semibold text-slate-950">
            Linked RA Bill
          </h2>

          <div className="grid gap-4 md:grid-cols-4">
            <Info label="RA Number" value={raBill.ra_number || "-"} />
            <Info label="RA Date" value={raBill.ra_date || "-"} />
            <Info label="RA Gross" value={money(raBill.gross_amount)} />
            <Info label="RA Net" value={money(raBill.net_amount)} />
          </div>

          <Link
            href={`/ra-bills/${raBill.id}`}
            className="mt-5 inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Open RA Bill
            <ExternalLink className="h-4 w-4" />
          </Link>
        </section>
      )}

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold text-slate-950">
          Debit Note Information
        </h2>

        <div className="grid gap-4 md:grid-cols-4">
          <Info label="Debit Note Number" value={note.debit_note_number || "-"} />
          <Info label="Debit Note Date" value={note.debit_note_date || "-"} />
          <Info label="Debit Note Type" value={note.debit_note_type || "-"} />
          <Info label="Amount" value={money(amount)} />
          <Info label="Status" value={note.status || "-"} />
          <Info label="Approval Status" value={note.approval_status || "-"} />
          <Info label="Created By" value={note.created_by_name || "-"} />
          <Info label="Created Email" value={note.created_by_email || "-"} />
        </div>

        {note.reason && (
          <div className="mt-6 border-t pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Reason
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              {note.reason}
            </p>
          </div>
        )}

        {note.rejection_reason && (
          <div className="mt-6 rounded-2xl border border-orange-200 bg-orange-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-orange-700">
              HO Remark / Reason
            </p>
            <p className="mt-2 text-sm leading-6 text-orange-800">
              {note.rejection_reason}
            </p>
          </div>
        )}
      </section>

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
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-3"
              >
                <div>
                  <p className="font-medium text-slate-950">{doc.file_name}</p>
                  <p className="text-xs text-slate-500">
                    Uploaded:{" "}
                    {doc.uploaded_at
                      ? new Date(doc.uploaded_at).toLocaleString()
                      : "-"}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => openDocument(doc.file_url)}
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

function Summary({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
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