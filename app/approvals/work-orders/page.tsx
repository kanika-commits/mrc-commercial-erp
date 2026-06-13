"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

function money(value: any) {
  return `Rs. ${Number(value || 0).toLocaleString("en-IN")}`;
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export default function WorkOrderApprovalPage() {
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [companies, setCompanies] = useState<Map<string, string>>(new Map());
  const [sites, setSites] = useState<Map<string, string>>(new Map());
  const [documents, setDocuments] = useState<Map<string, any>>(new Map());
  const [removeFile, setRemoveFile] = useState<Record<string, boolean>>({});
  const [newFiles, setNewFiles] = useState<Record<string, File | null>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadWorkOrders();
  }, []);

  async function loadWorkOrders() {
    try {
      setLoading(true);
      setMessage("");

      const { data: woData, error: woError } = await supabase
        .from("work_orders")
        .select(`
          id,
          organization_id,
          company_id,
          site_id,
          wo_number,
          wo_date,
          wo_type,
          description,
          status,
          wo_value,
          approval_status,
          department,
          cost_code,
          created_at
        `)
        .order("created_at", { ascending: false });

      if (woError) throw woError;

      const workOrderIds = Array.from(
        new Set((woData || []).map((wo: any) => wo.id).filter(Boolean))
      );

      const companyIds = Array.from(
        new Set((woData || []).map((wo: any) => wo.company_id).filter(Boolean))
      );

      const siteIds = Array.from(
        new Set((woData || []).map((wo: any) => wo.site_id).filter(Boolean))
      );

      if (companyIds.length > 0) {
        const { data: companyData } = await supabase
          .from("companies")
          .select("id, company_name")
          .in("id", companyIds);

        setCompanies(
          new Map((companyData || []).map((item: any) => [item.id, item.company_name]))
        );
      } else {
        setCompanies(new Map());
      }

      if (siteIds.length > 0) {
        const { data: siteData } = await supabase
          .from("sites")
          .select("id, site_name")
          .in("id", siteIds);

        setSites(new Map((siteData || []).map((item: any) => [item.id, item.site_name])));
      } else {
        setSites(new Map());
      }

      if (workOrderIds.length > 0) {
        const { data: docData, error: docError } = await supabase
          .from("work_order_documents")
          .select("id, organization_id, work_order_id, file_name, file_url, file_path, uploaded_at")
          .in("work_order_id", workOrderIds)
          .order("uploaded_at", { ascending: false });

        if (docError) throw docError;

        const docMap = new Map<string, any>();

        (docData || []).forEach((doc: any) => {
          if (!docMap.has(doc.work_order_id)) {
            docMap.set(doc.work_order_id, doc);
          }
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

  async function replaceFileIfNeeded(wo: any) {
    const shouldRemove = removeFile[wo.id] || false;
    const selectedFile = newFiles[wo.id] || null;
    const currentDoc = documents.get(wo.id);

    if (!shouldRemove) {
      return;
    }

    if (!selectedFile) {
      throw new Error(`New file is required for ${wo.wo_number}`);
    }

    const cleanName = safeFileName(selectedFile.name);
    const newPath = `work-orders/${wo.id}/${Date.now()}-${cleanName}`;

    const { error: uploadError } = await supabase.storage
      .from("work-order-documents")
      .upload(newPath, selectedFile, {
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage
      .from("work-order-documents")
      .getPublicUrl(newPath);

    if (currentDoc?.file_path) {
      await supabase.storage
        .from("work-order-documents")
        .remove([currentDoc.file_path]);
    }

    if (currentDoc?.id) {
      const { error: deleteDocError } = await supabase
        .from("work_order_documents")
        .delete()
        .eq("id", currentDoc.id);

      if (deleteDocError) throw deleteDocError;
    }

    const { error: insertDocError } = await supabase
      .from("work_order_documents")
      .insert({
        organization_id: wo.organization_id,
        work_order_id: wo.id,
        file_name: selectedFile.name,
        file_url: publicUrlData.publicUrl,
        file_path: newPath,
      });

    if (insertDocError) throw insertDocError;
  }

  async function updateApproval(wo: any, approvalStatus: string, status: string) {
  try {
    setSavingId(wo.id);
    setMessage("");

    await replaceFileIfNeeded(wo);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const userEmail = user?.email || "";
    const userName =
      user?.user_metadata?.full_name ||
      user?.user_metadata?.name ||
      userEmail;

    const updateData: any = {
      approval_status: approvalStatus,
      status,
    };

    if (approvalStatus === "approved") {
      updateData.approved_by_name = userName;
      updateData.approved_by_email = userEmail;
      updateData.approved_at = new Date().toISOString();
    }

    if (approvalStatus === "rejected") {
      updateData.rejected_by_name = userName;
      updateData.rejected_by_email = userEmail;
      updateData.rejected_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from("work_orders")
      .update(updateData)
      .eq("id", wo.id);

    if (error) throw error;

    setMessage("Work order updated successfully.");
    setRemoveFile((prev) => ({ ...prev, [wo.id]: false }));
    setNewFiles((prev) => ({ ...prev, [wo.id]: null }));
    await loadWorkOrders();
  } catch (error: any) {
    setMessage(error.message || "Failed to update work order.");
  } finally {
    setSavingId("");
  }
}

  const pendingWorkOrders = workOrders.filter(
    (wo) => (wo.approval_status || "").toLowerCase() !== "approved"
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Work Order Approval</h1>
          <p className="text-gray-500">
            Review pending work orders and approve or suspend them.
          </p>
        </div>

        <button
          type="button"
          onClick={loadWorkOrders}
          className="rounded-lg bg-blue-600 px-4 py-2 text-white"
        >
          Refresh
        </button>
      </div>

      {message && (
        <div className="rounded-lg border bg-yellow-50 p-3 text-sm text-yellow-800">
          {message}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full min-w-[1900px] text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-3 text-left">Company</th>
              <th className="p-3 text-left">Site</th>
              <th className="p-3 text-left">WO Number</th>
              <th className="p-3 text-left">WO Date</th>
              <th className="p-3 text-left">WO Type</th>
              <th className="p-3 text-left">Description</th>
              <th className="p-3 text-left">WO Value</th>
              <th className="p-3 text-left">Current File</th>
              <th className="p-3 text-left">Replace File</th>
              <th className="p-3 text-left">New File</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Approval</th>
              <th className="p-3 text-left">View</th>
              <th className="p-3 text-left">Action</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={14} className="p-6 text-center text-gray-500">
                  Loading work orders...
                </td>
              </tr>
            ) : pendingWorkOrders.length === 0 ? (
              <tr>
                <td colSpan={14} className="p-6 text-center text-gray-500">
                  No pending work orders found.
                </td>
              </tr>
            ) : (
              pendingWorkOrders.map((wo) => {
                const currentDoc = documents.get(wo.id);
                const isSaving = savingId === wo.id;

                return (
                  <tr key={wo.id} className="border-t align-top">
                    <td className="p-3">{companies.get(wo.company_id) || "-"}</td>
                    <td className="p-3">{sites.get(wo.site_id) || "-"}</td>
                    <td className="p-3 font-medium">{wo.wo_number}</td>
                    <td className="p-3">{wo.wo_date || "-"}</td>
                    <td className="p-3">{wo.wo_type || "-"}</td>
                    <td className="p-3">{wo.description || "-"}</td>
                    <td className="p-3">{money(wo.wo_value)}</td>

                    <td className="p-3">
                      {currentDoc ? (
                        <a
                          href={currentDoc.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 underline"
                        >
                          Open File
                        </a>
                      ) : (
                        "No file"
                      )}
                    </td>

                    <td className="p-3">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={removeFile[wo.id] || false}
                          onChange={(e) =>
                            setRemoveFile((prev) => ({
                              ...prev,
                              [wo.id]: e.target.checked,
                            }))
                          }
                        />
                        <span>Replace</span>
                      </label>
                    </td>

                    <td className="p-3">
                      <input
                        type="file"
                        disabled={!removeFile[wo.id]}
                        onChange={(e) =>
                          setNewFiles((prev) => ({
                            ...prev,
                            [wo.id]: e.target.files?.[0] || null,
                          }))
                        }
                        className="w-56 rounded border px-2 py-1"
                      />
                    </td>

                    <td className="p-3">{wo.status || "-"}</td>
                    <td className="p-3">{wo.approval_status || "-"}</td>

                    <td className="p-3">
                      <Link href={`/work-orders/${wo.id}`} className="rounded border px-3 py-1">
                        View
                      </Link>
                    </td>

                    <td className="p-3">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => updateApproval(wo, "approved", "active")}
                          className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-60"
                        >
                          {isSaving ? "Saving" : "Approve"}
                        </button>

                        <button
  type="button"
  disabled={isSaving}
  onClick={() => updateApproval(wo, "rejected", "rejected")}
  className="rounded bg-red-600 px-3 py-1 text-white disabled:opacity-60"
>
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
    </div>
  );
}