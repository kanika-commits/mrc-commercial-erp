"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileMinus, FileText, Trash2 } from "lucide-react";
import AlertMessage from "@/components/AlertMessage";
import { supabase } from "@/lib/supabase";
import { useAccessContext } from "@/components/AccessContext";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { formatIstTimestamp } from "@/lib/dateTime";
import { recordClientAuditEvent } from "@/lib/clientAudit";
import { loadPilotRaBillPdf } from "@/lib/workOrderPilotRaBillPdf.client";
import { formatPilotDateTime } from "@/lib/workOrderPilotRaBill";

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
}

function formatDateTime(value: string | null | undefined) {
  return formatIstTimestamp(value);
}

function auditName(name: string | null | undefined, email: string | null | undefined) {
  return name || email || "-";
}

type ApprovalAction = "Approved" | "Rejected";
type RaApprovalAction = "Approved" | "Rejected";

export default function ApprovalsPage() {
  const { access } = useAccessContext();
  const [bills, setBills] = useState<any[]>([]);
  const [debitNotes, setDebitNotes] = useState<any[]>([]);
  const [creditNotes, setCreditNotes] = useState<any[]>([]);
  const [pilotBills, setPilotBills] = useState<any[]>([]);

  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);

  const [raDocuments, setRaDocuments] = useState<any[]>([]);
  const [debitDocuments, setDebitDocuments] = useState<any[]>([]);
  const [creditDocuments, setCreditDocuments] = useState<any[]>([]);
  const [pilotAttachments, setPilotAttachments] = useState<Record<string, any[]>>({});
  const [pilotAttachmentsLoading, setPilotAttachmentsLoading] = useState("");
  const [pilotSavingId, setPilotSavingId] = useState("");
  const [pilotPdfLoading, setPilotPdfLoading] = useState("");
  const [pilotDriveRetryId, setPilotDriveRetryId] = useState("");

  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("error");
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const canViewCommercialApprovals =
    hasGlobalAccess(access) ||
    can(access?.permissions || [], "ra_approval", "view") ||
    can(access?.permissions || [], "ra_approval", "approve") ||
    can(access?.permissions || [], "ra_approval", "reject");
  const canViewCreditApprovals = hasGlobalAccess(access) || can(access?.permissions || [], "credit_notes", "view") || can(access?.permissions || [], "credit_notes", "approve") || can(access?.permissions || [], "credit_notes", "reject");
  const canApproveCommercialApprovals =
    hasGlobalAccess(access) || can(access?.permissions || [], "ra_approval", "approve");
  const canRejectCommercialApprovals =
    hasGlobalAccess(access) || can(access?.permissions || [], "ra_approval", "reject");
  const canViewPilotApprovals = hasGlobalAccess(access) || can(access?.permissions || [], "work_orders", "approve");

  useEffect(() => {
    if (access) {
      loadApprovals();
    }
  }, [access]);

  function showMessage(type: "success" | "error", text: string) {
    setMessageType(type);
    setMessage(text);
  }

  async function loadApprovals() {
    setLoading(true);
    setMessage("");

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;

    if (!canViewCommercialApprovals) {
      setBills([]);
      setDebitNotes([]);
      setCreditNotes([]);
      setPilotBills([]);
      setWorkOrders([]);
      setVendors([]);
      setSites([]);
      setCompanies([]);
      setRaDocuments([]);
      setDebitDocuments([]);
      setCreditDocuments([]);
      setLoading(false);
      return;
    }

    if (!token) {
      showMessage("error", "Unable to load approvals: missing auth session.");
      setLoading(false);
      return;
    }

    const approvalResponse = await fetch("/api/approvals", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
    });

    const approvalResult = await approvalResponse.json().catch(() => ({}));

    if (!approvalResponse.ok) {
      showMessage("error", approvalResult.error || "Failed to load approvals.");
      setLoading(false);
      return;
    }

    const raBills: any[] = approvalResult.bills || [];
    const notes: any[] = approvalResult.debitNotes || [];
    const credit: any[] = approvalResult.creditNotes || [];

    setBills(raBills);
    setDebitNotes(notes);
    setCreditNotes(credit);
    if (canViewPilotApprovals) {
      const response = await fetch("/api/work-orders/pilot-ra-bills/approvals", { headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) showMessage("error", result.error || "Failed to load RA Bills Form approvals.");
      else {
        const pilotRows = result.bills || [];
        setPilotBills(pilotRows);
        const attachmentResults = await Promise.all(pilotRows.map(async (bill: any) => {
          try {
            const detail = await fetch(`/api/work-orders/pilot-ra-bills/approvals/${bill.id}`, { headers: { Authorization: `Bearer ${token}` } });
            const result = await detail.json().catch(() => ({}));
            return [bill.id, detail.ok && Array.isArray(result.attachments) ? [{ id: `pdf-${bill.id}`, kind: "reviewed_pdf", file_name: "Reviewed RA Bills Form PDF" }, ...result.attachments] : []] as const;
          } catch { return [bill.id, []] as const; }
        }));
        setPilotAttachments(Object.fromEntries(attachmentResults));
      }
    } else setPilotBills([]);

    const raBillIds = raBills.map((b) => b.id);
    const debitNoteIds = notes.map((n) => n.id);
    const creditNoteIds = credit.map((n) => n.id);

    let raDocumentData: any[] = [];

    if (raBillIds.length) {
      if (!token) {
        showMessage("error", "Unable to load RA Bill documents: missing auth session.");
        setLoading(false);
        return;
      }

      const documentResponse = await fetch(
        `/api/ra-bills/documents?ra_bill_ids=${encodeURIComponent(
          raBillIds.join(",")
        )}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const documentResult = await documentResponse.json();

      if (!documentResponse.ok) {
        showMessage("error", documentResult.error || "Failed to load RA Bill documents.");
        setLoading(false);
        return;
      }

      raDocumentData = documentResult.documents || [];
    }

    let debitDocumentData: any[] = [];
    let creditDocumentData: any[] = [];

    if (debitNoteIds.length) {
      if (!token) {
        showMessage("error", "Unable to load Debit Note documents: missing auth session.");
        setLoading(false);
        return;
      }

      const documentResponse = await fetch(
        `/api/debit-notes/documents?debit_note_ids=${encodeURIComponent(
          debitNoteIds.join(",")
        )}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const documentResult = await documentResponse.json();

      if (!documentResponse.ok) {
        showMessage("error", documentResult.error || "Failed to load Debit Note documents.");
        setLoading(false);
        return;
      }

      debitDocumentData = documentResult.documents || [];
    }

    if (creditNoteIds.length && canViewCreditApprovals) {
      const documentResponse = await fetch(`/api/credit-notes/documents?credit_note_ids=${encodeURIComponent(creditNoteIds.join(","))}`, { headers: { Authorization: `Bearer ${token}` } });
      const documentResult = await documentResponse.json().catch(() => ({}));
      if (!documentResponse.ok) { showMessage("error", documentResult.error || "Failed to load Credit Note documents."); setLoading(false); return; }
      creditDocumentData = documentResult.documents || [];
    }

    setWorkOrders(approvalResult.workOrders || []);
    setVendors(approvalResult.vendors || []);
    setSites(approvalResult.sites || []);
    setCompanies(approvalResult.companies || []);
    setRaDocuments(raDocumentData || []);
    setDebitDocuments(debitDocumentData || []);
    setCreditDocuments(creditDocumentData || []);

    setLoading(false);
  }

  const maps = useMemo(() => {
    return {
      woMap: new Map(workOrders.map((item) => [item.id, item])),
      vendorMap: new Map(vendors.map((item) => [item.id, item])),
      siteMap: new Map(sites.map((item) => [item.id, item])),
      companyMap: new Map(companies.map((item) => [item.id, item])),
    };
  }, [workOrders, vendors, sites, companies]);

  function raDocumentCount(billId: string) {
    return raDocuments.filter((doc) => doc.ra_bill_id === billId).length;
  }

  function raDocumentsForBill(billId: string) {
    return raDocuments.filter((doc) => doc.ra_bill_id === billId);
  }

  function openRaDocument(document: any) {
    recordClientAuditEvent({ eventType: "view_document", entityType: "ra_bill", recordId: document.ra_bill_id, documentId: document.id, source: "approvals" });
    if (!document.signed_url) {
      showMessage(
        "error",
        document.signed_url_error ||
          "Unable to open RA Bill file. Signed URL was not available."
      );
      return;
    }

    window.open(document.signed_url, "_blank", "noopener,noreferrer");
  }

  function debitDocumentCount(debitNoteId: string) {
    return debitDocuments.filter((doc) => doc.debit_note_id === debitNoteId)
      .length;
  }

  function debitDocumentsForNote(debitNoteId: string) {
    return debitDocuments.filter((doc) => doc.debit_note_id === debitNoteId);
  }

  function openDebitDocument(document: any) {
    recordClientAuditEvent({ eventType: "view_document", entityType: "debit_note", recordId: document.debit_note_id, documentId: document.id, source: "approvals" });
    if (!document.signed_url) {
      showMessage(
        "error",
        document.signed_url_error ||
          "Unable to open Debit Note file. Signed URL was not available."
      );
      return;
    }

    window.open(document.signed_url, "_blank", "noopener,noreferrer");
  }

  function openCreditDocument(document: any) {
    recordClientAuditEvent({ eventType: "view_document", entityType: "credit_note", recordId: document.credit_note_id, documentId: document.id, source: "approvals" });
    if (!document.signed_url) { showMessage("error", document.signed_url_error || "Unable to open Credit Note file."); return; }
    window.open(document.signed_url, "_blank", "noopener,noreferrer");
  }

  async function updateRaStatus(billId: string, action: RaApprovalAction) {
    setMessage("");
    setSavingId(`ra-${billId}`);

    if (
      (action === "Approved" && !canApproveCommercialApprovals) ||
      (action === "Rejected" && !canRejectCommercialApprovals)
    ) {
      showMessage("error", "You do not have permission to perform this approval action.");
      setSavingId("");
      return;
    }

    const remark = remarks[`ra-${billId}`]?.trim() || "";

    if (action === "Rejected" && !remark) {
      showMessage("error", "Reason is required for Reject.");
      setSavingId("");
      
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      showMessage("error", "Your session has expired. Please sign in again.");
      setSavingId("");
      return;
    }

    const response = await fetch(`/api/ra-bills/${billId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action,
        rejection_reason: remark,
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      showMessage(
        "error",
        result.error || `Failed to ${action === "Approved" ? "approve" : "reject"} RA Bill.`
      );
      setSavingId("");
      return;
    }

    setBills((prev) => prev.filter((bill) => bill.id !== billId));
    showMessage(
      "success",
      action === "Approved"
        ? "RA Bill approved successfully."
        : "RA Bill rejected successfully."
    );
    setSavingId("");
  }

  async function updatePilotStatus(billId: string, action: "approve" | "reject" | "file_drive") {
    setPilotSavingId(billId);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { showMessage("error", "Your session has expired. Please sign in again."); setPilotSavingId(""); return; }
    const reason = remarks[`pilot-${billId}`]?.trim() || "";
    if (action === "reject" && !reason) { showMessage("error", "A rejection reason is required."); setPilotSavingId(""); return; }
    const response = await fetch(`/api/work-orders/pilot-ra-bills/approvals/${billId}`, { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, reason }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) showMessage("error", result.error || "Could not review RA Bills Form.");
    else if (action === "approve" && result.filing_status === "pending") {
      setPilotBills((current) => current.filter((bill) => bill.id !== billId));
      showMessage("success", "Approved");
      await updatePilotStatus(billId, "file_drive");
    } else if (result.filing_failed) {
      setPilotDriveRetryId(billId);
      showMessage("error", result.error || "RA Bills Form approved, but Drive filing failed; retry filing.");
    } else {
      setPilotBills((current) => current.filter((bill) => bill.id !== billId));
      showMessage("success", action === "approve" ? "Approved" : action === "reject" ? "RA Bills Form rejected." : "RA Bills Form filed to Drive.");
      if (action === "file_drive") setPilotDriveRetryId("");
    }
    setPilotSavingId("");
  }

  async function loadPilotAttachments(billId: string) {
    setPilotAttachmentsLoading(billId);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { showMessage("error", "Your session has expired. Please sign in again."); setPilotAttachmentsLoading(""); return; }
    try {
      const response = await fetch(`/api/work-orders/pilot-ra-bills/approvals/${billId}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not load Pilot attachments.");
      setPilotAttachments((current) => ({ ...current, [billId]: [{ id: `pdf-${billId}`, kind: "reviewed_pdf", file_name: "Reviewed RA Bills Form PDF" }, ...(result.attachments || [])] }));
    } catch (error: any) { showMessage("error", error.message || "Could not load Pilot attachments."); }
    finally { setPilotAttachmentsLoading(""); }
  }

  async function openPilotFile(billId: string, file: any) {
    const popup = window.open("about:blank", "_blank");
    if (!popup) { showMessage("error", "Unable to open the Pilot file. Please allow pop-ups and retry."); return; }
    try {
      if (file.kind === "reviewed_pdf") {
        setPilotPdfLoading(billId);
        const url = await loadPilotRaBillPdf(billId);
        popup.location.href = url;
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Your session has expired. Please sign in again.");
        const response = await fetch(`/api/work-orders/pilot-ra-bills/${billId}/attachments/${file.id}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.url) throw new Error(result.error || "The Pilot attachment could not be signed.");
        popup.location.href = result.url;
      }
    } catch (error: any) { popup.close(); showMessage("error", error.message || "The Pilot file could not be opened."); }
    finally { setPilotPdfLoading(""); }
  }

  function openPilotPdf(billId: string) {
    return openPilotFile(billId, { kind: "reviewed_pdf" });
  }

async function updateDebitNoteStatus(
  debitNoteId: string,
  action: ApprovalAction
) {
  setMessage("");
  setSavingId(`dn-${debitNoteId}`);

  if (
    (action === "Approved" && !canApproveCommercialApprovals) ||
    (action === "Rejected" && !canRejectCommercialApprovals)
  ) {
    showMessage("error", "You do not have permission to perform this approval action.");
    setSavingId("");
    return;
  }

  const remark = remarks[`dn-${debitNoteId}`]?.trim() || "";

  if (action === "Rejected" && remark.length < 10) {
    showMessage("error", "Reason must be at least 10 characters for Reject.");
    setSavingId("");
    return;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    showMessage("error", "Your session has expired. Please sign in again.");
    setSavingId("");
    return;
  }

  const response = await fetch(
    `/api/debit-notes?debit_note_id=${encodeURIComponent(debitNoteId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action,
        rejection_reason: remark,
      }),
    }
  );

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    showMessage(
      "error",
      result.error ||
        `Failed to ${action === "Approved" ? "approve" : "reject"} Debit Note.`
    );
    setSavingId("");
    return;
  }

  setDebitNotes((prev) => prev.filter((note) => note.id !== debitNoteId));
  showMessage(
    "success",
    action === "Approved"
      ? "Debit Note approved successfully."
      : "Debit Note rejected successfully."
  );
  setSavingId("");
}

  async function updateCreditNoteStatus(noteId: string, action: ApprovalAction) {
    const allowed = action === "Approved" ? hasGlobalAccess(access) || can(access?.permissions || [], "credit_notes", "approve") : hasGlobalAccess(access) || can(access?.permissions || [], "credit_notes", "reject");
    if (!allowed) { showMessage("error", "You do not have permission to perform this Credit Note approval action."); return; }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { showMessage("error", "Your session has expired. Please sign in again."); return; }
    const response = await fetch(`/api/credit-notes?credit_note_id=${encodeURIComponent(noteId)}`, { method: "PATCH", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, rejection_reason: remarks[`cn-${noteId}`] || "" }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { showMessage("error", result.error || "Credit Note approval failed."); return; }
    setCreditNotes((previous) => previous.filter((note) => note.id !== noteId));
    showMessage("success", action === "Approved" ? "Credit Note approved successfully." : "Credit Note rejected successfully.");
  }

  if (loading) {
    
    return <p className="text-sm text-slate-500">Loading approvals...</p>;
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
            <FileText className="h-3.5 w-3.5" />
            HO Approval
          </div>

          <h1 className="text-3xl font-bold text-slate-950">HO Approvals</h1>
          <p className="text-sm text-slate-500">
            Review pending RA Bills and Debit Notes.
          </p>
        </div>

        <button
          type="button"
          onClick={loadApprovals}
          className="rounded-xl border bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="border-b p-4"><h2 className="font-semibold text-slate-950">Pending Credit Notes</h2><p className="text-xs text-slate-500">Approve or reject submitted Credit Notes.</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3 text-left">Credit Note</th><th className="p-3 text-left">Work Order</th><th className="p-3 text-left">Created</th><th className="p-3 text-right">Amount</th><th className="p-3 text-left">Files</th><th className="p-3 text-left">Reason</th><th className="p-3 text-right">Action</th></tr></thead><tbody>{creditNotes.map((note) => { const wo = maps.woMap.get(note.work_order_id); const docs = creditDocuments.filter((document) => document.credit_note_id === note.id); const key = `cn-${note.id}`; return <tr key={note.id} className="border-t align-top"><td className="p-3 font-semibold">{note.credit_note_number || "-"}<div className="text-xs text-slate-500">{note.credit_note_date || "-"}</div></td><td className="p-3">{wo?.wo_number || "-"}</td><td className="p-3">{auditName(note.created_by_name, note.created_by_email)}<div className="text-xs text-slate-500">{formatDateTime(note.created_at)}</div></td><td className="p-3 text-right font-semibold">{money(note.total_amount || note.gross_amount)}</td><td className="p-3">{docs.map((document) => <button key={document.id} type="button" className="block text-xs text-blue-600 hover:underline" onClick={() => openCreditDocument(document)}>{document.file_name || "Open attachment"}</button>)}</td><td className="p-3"><textarea aria-label={`Reject reason for ${note.credit_note_number || note.id}`} value={remarks[key] || ""} onChange={(event) => setRemarks((current) => ({ ...current, [key]: event.target.value }))} className="min-h-20 w-64 rounded-xl border px-3 py-2 text-sm" placeholder="Required for reject" /></td><td className="p-3 text-right"><ActionButtons saving={savingId === key} viewHref={`/credit-notes/${note.id}`} showApprove={hasGlobalAccess(access) || can(access?.permissions || [], "credit_notes", "approve")} showReject={hasGlobalAccess(access) || can(access?.permissions || [], "credit_notes", "reject")} onApprove={() => updateCreditNoteStatus(note.id, "Approved")} onReject={() => updateCreditNoteStatus(note.id, "Rejected")} /></td></tr>; })}{creditNotes.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-500">No pending Credit Notes found.</td></tr>}</tbody></table></div>
      </div>

      <AlertMessage
        type={messageType}
        message={message}
        onClose={() => setMessage("")}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Summary title="Pending RA Bills" value={String(bills.length + pilotBills.length)} />
        <Summary title="Pending Debit Notes" value={String(debitNotes.length)} />
        <Summary
          title="Pending RA Value"
          value={money(
            bills.reduce((sum, bill) => sum + Number(bill.net_amount || 0), 0) + pilotBills.reduce((sum, bill) => sum + Number(bill.calculation_snapshot?.current_net_payable ?? bill.calculation_snapshot?.cumulative_net_payable ?? 0), 0)
          )}
        />
        <Summary
          title="Pending Debit Value"
          value={money(
            debitNotes.reduce(
              (sum, note) =>
                sum + Number(note.total_amount || note.gross_amount || 0),
              0
            )
          )}
        />
      </div>

      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="border-b p-4">
          <h2 className="font-semibold text-slate-950">Pending RA Bills</h2>
          <p className="text-xs text-slate-500">
            Approve or reject RA bills. Rejected records remain available for audit.
          </p>
          {pilotDriveRetryId && <button type="button" disabled={pilotSavingId === pilotDriveRetryId} onClick={() => void updatePilotStatus(pilotDriveRetryId, "file_drive")} className="mt-3 rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">Retry Drive filing</button>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1480px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3 text-left">RA DETAILS</th>
                <th className="p-3 text-left">SITE / WO</th>
                <th className="p-3 text-left">VENDOR</th>
                <th className="p-3 text-left">CREATED BY</th>
                <th className="p-3 text-left">CREATED AT</th>
                <th className="p-3 text-right">GROSS</th>
                <th className="p-3 text-right">GST</th>
                <th className="p-3 text-right">NET</th>
                <th className="p-3 text-left">FILES</th>
                <th className="p-3 text-left">REMARK / REASON</th>
                <th className="p-3 text-right">ACTION</th>
              </tr>
            </thead>

            <tbody>
              {pilotBills.map((bill) => {
                const snapshot = bill.work_order_snapshot || {};
                const totals = bill.calculation_snapshot || {};
                const key = `pilot-${bill.id}`;
                const files = pilotAttachments[bill.id];
                const attachments = files;
                return <tr key={`pilot-${bill.id}`} className="border-t align-top">
                  <td className="p-3"><div className="font-semibold text-slate-950">RA Bill No. {bill.bill_number || "-"}</div><div className="text-xs text-slate-500">Date: {bill.bill_date || "-"}</div><span className="mt-1 inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs text-sky-700">Pilot</span></td>
                  <td className="p-3"><div className="font-medium">{snapshot.site_name || snapshot.site?.site_name || "-"}</div><div className="text-xs text-slate-500">{snapshot.company_name || snapshot.company?.company_name || "-"}</div><div className="mt-1 text-blue-600">{snapshot.wo_number || bill.work_order_id || "-"}</div></td>
                  <td className="p-3">{snapshot.vendor_name || snapshot.vendor?.vendor_name || "-"}</td>
                  <td className="p-3"><div className="font-medium">{auditName(bill.submitter?.full_name, bill.submitter?.email)}</div>{bill.submitter?.full_name && bill.submitter?.email && <div className="text-xs text-slate-500">{bill.submitter.email}</div>}</td>
                  <td className="p-3 text-slate-700">{formatPilotDateTime(bill.submitted_at)}</td>
                  <td className="p-3 text-right font-semibold">{money(totals.cumulative_basic)}</td><td className="p-3 text-right">{money(totals.cumulative_gst)}</td><td className="p-3 text-right font-semibold">{money(totals.current_net_payable ?? totals.cumulative_net_payable)}</td>
                  <td className="p-3"><button type="button" onClick={() => void loadPilotAttachments(bill.id)} disabled={pilotAttachmentsLoading === bill.id} className="text-xs font-semibold text-blue-600 hover:underline">{pilotAttachmentsLoading === bill.id ? "Loading files…" : files ? "Refresh files" : "View files"}</button>{files && <div className="mt-2 space-y-1"><div className="text-xs font-semibold text-slate-600">{files.length} file(s)</div>{files.length ? files.map((file: any) => <div key={file.id} className="flex max-w-[280px] items-center gap-2 text-xs"><span className="truncate text-slate-700">{file.file_name || "Attachment"}</span><button type="button" onClick={() => void openPilotFile(bill.id, file)} className="shrink-0 text-blue-600 hover:underline">Open</button></div>) : <span className="text-xs text-slate-500">No attachments were recorded for the submitted Pilot review cycle.</span>}</div>}</td>
                  <td className="p-3"><textarea aria-label={`Reject reason for ${bill.bill_number || bill.id}`} value={remarks[key] || ""} onChange={(e) => setRemarks((current) => ({ ...current, [key]: e.target.value }))} placeholder="Required for reject" className="min-h-24 w-64 rounded-xl border px-3 py-2 text-sm" /></td>
                  <td className="p-3 text-right"><div className="flex flex-col items-end gap-2"><Link href={`/forms/pilot/ra-bills/${bill.id}`} className="inline-flex w-28 justify-center rounded-xl border px-3 py-2 text-xs font-medium hover:bg-slate-50">View</Link><button type="button" disabled={pilotSavingId === bill.id} onClick={() => void updatePilotStatus(bill.id, "approve")} className="inline-flex w-28 justify-center rounded-xl border border-emerald-800 bg-emerald-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-60">Approve</button><button type="button" disabled={pilotSavingId === bill.id || !remarks[key]?.trim()} onClick={() => void updatePilotStatus(bill.id, "reject")} className="inline-flex w-28 justify-center rounded-xl border border-rose-800 bg-rose-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-60">Reject</button></div></td>
                </tr>;
              })}
              {bills.map((bill) => {
                const wo = maps.woMap.get(bill.work_order_id);
                const vendor = maps.vendorMap.get(bill.vendor_id);
                const site = wo?.site_id ? maps.siteMap.get(wo.site_id) : null;
                const company = wo?.company_id
                  ? maps.companyMap.get(wo.company_id)
                  : null;
                const remarkKey = `ra-${bill.id}`;
                const billDocuments = raDocumentsForBill(bill.id);

                return (
                  <tr key={bill.id} className="border-t align-top">
                    <td className="p-3">
                      <div className="font-semibold text-slate-950">
                        RA Bill No. {bill.ra_number}
                      </div>
                      <div className="text-xs text-slate-500">
                        Date: {bill.ra_date || "-"}
                      </div>
                      <div className="mt-1">
                        <span className="rounded-full border border-yellow-200 bg-yellow-50 px-2 py-0.5 text-xs text-yellow-700">
                          {bill.approval_status || "Pending"}
                        </span>
                      </div>
                    </td>

                    <td className="p-3">
                      <div className="font-medium">{site?.site_name || "-"}</div>
                      <div className="text-xs text-slate-500">
                        {company?.company_name || "-"}
                      </div>
                      <div className="mt-1">
                        {wo?.id ? (
                          <Link
                            href={`/work-orders/${wo.id}`}
                            className="text-blue-600 hover:underline"
                          >
                            {wo.wo_number}
                          </Link>
                        ) : (
                          "-"
                        )}
                      </div>
                    </td>

                    <td className="p-3">{vendor?.vendor_name || "-"}</td>

                    <td className="p-3">
                      <div className="max-w-[180px] truncate font-medium text-slate-800">
                        {auditName(bill.created_by_name, bill.created_by_email)}
                      </div>
                      {bill.created_by_name && bill.created_by_email && bill.created_by_name !== bill.created_by_email && (
                        <div className="max-w-[180px] truncate text-xs text-slate-500">
                          {bill.created_by_email}
                        </div>
                      )}
                    </td>

                    <td className="p-3 text-slate-700">
                      {formatDateTime(bill.created_at)}
                    </td>

                    <td className="p-3 text-right font-semibold">
                      {money(bill.gross_amount)}
                    </td>

                    <td className="p-3 text-right">
                      {money(bill.gst_amount)}
                    </td>

                    <td className="p-3 text-right font-semibold">
                      {money(bill.net_amount)}
                    </td>

                    <td className="p-3">
                      <div className="font-medium">
                        {raDocumentCount(bill.id)} file(s)
                      </div>

                      {billDocuments.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {billDocuments.map((document) => (
                            <div
                              key={document.id}
                              className="flex max-w-[260px] items-center justify-between gap-2"
                            >
                              <span className="truncate text-xs text-slate-600">
                                {document.file_name || "Attachment"}
                              </span>
                              <button
                                type="button"
                                onClick={() => openRaDocument(document)}
                                className="shrink-0 text-xs font-semibold text-blue-600 hover:underline"
                              >
                                Open
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="mt-1">
                        <Link
                          href={`/ra-bills/${bill.id}`}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          View files
                        </Link>
                      </div>
                    </td>

                    <td className="p-3">
                      <textarea
                        value={remarks[remarkKey] || ""}
                        onChange={(e) =>
                          setRemarks((prev) => ({
                            ...prev,
                            [remarkKey]: e.target.value,
                          }))
                        }
                        className="min-h-24 w-64 rounded-xl border px-3 py-2 text-sm outline-none focus:border-slate-400"
                        placeholder="Required for reject"
                      />
                    </td>

                    <td className="p-3 text-right">
                      <ActionButtons
                        saving={savingId === remarkKey}
                        viewHref={`/ra-bills/${bill.id}`}
                        showApprove={canApproveCommercialApprovals}
                        showReject={canRejectCommercialApprovals}
                        onApprove={() => updateRaStatus(bill.id, "Approved")}
                        onReject={() => updateRaStatus(bill.id, "Rejected")}
                      />
                    </td>
                  </tr>
                );
              })}

              {bills.length === 0 && (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-slate-500">
                    No pending RA Bills found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="border-b p-4">
          <div className="flex items-center gap-2">
            <FileMinus className="h-4 w-4 text-red-500" />
            <h2 className="font-semibold text-slate-950">
              Pending Debit Notes
            </h2>
          </div>
          <p className="text-xs text-slate-500">
            Approve or reject debit notes. Rejected records remain available for audit.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1430px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3 text-left">DN Details</th>
                <th className="p-3 text-left">Site / WO</th>
                <th className="p-3 text-left">Vendor</th>
                <th className="p-3 text-left">Created By</th>
                <th className="p-3 text-left">Created At</th>
                <th className="p-3 text-left">Type</th>
                <th className="p-3 text-right">Amount</th>
                <th className="p-3 text-left">Reason</th>
                <th className="p-3 text-left">Files</th>
                <th className="p-3 text-left">Remark / Reason</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>

            <tbody>
              {debitNotes.map((note) => {
                const wo = maps.woMap.get(note.work_order_id);
                const vendor = maps.vendorMap.get(note.vendor_id);
                const site = wo?.site_id ? maps.siteMap.get(wo.site_id) : null;
                const company = wo?.company_id
                  ? maps.companyMap.get(wo.company_id)
                  : null;
                const remarkKey = `dn-${note.id}`;
                const amount = note.total_amount || note.gross_amount || 0;
                const noteDocuments = debitDocumentsForNote(note.id);

                return (
                  <tr key={note.id} className="border-t align-top">
                    <td className="p-3">
                      <div className="font-semibold text-slate-950">
                        DN {note.debit_note_number}
                      </div>
                      <div className="text-xs text-slate-500">
                        Date: {note.debit_note_date || "-"}
                      </div>
                      <div className="mt-1">
                        <span className="rounded-full border border-yellow-200 bg-yellow-50 px-2 py-0.5 text-xs text-yellow-700">
                          {note.approval_status || "Pending"}
                        </span>
                      </div>
                    </td>

                    <td className="p-3">
                      <div className="font-medium">{site?.site_name || "-"}</div>
                      <div className="text-xs text-slate-500">
                        {company?.company_name || "-"}
                      </div>
                      <div className="mt-1">
                        {wo?.id ? (
                          <Link
                            href={`/work-orders/${wo.id}`}
                            className="text-blue-600 hover:underline"
                          >
                            {wo.wo_number}
                          </Link>
                        ) : (
                          "-"
                        )}
                      </div>
                    </td>

                    <td className="p-3">{vendor?.vendor_name || "-"}</td>
                    <td className="p-3">
                      <div className="max-w-[180px] truncate font-medium text-slate-800">
                        {auditName(note.created_by_name, note.created_by_email)}
                      </div>
                      {note.created_by_name && note.created_by_email && note.created_by_name !== note.created_by_email && (
                        <div className="max-w-[180px] truncate text-xs text-slate-500">
                          {note.created_by_email}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-slate-700">
                      {formatDateTime(note.created_at)}
                    </td>
                    <td className="p-3">{note.debit_note_type || "-"}</td>

                    <td className="p-3 text-right font-semibold">
                      {money(amount)}
                    </td>

                    <td className="p-3">
                      <div className="max-w-[260px] text-slate-700">
                        {note.reason || "-"}
                      </div>
                    </td>

                    <td className="p-3">
                      {debitDocumentCount(note.id)} file(s)
                      {noteDocuments.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {noteDocuments.map((document) => (
                            <div
                              key={document.id}
                              className="flex max-w-[260px] items-center justify-between gap-2"
                            >
                              <span className="truncate text-xs text-slate-600">
                                {document.file_name || "Attachment"}
                              </span>
                              <button
                                type="button"
                                onClick={() => openDebitDocument(document)}
                                className="shrink-0 text-xs font-semibold text-blue-600 hover:underline"
                              >
                                Open
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div>
                        <Link
                          href={`/debit-notes/${note.id}`}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          View files
                        </Link>
                      </div>
                    </td>

                    <td className="p-3">
                      <textarea
                        value={remarks[remarkKey] || ""}
                        onChange={(e) =>
                          setRemarks((prev) => ({
                            ...prev,
                            [remarkKey]: e.target.value,
                          }))
                        }
                        className="min-h-24 w-64 rounded-xl border px-3 py-2 text-sm outline-none focus:border-slate-400"
                        placeholder="Required for reject"
                      />
                    </td>

                    <td className="p-3 text-right">
                      <ActionButtons
                        saving={savingId === remarkKey}
                        viewHref={`/debit-notes/${note.id}`}
                        showApprove={canApproveCommercialApprovals}
                        showReject={canRejectCommercialApprovals}
                        onApprove={() =>
                          updateDebitNoteStatus(note.id, "Approved")
                        }
                        onReject={() =>
                          updateDebitNoteStatus(note.id, "Rejected")
                        }
                      />
                    </td>
                  </tr>
                );
              })}

              {debitNotes.length === 0 && (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-slate-500">
                    No pending Debit Notes found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pilotPdfLoading && <p className="text-sm text-slate-500">Loading reviewed RA Bills Form PDF…</p>}

    </section>
  );
}

function ActionButtons({
  saving,
  viewHref,
  showApprove = true,
  showReject = true,
  onApprove,
  onReject,
}: {
  saving: boolean;
  viewHref: string;
  showApprove?: boolean;
  showReject?: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="flex flex-col items-end gap-2">
      <Link
        href={viewHref}
        className="inline-flex w-28 justify-center rounded-xl border px-3 py-2 text-xs font-medium hover:bg-slate-50"
      >
        View
      </Link>

      {showApprove && (
        <button
          type="button"
          disabled={saving}
          onClick={onApprove}
          className="inline-flex w-28 items-center justify-center gap-1 rounded-xl bg-green-600 px-3 py-2 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Approve
        </button>
      )}

      {showReject && (
        <button
          type="button"
          disabled={saving}
          onClick={onReject}
          className="inline-flex w-28 items-center justify-center gap-1 rounded-xl bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Reject
        </button>
      )}
    </div>
  );
}

function Summary({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {title}
      </p>
      <p className="mt-2 text-xl font-bold text-slate-950">{value}</p>
    </div>
  );
}
