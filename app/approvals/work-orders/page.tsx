"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, PauseCircle, RefreshCw, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAccessContext } from "@/components/AccessContext";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { formatIstTimestamp } from "@/lib/dateTime";

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
}

const WORK_ORDER_TYPE_OPTIONS = [
  "Consultant",
  "Contractor (Labour)",
  "Contractor (SITC)",
  "Daily Wage",
  "Rental",
];

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
  return formatIstTimestamp(date);
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

  if (status === "rejected" || status === "suspended" || status === "cancelled") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-600";
}

export default function WorkOrderApprovalPage() {
  const { access } = useAccessContext();
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [documentsByWorkOrder, setDocumentsByWorkOrder] = useState<Record<string, any[]>>({});
  const [loadingDocumentsByWorkOrder, setLoadingDocumentsByWorkOrder] = useState<Record<string, boolean>>({});
  const [documentErrorsByWorkOrder, setDocumentErrorsByWorkOrder] = useState<Record<string, string>>({});
  const [companies, setCompanies] = useState<Map<string, string>>(new Map());
  const [sites, setSites] = useState<Map<string, string>>(new Map());
  const [editRows, setEditRows] = useState<Record<string, any>>({});
  const [replacementFiles, setReplacementFiles] = useState<Record<string, File | null>>({});
  const [editingWorkOrderId, setEditingWorkOrderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [workOrderDeletionEnabled, setWorkOrderDeletionEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [pilotRevisions, setPilotRevisions] = useState<Record<string, any>>({});
  const [pilotRevisionComments, setPilotRevisionComments] = useState<Record<string, string>>({});
  const [pilotRevisionBusy, setPilotRevisionBusy] = useState("");
  // Approval module permissions govern approval queues/actions; base work_orders permissions govern normal WO CRUD.
  const canViewWorkOrderApprovals =
    hasGlobalAccess(access) ||
    can(access?.permissions || [], "wo_approval", "view") ||
    can(access?.permissions || [], "wo_approval", "edit") ||
    can(access?.permissions || [], "wo_approval", "approve") ||
    can(access?.permissions || [], "wo_approval", "reject") ||
    can(access?.permissions || [], "wo_approval", "upload");
  const canEditWorkOrderApprovals =
    hasGlobalAccess(access) || can(access?.permissions || [], "wo_approval", "edit");
  const canApproveWorkOrderApprovals =
    hasGlobalAccess(access) || can(access?.permissions || [], "wo_approval", "approve");
  const canRejectWorkOrderApprovals =
    hasGlobalAccess(access) || can(access?.permissions || [], "wo_approval", "reject");
  const canUploadWorkOrderApprovalFiles =
    hasGlobalAccess(access) || can(access?.permissions || [], "wo_approval", "upload");
  const isPlatformOwner = access?.roleCodes?.includes("platform_owner") === true;

  useEffect(() => {
    if (access) {
      loadWorkOrders();
    }
  }, [access]);

  async function loadWorkOrders() {
    try {
      setLoading(true);
      setMessage("");

      if (!canViewWorkOrderApprovals) {
        setWorkOrders([]);
        setCompanies(new Map());
        setSites(new Map());
        setWorkOrderDeletionEnabled(false);
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
      setWorkOrderDeletionEnabled(approvalResult.workOrderDeletionEnabled === true);
      setEditRows(
        Object.fromEntries(
          (woData || []).map((wo: any) => [
            wo.id,
            {
              wo_date: wo.wo_date || "",
              wo_type: wo.wo_type || "",
              description: wo.description || "",
              wo_value: String(wo.wo_value ?? ""),
              gst_percent: String(wo.gst_percent ?? 18),
            },
          ]),
        ),
      );
      setReplacementFiles({});
      setEditingWorkOrderId(null);

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

      setWorkOrders(woData || []);
      setDocumentsByWorkOrder({});
      setDocumentErrorsByWorkOrder({});
    } catch (error: any) {
      setMessage(error.message || "Failed to load work orders.");
    } finally {
      setLoading(false);
    }
  }

  async function loadDocuments(workOrder: any) {
    try {
      setLoadingDocumentsByWorkOrder((prev) => ({ ...prev, [workOrder.id]: true }));
      setDocumentErrorsByWorkOrder((prev) => ({ ...prev, [workOrder.id]: "" }));
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Your session expired. Please log in again.");
      const response = await fetch(
        `/api/work-orders/documents?work_order_id=${encodeURIComponent(workOrder.id)}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Failed to load Work Order documents.");
      setDocumentsByWorkOrder((prev) => ({ ...prev, [workOrder.id]: result.documents || [] }));
    } catch (error: any) {
      setDocumentErrorsByWorkOrder((prev) => ({ ...prev, [workOrder.id]: error.message || "Failed to load Work Order documents." }));
    } finally {
      setLoadingDocumentsByWorkOrder((prev) => ({ ...prev, [workOrder.id]: false }));
    }
  }

  async function openReviewPdf(workOrder: any) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Your session expired. Please log in again.");
      const response = await fetch(`/api/work-orders/${workOrder.id}/generated-pdf`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "Unable to generate the Work Order review PDF.");
      }
      const url = URL.createObjectURL(await response.blob());
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error: any) {
      setMessage(error.message || "Unable to open the Work Order review PDF.");
    }
  }

  async function loadPilotRevision(workOrder: any) {
    try {
      setPilotRevisionBusy(workOrder.id);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Your session expired. Please log in again.");
      const response = await fetch(`/api/work-orders/${workOrder.id}/revisions`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to load Pilot revision.");
      const revision = (result.revisions || []).find((row: any) => row.status === "submitted");
      if (!revision) throw new Error("No submitted Pilot revision is awaiting approval.");
      setPilotRevisions((prev) => ({ ...prev, [workOrder.id]: revision }));
      const pdf = await fetch(`/api/work-orders/${workOrder.id}/revisions/${revision.id}/preview`, { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } });
      if (!pdf.ok) throw new Error((await pdf.json().catch(() => ({}))).error || "Unable to open revised PDF.");
      const url = URL.createObjectURL(await pdf.blob());
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error: any) { setMessage(error.message || "Unable to load Pilot revision."); } finally { setPilotRevisionBusy(""); }
  }

  async function actOnPilotRevision(workOrder: any, action: "approve" | "send_back") {
    const revision = pilotRevisions[workOrder.id];
    if (!revision) return;
    const comment = String(pilotRevisionComments[workOrder.id] || "").trim();
    if (action === "send_back" && !comment) { setMessage("A send-back comment is required."); return; }
    try {
      setPilotRevisionBusy(workOrder.id);
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`/api/work-orders/${workOrder.id}/revisions/${revision.id}`, { method: "POST", headers: { Authorization: `Bearer ${session?.access_token || ""}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: action === "send_back" ? "send_back" : "approve", ...(action === "send_back" ? { comment } : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Unable to ${action} revision.`);
      setPilotRevisions((prev) => ({ ...prev, [workOrder.id]: result.revision }));
      setMessage(action === "approve" ? "Pilot revision approved and issued." : "Pilot revision sent back for correction.");
      await loadWorkOrders();
    } catch (error: any) { setMessage(error.message || "Pilot revision action failed."); } finally { setPilotRevisionBusy(""); }
  }

  function updateEditRow(workOrderId: string, field: string, value: string) {
    setEditRows((prev) => ({
      ...prev,
      [workOrderId]: {
        ...(prev[workOrderId] || {}),
        [field]: value,
      },
    }));
  }

  function openEditPanel(wo: any) {
    setEditRows((prev) => ({
      ...prev,
      [wo.id]: {
        wo_date: wo.wo_date || "",
        wo_type: wo.wo_type || "",
        description: wo.description || "",
        wo_value: String(wo.wo_value ?? ""),
        gst_percent: String(wo.gst_percent ?? 18),
      },
    }));
    setReplacementFiles((prev) => ({ ...prev, [wo.id]: null }));
    setEditingWorkOrderId(wo.id);
  }

  function closeEditPanel() {
    setEditingWorkOrderId(null);
  }

  async function saveWorkOrderCorrections(wo: any) {
    try {
      setSavingId(wo.id);
      setMessage("");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const row = editRows[wo.id] || {};
      const formData = new FormData();
      formData.append("action", "update_details");
      formData.append("wo_date", row.wo_date || "");
      formData.append("wo_type", row.wo_type || "");
      formData.append("description", row.description || "");
      formData.append("wo_value", row.wo_value || "0");
      formData.append("gst_percent", row.gst_percent || "0");

      const replacementFile = replacementFiles[wo.id];
      if (replacementFile) {
        formData.append("work_order_file", replacementFile);
      }

      const response = await fetch(`/api/work-orders/${wo.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to save Work Order corrections.");
      }

      setMessage("Work Order corrections saved successfully.");
      await loadWorkOrders();
      setEditingWorkOrderId(null);
    } catch (error: any) {
      setMessage(error.message || "Failed to save Work Order corrections.");
    } finally {
      setSavingId("");
    }
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

  async function suspendWorkOrder(wo: any) {
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
      body: JSON.stringify({ action: "suspended" }),
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Failed to suspend work order.");
    }

    setMessage("Work order suspended successfully.");
    await loadWorkOrders();
  } catch (error: any) {
    setMessage(error.message || "Failed to suspend work order.");
  } finally {
    setSavingId("");
  }
  }

  async function deleteWorkOrder(wo: any) {
    const confirmed = window.confirm(
      `Permanently delete Work Order ${wo.wo_number || "-"}? This cannot be undone. Database records and links will be deleted; Drive and Supabase Storage files will be preserved.`,
    );
    if (!confirmed) return;

    try {
      setDeletingId(wo.id);
      setMessage("");
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Your session expired. Please log in again.");
      const response = await fetch(`/api/approvals/work-orders/${wo.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Failed to delete Work Order.");
      setWorkOrders((current) => current.filter((item) => item.id !== wo.id));
      setMessage(`Work Order ${wo.wo_number || "-"} was permanently deleted.`);
    } catch (error: any) {
      setMessage(error.message || "Failed to delete Work Order.");
    } finally {
      setDeletingId("");
    }
  }

  const pendingWorkOrders = workOrders.filter((wo) => {
    const approvalStatus = String(wo.approval_status || "")
      .trim()
      .toLowerCase();

    return !["approved", "rejected", "suspended", "cancelled"].includes(
      approvalStatus
    );
  });
  const editingWorkOrder = editingWorkOrderId
    ? pendingWorkOrders.find((wo) => wo.id === editingWorkOrderId) || null
    : null;
  const editingRow = editingWorkOrder ? editRows[editingWorkOrder.id] || {} : {};

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
            Review pending work orders and approve or suspend them based on documentation.
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
                  const isSaving = savingId === wo.id;
                  const isDeleting = deletingId === wo.id;
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
                        <div className="space-y-2">
                        {!wo.creation_request_id && (
                          <>
                            {!documentsByWorkOrder[wo.id] ? (
                              <button
                                type="button"
                                onClick={() => void loadDocuments(wo)}
                                disabled={loadingDocumentsByWorkOrder[wo.id]}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {loadingDocumentsByWorkOrder[wo.id] ? "Loading documents…" : "Load documents"}
                              </button>
                            ) : documentsByWorkOrder[wo.id].length === 0 ? (
                              <span className="text-xs text-slate-500">No documents</span>
                            ) : (
                              documentsByWorkOrder[wo.id].map((document: any) => (
                                <a
                                  key={document.id}
                                  href={document.signed_url || undefined}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline"
                                >
                                  {document.file_name || "Attached file"}
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              ))
                            )}
                            {documentErrorsByWorkOrder[wo.id] && (
                              <span className="block text-xs text-rose-700">{documentErrorsByWorkOrder[wo.id]}</span>
                            )}
                          </>
                        )}
                        {wo.creation_request_id && (
                          <button
                            type="button"
                            onClick={() => openReviewPdf(wo)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline"
                          >
                            Review Complete Work Order PDF
                            <ExternalLink className="h-3 w-3" />
                          </button>
                        )}
                        </div>
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

                          {wo.creation_request_id && canApproveWorkOrderApprovals && (
                            <>
                              <button type="button" disabled={pilotRevisionBusy === wo.id} onClick={() => void loadPilotRevision(wo)} className="rounded border border-indigo-200 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60">{pilotRevisionBusy === wo.id ? "Loading…" : "Review revised PDF"}</button>
                              {pilotRevisions[wo.id]?.status === "submitted" && <button type="button" disabled={pilotRevisionBusy === wo.id} onClick={() => void actOnPilotRevision(wo, "approve")} className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">Approve revision</button>}
                              {pilotRevisions[wo.id]?.status === "submitted" && <div className="flex items-center gap-1"><input aria-label={`Send-back comment for ${wo.wo_number || wo.id}`} className="w-40 rounded border px-2 py-1 text-xs" placeholder="Send-back comment" value={pilotRevisionComments[wo.id] || ""} onChange={(event) => setPilotRevisionComments((prev) => ({ ...prev, [wo.id]: event.target.value }))} /><button type="button" disabled={pilotRevisionBusy === wo.id} onClick={() => void actOnPilotRevision(wo, "send_back")} className="rounded bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">Send back</button></div>}
                            </>
                          )}

                          {(canEditWorkOrderApprovals ||
                            canUploadWorkOrderApprovalFiles) && (
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => openEditPanel(wo)}
                                className="rounded border border-sky-200 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-60"
                              >
                                Edit
                              </button>
                          )}

                          {canApproveWorkOrderApprovals && (
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => approveWorkOrder(wo)}
                                className="inline-flex items-center gap-1 rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Approve
                              </button>
                          )}

                          {canRejectWorkOrderApprovals && (
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => suspendWorkOrder(wo)}
                                className="inline-flex items-center gap-1 rounded bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                              >
                                <PauseCircle className="h-3.5 w-3.5" />
                                Suspend
                              </button>
                          )}

                          {isPlatformOwner && workOrderDeletionEnabled && (
                            <button
                              type="button"
                              disabled={isSaving || isDeleting}
                              onClick={() => deleteWorkOrder(wo)}
                              className="inline-flex items-center gap-1 rounded bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-800 disabled:opacity-60"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {isDeleting ? "Deleting..." : "Delete"}
                            </button>
                          )}
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

      {editingWorkOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-2xl">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-xl font-bold text-slate-950">
                  Edit Pending Work Order
                </h2>
                <p className="mt-1 font-mono text-sm font-semibold text-sky-800">
                  {editingWorkOrder.wo_number}
                </p>
              </div>
              <button
                type="button"
                onClick={closeEditPanel}
                disabled={savingId === editingWorkOrder.id}
                className="rounded border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-semibold text-slate-700">
                WO Date
                <input
                  type="date"
                  value={editingRow.wo_date || ""}
                  onChange={(event) =>
                    updateEditRow(editingWorkOrder.id, "wo_date", event.target.value)
                  }
                  disabled={!canEditWorkOrderApprovals}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="block text-sm font-semibold text-slate-700">
                Work Order Type
                <select
                  value={editingRow.wo_type || ""}
                  onChange={(event) =>
                    updateEditRow(editingWorkOrder.id, "wo_type", event.target.value)
                  }
                  disabled={!canEditWorkOrderApprovals}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="" disabled>
                    Select Work Order Type
                  </option>
                  {WORK_ORDER_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-semibold text-slate-700">
                Basic Value
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editingRow.wo_value || ""}
                  onChange={(event) =>
                    updateEditRow(editingWorkOrder.id, "wo_value", event.target.value)
                  }
                  disabled={!canEditWorkOrderApprovals}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="block text-sm font-semibold text-slate-700">
                GST %
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editingRow.gst_percent || ""}
                  onChange={(event) =>
                    updateEditRow(editingWorkOrder.id, "gst_percent", event.target.value)
                  }
                  disabled={!canEditWorkOrderApprovals}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            </div>

            <label className="mt-4 block text-sm font-semibold text-slate-700">
              Description
              <textarea
                value={editingRow.description || ""}
                onChange={(event) =>
                  updateEditRow(editingWorkOrder.id, "description", event.target.value)
                }
                disabled={!canEditWorkOrderApprovals}
                rows={5}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="mt-4 block text-sm font-semibold text-slate-700">
              Replace Work Order PDF
              <input
                type="file"
                accept="application/pdf,image/*"
                onChange={(event) =>
                  setReplacementFiles((prev) => ({
                    ...prev,
                    [editingWorkOrder.id]: event.target.files?.[0] || null,
                  }))
                }
                disabled={!canUploadWorkOrderApprovalFiles}
                className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-600 file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-700"
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                Leave blank to keep the current PDF.
              </span>
            </label>

            <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={closeEditPanel}
                disabled={savingId === editingWorkOrder.id}
                className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => saveWorkOrderCorrections(editingWorkOrder)}
                disabled={
                  savingId === editingWorkOrder.id ||
                  (!canEditWorkOrderApprovals && !canUploadWorkOrderApprovalFiles)
                }
                className="rounded bg-sky-700 px-4 py-2 text-sm font-bold text-white hover:bg-sky-800 disabled:opacity-60"
              >
                {savingId === editingWorkOrder.id ? "Saving..." : "Save Corrections"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
