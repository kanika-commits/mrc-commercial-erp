"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, FileText, RefreshCw, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
}

function workOrderCommercials(wo: any) {
  const basicValue = Number(wo?.wo_value || 0);
  const gstPercent = Number(wo?.gst_percent ?? 18);
  const safeBasic = Number.isFinite(basicValue) ? basicValue : 0;
  const safeGstPercent = Number.isFinite(gstPercent) ? gstPercent : 0;
  const gstAmount = (safeBasic * safeGstPercent) / 100;

  return {
    basicValue: safeBasic,
    gstPercent: safeGstPercent,
    gstAmount,
    totalValue: safeBasic + gstAmount,
  };
}

function formatDate(date: string | null | undefined) {
  if (!date) return "";

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";

  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(date: string | null | undefined) {
  if (!date) return "-";

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "-";

  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function auditName(name: string | null | undefined, email: string | null | undefined) {
  return name || email || "-";
}

function badgeClass(value?: string | null) {
  const status = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  if (status === "approved" || status === "active") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (status === "pending" || status === "draft") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  if (status === "rejected") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-600";
}

export default function WorkOrderApprovalPage() {
  const { access } = useAccessContext();
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [companies, setCompanies] = useState<Map<string, string>>(new Map());
  const [sites, setSites] = useState<Map<string, string>>(new Map());
  const [documents, setDocuments] = useState<Map<string, any[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (access) {
      loadWorkOrders();
    }
  }, [access]);

  async function loadWorkOrders() {
    try {
      setLoading(true);
      setMessage("");

      const canLoadWorkOrders =
        can(access?.permissions || [], "work_orders", "approve") ||
        can(access?.permissions || [], "work_orders", "reject");

      if (!canLoadWorkOrders) {
        setWorkOrders([]);
        setCompanies(new Map());
        setSites(new Map());
        setDocuments(new Map());
        setLoading(false);
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Unable to load Work Order approvals: missing auth session.");
      }

      const approvalResponse = await fetch("/api/approvals/work-orders", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const approvalResult = await approvalResponse.json().catch(() => ({}));

      if (!approvalResponse.ok) {
        throw new Error(
          approvalResult.error || "Failed to load Work Order approvals.",
        );
      }

      const woData = approvalResult.workOrders || [];

      const workOrderIds = Array.from(
        new Set((woData || []).map((wo: any) => wo.id).filter(Boolean))
      );

      setCompanies(
        new Map(
          (approvalResult.companies || []).map((item: any) => [
            item.id,
            item.company_name,
          ]),
        ),
      );
      setSites(
        new Map(
          (approvalResult.sites || []).map((item: any) => [
            item.id,
            item.site_name,
          ]),
        ),
      );

      if (workOrderIds.length > 0) {
        const token = session?.access_token;

        if (!token) {
          throw new Error("Unable to load Work Order files: missing auth session.");
        }

        const documentResponse = await fetch(
          `/api/work-orders/documents?work_order_ids=${encodeURIComponent(
            workOrderIds.join(",")
          )}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
        const documentResult = await documentResponse.json();

        if (!documentResponse.ok) {
          throw new Error(
            documentResult.error || "Failed to load Work Order files."
          );
        }

        const docMap = new Map<string, any[]>();

        (documentResult.documents || []).forEach((doc: any) => {
          const current = docMap.get(doc.work_order_id) || [];
          docMap.set(doc.work_order_id, [...current, doc]);
        });

        setDocuments(docMap);
      } else {
        setDocuments(new Map());
      }

      setWorkOrders(woData || []);
    } catch (error: any) {
      setMessage(error.message || "Failed to load work orders.");
    } finally {
      setLoading(false);
    }
  }

  function openDocument(document: any) {
    if (!document.signed_url) {
      setMessage(
        document.signed_url_error ||
          "Unable to open Work Order file. Signed URL was not available."
      );
      return;
    }

    window.open(document.signed_url, "_blank", "noopener,noreferrer");
  }

  async function approveWorkOrder(wo: any) {
  try {
    setSavingId(wo.id);
    setMessage("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("Your session expired. Please log in again.");
    }

    const response = await fetch(`/api/work-orders/${wo.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action: "approved" }),
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Failed to approve work order.");
    }

    setMessage("Work order approved successfully.");
    await loadWorkOrders();
  } catch (error: any) {
    setMessage(error.message || "Failed to approve work order.");
  } finally {
    setSavingId("");
  }
}

  async function rejectWorkOrder(wo: any) {
  try {
    setSavingId(wo.id);
    setMessage("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("Your session expired. Please log in again.");
    }

    const response = await fetch(`/api/work-orders/${wo.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action: "rejected" }),
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Failed to reject work order.");
    }

    setMessage("Work order rejected and deleted successfully.");
    await loadWorkOrders();
  } catch (error: any) {
    setMessage(error.message || "Failed to reject work order.");
  } finally {
    setSavingId("");
  }
}

  const pendingWorkOrders = workOrders.filter((wo) => {
    const approvalStatus = String(wo.approval_status || "")
      .trim()
      .toLowerCase();

    return approvalStatus !== "approved" && approvalStatus !== "rejected";
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <nav className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <span>Contract Management</span>
            <span>/</span>
            <span className="text-sky-800">Work Order Approvals</span>
          </nav>
          <h1 className="text-3xl font-bold text-slate-950">Work Order Approval</h1>
          <p className="mt-1 text-sm text-slate-500">
            Review pending work orders and approve or reject them based on documentation.
          </p>
        </div>

        <button
          type="button"
          onClick={loadWorkOrders}
          className="inline-flex items-center justify-center gap-2 rounded bg-sky-700 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-sky-800"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh List
        </button>
      </div>

      {message && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {message}
        </div>
      )}

      <div className="overflow-hidden rounded border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1500px] border-collapse text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Company / Site</th>
                <th className="px-4 py-3 font-semibold">WO Number</th>
                <th className="px-4 py-3 font-semibold">WO Details</th>
                <th className="w-[18%] px-4 py-3 font-semibold">Description</th>
                <th className="px-4 py-3 font-semibold">Created By</th>
                <th className="px-4 py-3 font-semibold">Created At</th>
                <th className="px-4 py-3 text-center font-semibold">Documentation</th>
                <th className="px-4 py-3 text-center font-semibold">Status</th>
                <th className="px-4 py-3 text-center font-semibold">Approval</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-500">
                    Loading work orders...
                  </td>
                </tr>
              ) : pendingWorkOrders.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-500">
                    No pending work orders found.
                  </td>
                </tr>
              ) : (
                pendingWorkOrders.map((wo) => {
                  const currentDocuments = documents.get(wo.id) || [];
                  const isSaving = savingId === wo.id;
                  const commercials = workOrderCommercials(wo);

                  return (
                    <tr key={wo.id} className="align-top transition-colors hover:bg-slate-50">
                      <td className="px-4 py-5">
                        <div className="text-base font-semibold leading-tight text-slate-950">
                          {companies.get(wo.company_id) || "-"}
                        </div>
                        <div className="mt-1 text-base text-slate-600">
                          {sites.get(wo.site_id) || "-"}
                        </div>
                      </td>

                      <td className="whitespace-nowrap px-4 py-5">
                        <span className="font-mono text-base font-medium text-sky-800">
                          {wo.wo_number}
                        </span>
                      </td>

                      <td className="px-4 py-5">
                        <div className="text-sm text-slate-700">
                          <span className="text-slate-400">Date:</span>{" "}
                          {wo.wo_date || "-"}
                        </div>
                        <div className="mt-1 text-sm text-slate-700">
                          <span className="text-slate-400">Type:</span>{" "}
                          {wo.wo_type || "-"}
                        </div>
                        <div className="mt-1 text-sm text-slate-700">
                          <span className="text-slate-400">Basic:</span>{" "}
                          {money(commercials.basicValue)}
                        </div>
                        <div className="mt-1 text-sm text-slate-700">
                          <span className="text-slate-400">GST:</span>{" "}
                          {money(commercials.gstAmount)} ({commercials.gstPercent}%)
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-950">
                          <span className="text-slate-400">Total:</span>{" "}
                          {money(commercials.totalValue)}
                        </div>
                      </td>

                      <td className="w-[18%] max-w-[240px] px-4 py-5">
                        <p className="line-clamp-2 text-sm leading-5 text-slate-600">
                          {wo.description || "-"}
                        </p>
                      </td>

                      <td className="px-4 py-5">
                        <div className="max-w-[180px] truncate text-sm font-medium text-slate-800">
                          {auditName(wo.created_by_name, wo.created_by_email)}
                        </div>
                        {wo.created_by_name && wo.created_by_email && wo.created_by_name !== wo.created_by_email && (
                          <div className="mt-1 max-w-[180px] truncate text-xs text-slate-500">
                            {wo.created_by_email}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-5 text-sm font-medium text-slate-700">
                        {formatDateTime(wo.created_at)}
                      </td>

                      <td className="px-4 py-5">
                        {currentDocuments.length === 0 ? (
                          <div className="flex justify-center">
                            <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                              <FileText className="h-3.5 w-3.5" />
                              No file
                            </span>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            {currentDocuments.map((document) => (
                              <div
                                key={document.id}
                                className="flex items-center justify-center gap-2"
                              >
                                <span className="max-w-[180px] truncate text-xs text-slate-600">
                                  {document.file_name || "Work Order file"}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => openDocument(document)}
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline"
                                >
                                  Open
                                  <ExternalLink className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-5 text-center">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${badgeClass(wo.status)}`}>
                          {wo.status || "-"}
                        </span>
                      </td>

                      <td className="px-4 py-5 text-center">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${badgeClass(wo.approval_status)}`}>
                          {wo.approval_status || "Pending"}
                        </span>
                        {formatDate(wo.approved_at) && (
                          <div className="mt-1 text-xs font-medium text-slate-500">
                            {formatDate(wo.approved_at)}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/work-orders/${wo.id}`}
                            className="rounded border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-100"
                          >
                            View
                          </Link>

                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => approveWorkOrder(wo)}
                            className="inline-flex items-center gap-1 rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Approve
                          </button>

                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => rejectWorkOrder(wo)}
                            className="inline-flex items-center gap-1 rounded bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t border-slate-200 bg-slate-50 px-6 py-3 text-xs text-slate-500">
          Showing{" "}
          <span className="font-semibold text-slate-900">
            {pendingWorkOrders.length}
          </span>{" "}
          pending Work Orders
        </div>
      </div>
    </div>
  );
}
