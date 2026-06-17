"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileMinus, FileText, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
}

type ApprovalAction = "Approved" | "Rejected";
type RaApprovalAction = "Approved" | "Rejected";

export default function ApprovalsPage() {
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
  const [remarks, setRemarks] = useState<Record<string, string>>({});

  useEffect(() => {
    loadApprovals();
  }, []);

  async function loadApprovals() {
    setLoading(true);
    setMessage("");

    const { data: billData, error: billError } = await supabase
      .from("ra_bills")
      .select("*")
      .eq("approval_status", "Pending")
      .order("created_at", { ascending: false });

    if (billError) {
      setMessage(billError.message);
      setLoading(false);
      return;
    }

    const { data: debitData, error: debitError } = await supabase
      .from("debit_notes")
      .select("*")
      .eq("approval_status", "Pending")
      .order("created_at", { ascending: false });

    if (debitError) {
      setMessage(debitError.message);
      setLoading(false);
      return;
    }

    const raBills = billData || [];
    const notes = debitData || [];

    setBills(raBills);
    setDebitNotes(notes);

    const workOrderIds = Array.from(
      new Set(
        [
          ...raBills.map((b) => b.work_order_id),
          ...notes.map((n) => n.work_order_id),
        ].filter(Boolean)
      )
    );

    const vendorIds = Array.from(
      new Set(
        [
          ...raBills.map((b) => b.vendor_id),
          ...notes.map((n) => n.vendor_id),
        ].filter(Boolean)
      )
    );

    const raBillIds = raBills.map((b) => b.id);
    const debitNoteIds = notes.map((n) => n.id);

    const { data: woData } = workOrderIds.length
      ? await supabase
          .from("work_orders")
          .select("id, wo_number, company_id, site_id")
          .in("id", workOrderIds)
      : { data: [] };

    const siteIds = Array.from(
      new Set((woData || []).map((wo: any) => wo.site_id).filter(Boolean))
    );

    const companyIds = Array.from(
      new Set((woData || []).map((wo: any) => wo.company_id).filter(Boolean))
    );

    const { data: vendorData } = vendorIds.length
      ? await supabase
          .from("vendors")
          .select("id, vendor_name")
          .in("id", vendorIds)
      : { data: [] };

    const { data: siteData } = siteIds.length
      ? await supabase
          .from("sites")
          .select("id, site_name, site_code")
          .in("id", siteIds)
      : { data: [] };

    const { data: companyData } = companyIds.length
      ? await supabase
          .from("companies")
          .select("id, company_name, company_code")
          .in("id", companyIds)
      : { data: [] };

    let raDocumentData: any[] = [];

    if (raBillIds.length) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        setMessage("Unable to load RA Bill documents: missing auth session.");
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
        setMessage(documentResult.error || "Failed to load RA Bill documents.");
        setLoading(false);
        return;
      }

      raDocumentData = documentResult.documents || [];
    }

    let debitDocumentData: any[] = [];

    if (debitNoteIds.length) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        setMessage("Unable to load Debit Note documents: missing auth session.");
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
        setMessage(documentResult.error || "Failed to load Debit Note documents.");
        setLoading(false);
        return;
      }

      debitDocumentData = documentResult.documents || [];
    }

    setWorkOrders(woData || []);
    setVendors(vendorData || []);
    setSites(siteData || []);
    setCompanies(companyData || []);
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
      setMessage(
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
      setMessage(
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

    const remark = remarks[`ra-${billId}`]?.trim() || "";

    if (action === "Rejected" && !remark) {
      setMessage("Reason is required for Reject.");
      setSavingId("");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email || "";
    const name =
      userData.user?.user_metadata?.full_name ||
      userData.user?.email ||
      "HO User";

    const now = new Date().toISOString();

    let updateData: any = {
      approval_status: action,
    };

    if (action === "Approved") {
      updateData = {
        ...updateData,
        status: "Approved",
        approved_by_name: name,
        approved_by_email: email,
        approved_at: now,
      };
    }

    if (action === "Rejected") {
      updateData = {
        ...updateData,
        status: "Rejected",
        rejected_by_name: name,
        rejected_by_email: email,
        rejected_at: now,
        rejection_reason: remark,
      };
    }

    const { error } = await supabase
      .from("ra_bills")
      .update(updateData)
      .eq("id", billId);

    if (error) {
      setMessage(error.message);
      setSavingId("");
      return;
    }

    setBills((prev) => prev.filter((bill) => bill.id !== billId));
    setSavingId("");
  }

  async function updateDebitNoteStatus(
    debitNoteId: string,
    action: ApprovalAction
  ) {
    setMessage("");
    setSavingId(`dn-${debitNoteId}`);

    const remark = remarks[`dn-${debitNoteId}`]?.trim() || "";

    if (action === "Rejected" && remark.length < 10) {
      setMessage("Reason must be at least 10 characters for Reject/Delete.");
      setSavingId("");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email || "";
    const name =
      userData.user?.user_metadata?.full_name ||
      userData.user?.email ||
      "HO User";

    const now = new Date().toISOString();

    if (action === "Rejected") {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setMessage("Please sign in again to delete the Debit Note.");
        setSavingId("");
        return;
      }

      const response = await fetch(
        `/api/debit-notes?debit_note_id=${encodeURIComponent(debitNoteId)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ deletion_reason: remark }),
        }
      );
      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to delete Debit Note.");
        setSavingId("");
        return;
      }

      setDebitNotes((prev) =>
        prev.filter((note) => note.id !== debitNoteId)
      );
      setDebitDocuments((prev) =>
        prev.filter((document) => document.debit_note_id !== debitNoteId)
      );
      setSavingId("");
      return;
    }

    let updateData: any = {
      approval_status: action,
    };

    if (action === "Approved") {
      updateData = {
        ...updateData,
        status: "Approved",
        approved_by_name: name,
        approved_by_email: email,
        approved_at: now,
      };
    }

    const { error } = await supabase
      .from("debit_notes")
      .update(updateData)
      .eq("id", debitNoteId);

    if (error) {
      setMessage(error.message);
      setSavingId("");
      return;
    }

    setDebitNotes((prev) =>
      prev.filter((note) => note.id !== debitNoteId)
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

      {message && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {message}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
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
          <table className="w-full min-w-[1300px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3 text-left">RA Details</th>
                <th className="p-3 text-left">Site / WO</th>
                <th className="p-3 text-left">Vendor</th>
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
                        onApprove={() => updateRaStatus(bill.id, "Approved")}
                        onReject={() => updateRaStatus(bill.id, "Rejected")}
                      />
                    </td>
                  </tr>
                );
              })}

              {bills.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-500">
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
            Approve or reject/delete debit notes.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1250px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3 text-left">DN Details</th>
                <th className="p-3 text-left">Site / WO</th>
                <th className="p-3 text-left">Vendor</th>
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
                        placeholder="Required for reject/delete"
                      />
                    </td>

                    <td className="p-3 text-right">
                      <ActionButtons
                        saving={savingId === remarkKey}
                        viewHref={`/debit-notes/${note.id}`}
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
                  <td colSpan={9} className="p-8 text-center text-slate-500">
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
  onApprove,
  onReject,
}: {
  saving: boolean;
  viewHref: string;
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

      <button
        type="button"
        disabled={saving}
        onClick={onApprove}
        className="inline-flex w-28 items-center justify-center gap-1 rounded-xl bg-green-600 px-3 py-2 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        Approve
      </button>

      <button
        type="button"
        disabled={saving}
        onClick={onReject}
        className="inline-flex w-28 items-center justify-center gap-1 rounded-xl bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Reject
      </button>
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
