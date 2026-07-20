"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileMinus, Plus, Search, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import { formatIstTimestamp } from "@/lib/dateTime";

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
}

function formatDateTime(value: string | null | undefined) {
  return formatIstTimestamp(value);
}

function auditName(name?: string | null, email?: string | null) {
  return name || email || "-";
}

function statusClass(value?: string | null) {
  const status = String(value || "").toLowerCase();

  if (status === "approved") return "border-green-200 bg-green-50 text-green-700";
  if (status === "pending") return "border-yellow-200 bg-yellow-50 text-yellow-700";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-700";

  return "border-slate-200 bg-slate-50 text-slate-700";
}

export default function DebitNotesPage() {
  const { access } = useAccessContext();
  const [notes, setNotes] = useState<any[]>([]);
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [deleteNote, setDeleteNote] = useState<any | null>(null);
  const [deletionReason, setDeletionReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  const canDelete = can(access?.permissions || [], "debit_notes", "delete");

  useEffect(() => {
    loadNotes();
  }, []);

  async function loadNotes() {
    try {
      setLoading(true);
      setError("");

      const { data: noteData, error: noteError } = await supabase
        .from("debit_notes")
        .select(`
          id,
          work_order_id,
          ra_bill_id,
          vendor_id,
          debit_note_number,
          debit_note_date,
          debit_note_type,
          reason,
          gross_amount,
          total_amount,
          status,
          approval_status,
          created_by_name,
          created_by_email,
          approved_by_name,
          approved_by_email,
          approved_at,
          created_at
        `)
        .ilike("approval_status", "approved")
        .order("created_at", { ascending: false });

      if (noteError) throw noteError;

      const loadedNotes = noteData || [];
      setNotes(loadedNotes);

      const workOrderIds = Array.from(
        new Set(loadedNotes.map((n: any) => n.work_order_id).filter(Boolean))
      );
      const vendorIds = Array.from(
        new Set(loadedNotes.map((n: any) => n.vendor_id).filter(Boolean))
      );

      const [{ data: workOrderData }, { data: vendorData }] = await Promise.all([
        workOrderIds.length
          ? supabase
              .from("work_orders")
              .select("id, wo_number, company_id, site_id")
              .in("id", workOrderIds)
          : Promise.resolve({ data: [] }),
        vendorIds.length
          ? supabase.from("vendors").select("id, vendor_name").in("id", vendorIds)
          : Promise.resolve({ data: [] }),
      ]);

      setWorkOrders(workOrderData || []);
      setVendors(vendorData || []);
    } catch (loadError: any) {
      setError(loadError.message || "Failed to load Debit Notes.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmDelete() {
    if (!deleteNote) return;

    const reason = deletionReason.trim();

    if (reason.length < 10) {
      setMessage("Deletion reason must be at least 10 characters.");
      return;
    }

    try {
      setDeleting(true);
      setMessage("");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Please sign in again to delete this Debit Note.");
      }

      const response = await fetch(
        `/api/debit-notes?debit_note_id=${encodeURIComponent(deleteNote.id)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ deletion_reason: reason }),
        }
      );
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to delete Debit Note.");
      }

      setNotes((prev) => prev.filter((note) => note.id !== deleteNote.id));
      setDeleteNote(null);
      setDeletionReason("");
      setMessage("Debit Note deleted successfully.");
    } catch (deleteError: any) {
      setMessage(deleteError.message || "Failed to delete Debit Note.");
    } finally {
      setDeleting(false);
    }
  }

  const woMap = new Map((workOrders || []).map((wo: any) => [wo.id, wo]));
  const vendorMap = new Map((vendors || []).map((vendor: any) => [vendor.id, vendor]));

  const totalNotes = notes.length;

  const totalDebitValue = notes.reduce(
    (sum: number, note: any) =>
      sum + Number(note.total_amount || note.gross_amount || 0),
    0
  );

  if (loading) {
    return <p className="text-sm text-slate-500">Loading approved Debit Notes...</p>;
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Failed to load Debit Notes: {error}
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
            <FileMinus className="h-3.5 w-3.5" />
            Contract Management
          </div>

          <h1 className="text-3xl font-bold text-slate-950">
            Approved Debit Notes
          </h1>
          <p className="text-sm text-slate-500">
            Approved debit notes available for commercial adjustment tracking.
          </p>
        </div>

        <Link
          href="/debit-notes/new"
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
          New Debit Note
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Summary title="Approved Debit Notes" value={String(totalNotes)} />
        <Summary title="Approved Debit Value" value={money(totalDebitValue)} />
        <Summary
          title="Average Debit Value"
          value={money(totalNotes ? totalDebitValue / totalNotes : 0)}
        />
      </div>

      {message && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm font-medium text-sky-800">
          {message}
        </div>
      )}

      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="border-b p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-950">
                Approved Debit Note Register
              </h2>
              <p className="text-xs text-slate-500">
                Commercial adjustment records cleared by HO.
              </p>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                className="h-10 w-72 rounded-xl border bg-white pl-9 pr-3 text-sm outline-none focus:border-slate-400"
                placeholder="Search DN no, WO, vendor..."
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1680px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3 text-left">Date</th>
                <th className="p-3 text-left">Debit Note Number</th>
                <th className="p-3 text-left">Vendor</th>
                <th className="p-3 text-left">WO Number</th>
                <th className="p-3 text-left">Type</th>
                <th className="p-3 text-left">Reason</th>
                <th className="p-3 text-right">Amount</th>
                <th className="p-3 text-left">Created By</th>
                <th className="p-3 text-left">Created At</th>
                <th className="p-3 text-left">Approved By</th>
                <th className="p-3 text-left">Approved At</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>

            <tbody>
              {notes.map((note: any) => {
                const wo = woMap.get(note.work_order_id);
                const vendor = vendorMap.get(note.vendor_id);

                return (
                  <tr key={note.id} className="border-t hover:bg-slate-50">
                    <td className="p-3">{note.debit_note_date || "-"}</td>

                    <td className="p-3 font-semibold text-slate-950">
                      {note.debit_note_number}
                    </td>

                    <td className="p-3">{vendor?.vendor_name || "-"}</td>

                    <td className="p-3">
                      {note.work_order_id ? (
                        <Link
                          href={`/work-orders/${note.work_order_id}`}
                          className="text-blue-600 hover:underline"
                        >
                          {wo?.wo_number || "-"}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>

                    <td className="p-3">{note.debit_note_type || "-"}</td>

                    <td className="p-3">
                      <div className="max-w-[260px] line-clamp-2">
                        {note.reason || "-"}
                      </div>
                    </td>

                    <td className="p-3 text-right font-semibold">
                      {money(note.total_amount || note.gross_amount)}
                    </td>

                    <td className="p-3">
                      <div className="max-w-[180px] truncate font-medium">
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

                    <td className="p-3">
                      <div className="max-w-[180px] truncate font-medium">
                        {auditName(note.approved_by_name, note.approved_by_email)}
                      </div>
                      {note.approved_by_name && note.approved_by_email && note.approved_by_name !== note.approved_by_email && (
                        <div className="max-w-[180px] truncate text-xs text-slate-500">
                          {note.approved_by_email}
                        </div>
                      )}
                    </td>

                    <td className="p-3 text-slate-700">
                      {formatDateTime(note.approved_at)}
                    </td>

                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Link
                          href={`/debit-notes/${note.id}`}
                          className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
                        >
                          View
                        </Link>

                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteNote(note);
                              setDeletionReason("");
                              setMessage("");
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {notes.length === 0 && (
                <tr>
                  <td colSpan={12} className="p-8 text-center text-slate-500">
                    No approved Debit Notes found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {deleteNote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-950">
                  Delete Debit Note
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  This will hard delete Debit Note{" "}
                  <span className="font-semibold text-slate-950">
                    {deleteNote.debit_note_number || "-"}
                  </span>{" "}
                  after saving an audit snapshot.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setDeleteNote(null);
                  setDeletionReason("");
                }}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                disabled={deleting}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mt-5 block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Deletion Reason
              </span>
              <textarea
                value={deletionReason}
                onChange={(event) => setDeletionReason(event.target.value)}
                className="min-h-28 w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
                placeholder="Enter why this approved Debit Note is being deleted..."
                disabled={deleting}
              />
            </label>

            <p className="mt-2 text-xs text-slate-500">
              Minimum 10 characters required.
            </p>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setDeleteNote(null);
                  setDeletionReason("");
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting || deletionReason.trim().length < 10}
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete Debit Note"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
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
