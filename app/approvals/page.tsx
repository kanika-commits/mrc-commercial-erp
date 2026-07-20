"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileMinus, FileText, Trash2 } from "lucide-react";
import AlertMessage from "@/components/AlertMessage";
import { supabase } from "@/lib/supabase";
import { useAccessContext } from "@/components/AccessContext";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { formatIstTimestamp } from "@/lib/dateTime";

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

  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);

  const [raDocuments, setRaDocuments] = useState<any[]>([]);
  const [debitDocuments, setDebitDocuments] = useState<any[]>([]);

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
  const canApproveCommercialApprovals =
    hasGlobalAccess(access) || can(access?.permissions || [], "ra_approval", "approve");
  const canRejectCommercialApprovals =
    hasGlobalAccess(access) || can(access?.permissions || [], "ra_approval", "reject");

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
      setWorkOrders([]);
      setVendors([]);
      setSites([]);
      setCompanies([]);
      setRaDocuments([]);
      setDebitDocuments([]);
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

    setBills(raBills);
    setDebitNotes(notes);

    const raBillIds = raBills.map((b) => b.id);
    const debitNoteIds = notes.map((n) => n.id);

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

    setWorkOrders(approvalResult.workOrders || []);
    setVendors(approvalResult.vendors || []);
    setSites(approvalResult.sites || []);
    setCompanies(approvalResult.companies || []);
    setRaDocuments(raDocumentData || []);
    setDebitDocuments(debitDocumentData || []);

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

      <AlertMessage
        type={messageType}
        message={message}
        onClose={() => setMessage("")}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Summary title="Pending RA Bills" value={String(bills.length)} />
        <Summary title="Pending Debit Notes" value={String(debitNotes.length)} />
        <Summary
          title="Pending RA Value"
          value={money(
            bills.reduce((sum, bill) => sum + Number(bill.net_amount || 0), 0)
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
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1480px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3 text-left">RA Details</th>
                <th className="p-3 text-left">Site / WO</th>
                <th className="p-3 text-left">Vendor</th>
                <th className="p-3 text-left">Created By</th>
                <th className="p-3 text-left">Created At</th>
                <th className="p-3 text-right">Gross</th>
                <th className="p-3 text-right">GST</th>
                <th className="p-3 text-right">Net</th>
                <th className="p-3 text-left">Files</th>
                <th className="p-3 text-left">Remark / Reason</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>

            <tbody>
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
