"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Download } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAccessContext } from "@/components/AccessContext";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import AuditTrailCard from "@/components/AuditTrailCard";
import { formatIstTimestamp } from "@/lib/dateTime";

const STATUS_OPTIONS = [
  { value: "yet_to_start", label: "Yet to Start" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "suspended", label: "Suspended" },
  { value: "terminated", label: "Terminated" },
];

const CHANGE_TYPES = {
  rate_terms_revision: {
    title: "Rate/Terms Revision",
    button: "Add Rate/Terms Revision",
    numberPrefix: "R",
  },
  additional_work: {
    title: "Additional Work",
    button: "Add Additional Work",
    numberPrefix: "AR",
  },
} as const;

type ChangeType = keyof typeof CHANGE_TYPES;

function money(value: any) {
  return `Rs. ${Number(value || 0).toLocaleString("en-IN")}`;
}

function statusLabel(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  return STATUS_OPTIONS.find((option) => option.value === normalized)?.label || value || "-";
}

function workOrderStatusBanner(status: string | null | undefined, approvalStatus: string | null | undefined) {
  const statusKey = String(status || "").trim().toLowerCase();
  const approvalKey = String(approvalStatus || "").trim().toLowerCase();

  if (
    statusKey === "suspended" ||
    approvalKey === "rejected" ||
    approvalKey === "suspended"
  ) {
    return {
      className: "border-red-200 bg-red-50 text-red-800",
      text:
        "This Work Order is suspended. Existing records remain available for audit. New commercial transactions are not permitted.",
    };
  }

  if (statusKey === "active" && approvalKey === "pending") {
    return {
      className: "border-amber-200 bg-amber-50 text-amber-800",
      text:
        "This Work Order is pending approval. Commercial transactions are permitted. Core details may still be edited until approval.",
    };
  }

  if (statusKey === "active" && approvalKey === "approved") {
    return {
      className: "border-emerald-200 bg-emerald-50 text-emerald-800",
      text:
        "This Work Order is approved. Core details are locked. Future commercial changes must be made using Revised PO or Additional Work.",
    };
  }

  return null;
}

function normalizeLinkedVendorRows(rows: any[]) {
  return rows.map((row) => ({
    id: row.id || row.vendor_id,
    vendor_id: row.vendor_id || row.vendor?.id || row.vendors?.id || null,
    vendor_role: row.vendor_role || "-",
    is_primary: row.is_primary === true,
    vendors: row.vendor || row.vendors || null,
  }));
}

function isMainVendorLink(row: any) {
  const role = String(row?.vendor_role || "").toLowerCase();
  return row?.is_primary === true || role.includes("main") || role.includes("primary");
}

function vendorRoleBadge(row: any) {
  return isMainVendorLink(row) ? "MAIN VENDOR" : "SUBCONTRACTOR";
}

function auditName(row: any, prefix = "") {
  return (
    row?.[`${prefix}by_name`] ||
    row?.[`${prefix}by_email`] ||
    row?.[`${prefix}by`] ||
    "-"
  );
}

function isMissingWorkOrderChangesTable(error: any) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("work_order_changes") ||
    message.includes("schema cache") ||
    message.includes("could not find the table")
  );
}

export default function WorkOrderDetailPage() {
  const { access, loading: accessLoading } = useAccessContext();
  const params = useParams();
  const workOrderId = params.id as string;

  const [workOrder, setWorkOrder] = useState<any>(null);
  const [company, setCompany] = useState<any>(null);
  const [site, setSite] = useState<any>(null);
  const [vendors, setVendors] = useState<any[]>([]);
  const [raBills, setRaBills] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
const [debitNotes, setDebitNotes] = useState<any[]>([]);
const [documents, setDocuments] = useState<any[]>([]);
  const [workOrderChanges, setWorkOrderChanges] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingRelated, setLoadingRelated] = useState(false);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [documentsLoaded, setDocumentsLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const permissions = access?.permissions || [];
  const canUpdateStatus = can(permissions, "work_orders", "edit");
  const canRemoveLinkedVendor = can(permissions, "work_orders", "delete");
  const canExportWorkOrders = can(permissions, "work_orders", "export");
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState("active");
  const [savingStatus, setSavingStatus] = useState(false);
  const [showChangeModal, setShowChangeModal] = useState(false);
  const [showSubcontractorModal, setShowSubcontractorModal] = useState(false);
  const [subcontractorMode, setSubcontractorMode] = useState<"existing" | "new">("existing");
  const [vendorOptions, setVendorOptions] = useState<any[]>([]);
  const [vendorSearch, setVendorSearch] = useState("");
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [loadingVendors, setLoadingVendors] = useState(false);
  const [linkingVendor, setLinkingVendor] = useState(false);
  const [changeType, setChangeType] = useState<ChangeType>("rate_terms_revision");
  const [changeDate, setChangeDate] = useState("");
  const [applicableDate, setApplicableDate] = useState("");
  const [additionalWorkValue, setAdditionalWorkValue] = useState("");
  const [additionalWorkGstPercent, setAdditionalWorkGstPercent] = useState("");
  const [changeDescription, setChangeDescription] = useState("");
  const [changeFile, setChangeFile] = useState<File | null>(null);
  const [savingChange, setSavingChange] = useState(false);
  const [showReactivateModal, setShowReactivateModal] = useState(false);
  const [reactivationReason, setReactivationReason] = useState("");
  const [reactivating, setReactivating] = useState(false);

  useEffect(() => {
    if (!accessLoading && access) {
      loadWorkOrder();
    }
  }, [access, accessLoading, workOrderId]);

  async function loadWorkOrder() {
    try {
      setLoading(true);
      setMessage("");
      setStatusMessage("");
      setLoadingRelated(false);
      setLoadingDocuments(false);
      setDocumentsLoaded(false);
      setDocuments([]);
      setVendors([]);
      setRaBills([]);
      setInvoices([]);
      setPayments([]);
      setDebitNotes([]);
      setWorkOrderChanges([]);

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
          created_at,
          wo_value,
          gst_percent,
          approval_status,
          department,
          cost_code,
          created_by_name,
          created_by_email,
          created_at_user,
          approved_by_name,
          approved_by_email,
          approved_at
        `)
        .eq("id", workOrderId)
        .single();

      if (woError) throw woError;

      setWorkOrder(woData);
      setSelectedStatus(
        STATUS_OPTIONS.some((option) => option.value === String(woData.status || "").toLowerCase())
          ? String(woData.status || "").toLowerCase()
          : "active"
      );

      const [companyResult, siteResult] = await Promise.all([
        woData.company_id
          ? supabase
              .from("companies")
              .select("id, company_name, company_code")
              .eq("id", woData.company_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        woData.site_id
          ? supabase
              .from("sites")
              .select("id, site_name, site_code, location, state")
              .eq("id", woData.site_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (companyResult.error) throw companyResult.error;
      if (siteResult.error) throw siteResult.error;

      setCompany(companyResult.data);
      setSite(siteResult.data);

      setLoading(false);
      void loadRelatedData(woData);
    } catch (error: any) {
      setMessage(error.message || "Failed to load work order.");
      setLoading(false);
    }
  }

  async function loadRelatedData(woData = workOrder) {
    if (!woData) return;

    try {
      setLoadingRelated(true);
      setStatusMessage("");

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        throw new Error("Unable to load Work Order related data: missing auth session.");
      }

      const [
        raResult,
        invoiceResult,
        paymentResult,
        debitNoteResult,
        vendorResponse,
        changeResult,
      ] = await Promise.all([
        supabase
          .from("ra_bills")
          .select("id, ra_number, ra_date, gross_amount, net_amount, status, approval_status, created_at, created_by_name, created_by_email, approved_by_name, approved_by_email, approved_at, vendor_id")
          .eq("work_order_id", workOrderId)
          .not("approval_status", "ilike", "rejected")
          .order("ra_date", { ascending: false }),
        supabase
          .from("invoices")
          .select("id, invoice_number, invoice_date, taxable_amount, gst_amount, invoice_amount, status, approval_status, itc_status, vendor_id, created_at, created_by_name, created_by_email, itc_claimed_by_name, itc_claimed_by_email, itc_claimed_at, itc_rejected_by_name, itc_rejected_by_email, itc_rejected_at")
          .eq("work_order_id", workOrderId)
          .not("approval_status", "ilike", "rejected")
          .order("invoice_date", { ascending: false }),
        supabase
          .from("payments")
          .select(
            "id, payment_number, payment_date, payment_amount, total_payment, transferred_amount, tds_amount, payment_mode, utr_number, reference_number, status, vendor_id, created_at, created_at_user, created_by_name, created_by_email"
          )
          .eq("work_order_id", workOrderId)
          .order("payment_date", { ascending: false }),
        supabase
          .from("debit_notes")
          .select(`
            id,
            debit_note_number,
            debit_note_date,
            debit_note_type,
            total_amount,
            reason,
            status,
            approval_status,
            vendor_id,
            created_at,
            created_by_name,
            created_by_email,
            approved_by_name,
            approved_by_email,
            approved_at
          `)
          .eq("work_order_id", workOrderId)
          .not("approval_status", "ilike", "rejected")
          .order("debit_note_date", { ascending: false }),
        fetch(
          `/api/work-orders/vendors?work_order_id=${encodeURIComponent(workOrderId)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        ),
        supabase
          .from("work_order_changes")
          .select(`
            id,
            organization_id,
            work_order_id,
            change_type,
            change_number,
            change_date,
            applicable_date,
            additional_work_value,
            gst_percent,
            gst_amount,
            updated_wo_basic_value,
            updated_total_wo_value,
            description,
            file_id,
            file_url,
            file_name,
            file_mime_type,
            created_by,
            created_at
          `)
          .eq("work_order_id", workOrderId)
          .order("created_at", { ascending: true }),
      ]);

      if (raResult.error) throw raResult.error;
      if (invoiceResult.error) throw invoiceResult.error;
      if (paymentResult.error) throw paymentResult.error;
      if (debitNoteResult.error) throw debitNoteResult.error;

      const vendorResult = await vendorResponse.json();

      if (!vendorResponse.ok) {
        throw new Error(vendorResult.error || "Failed to load Work Order vendors.");
      }

      if (changeResult.error && !isMissingWorkOrderChangesTable(changeResult.error)) {
        throw changeResult.error;
      }

      const raData = raResult.data || [];
      const invoiceData = invoiceResult.data || [];
      const paymentData = paymentResult.data || [];
      const debitNoteData = debitNoteResult.data || [];
      let linkedVendors = normalizeLinkedVendorRows(
        vendorResult.all_vendors?.[workOrderId] || []
      );

      const relatedVendorIds = Array.from(
        new Set(
          [
            ...linkedVendors.map((row) => row.vendor_id || row.vendors?.id),
            ...raData.map((row) => row.vendor_id),
            ...invoiceData.map((row) => row.vendor_id),
            ...paymentData.map((row) => row.vendor_id),
            ...debitNoteData.map((row) => row.vendor_id),
          ].filter(Boolean)
        )
      );

      const { data: relatedVendors, error: relatedVendorsError } = relatedVendorIds.length
        ? await supabase
            .from("vendors")
            .select("id, vendor_name")
            .in("id", relatedVendorIds)
        : { data: [], error: null };

      if (relatedVendorsError) throw relatedVendorsError;

      const vendorNameMap = new Map(
        (relatedVendors || []).map((vendor) => [vendor.id, vendor.vendor_name || "-"])
      );
      const enrichedRaBills = raData.map((row) => ({
        ...row,
        vendor_name: row.vendor_id ? vendorNameMap.get(row.vendor_id) || "-" : "-",
      }));
      const enrichedInvoices = invoiceData.map((row) => ({
        ...row,
        vendor_name: row.vendor_id ? vendorNameMap.get(row.vendor_id) || "-" : "-",
      }));
      const enrichedPayments = paymentData.map((row) => ({
        ...row,
        vendor_name: row.vendor_id ? vendorNameMap.get(row.vendor_id) || "-" : "-",
      }));
      const enrichedDebitNotes = debitNoteData.map((row) => ({
        ...row,
        vendor_name: row.vendor_id ? vendorNameMap.get(row.vendor_id) || "-" : "-",
      }));

      setWorkOrderChanges(changeResult.error ? [] : changeResult.data || []);
      setVendors(linkedVendors);
      setRaBills(enrichedRaBills);
      setInvoices(enrichedInvoices);
      setPayments(enrichedPayments);
      setDebitNotes(enrichedDebitNotes);
    } catch (error: any) {
      setStatusMessage(error.message || "Failed to load Work Order related data.");
    } finally {
      setLoadingRelated(false);
    }
  }

  async function loadDocuments() {
    try {
      setLoadingDocuments(true);
      setStatusMessage("");

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        throw new Error("Unable to load Work Order files: missing auth session.");
      }

      const documentResponse = await fetch(
        `/api/work-orders/documents?work_order_id=${encodeURIComponent(workOrderId)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const documentResult = await documentResponse.json();

      if (!documentResponse.ok) {
        throw new Error(documentResult.error || "Failed to load Work Order files.");
      }

      setDocuments(documentResult.documents || []);
      setDocumentsLoaded(true);
    } catch (error: any) {
      setStatusMessage(error.message || "Failed to load Work Order files.");
    } finally {
      setLoadingDocuments(false);
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

  async function removeLinkedVendor(row: any) {
    if (isMainVendorLink(row)) {
      setStatusMessage("Main vendor cannot be removed from this Work Order here.");
      return;
    }

    const confirmed = window.confirm("Remove this subcontractor from this Work Order?");
    if (!confirmed) return;

    try {
      setStatusMessage("");
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const response = await fetch("/api/work-orders/vendors", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          link_id: row.id,
          work_order_id: workOrderId,
          vendor_id: row.vendor_id || row.vendors?.id,
        }),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || "Failed to remove subcontractor.");
      }

      await loadRelatedData(workOrder);
      setStatusMessage("Subcontractor removed from this Work Order.");
    } catch (error: any) {
      setStatusMessage(error.message || "Failed to remove subcontractor.");
    }
  }

  async function openSubcontractorModal() {
    setSubcontractorMode("existing");
    setVendorSearch("");
    setSelectedVendorId("");
    setStatusMessage("");
    setShowSubcontractorModal(true);

    if (vendorOptions.length > 0) return;

    try {
      setLoadingVendors(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const response = await fetch("/api/vendors", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || "Failed to load vendors.");
      }

      setVendorOptions(result.vendors || []);
    } catch (error: any) {
      setStatusMessage(error.message || "Failed to load vendors.");
    } finally {
      setLoadingVendors(false);
    }
  }

  function vendorMatchesSearch(vendor: any, search: string) {
    const value = search.trim().toLowerCase();
    if (!value) return true;

    const contacts = vendor.contacts || [];
    return [
      vendor.vendor_name,
      vendor.contractor_type,
      vendor.pan,
      vendor.gstin,
      vendor.aadhaar_cin,
      ...contacts.flatMap((contact: any) => [
        contact.contact_name,
        contact.contact_number,
        contact.email,
      ]),
    ]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(value));
  }

  function primaryContact(vendor: any) {
    const contacts = vendor?.contacts || [];
    return (
      contacts.find((contact: any) => contact.is_primary === true) ||
      contacts[0] ||
      null
    );
  }

  async function linkExistingVendorAsSubcontractor() {
    if (!selectedVendorId) {
      setStatusMessage("Please select a vendor to link as subcontractor.");
      return;
    }

    try {
      setLinkingVendor(true);
      setStatusMessage("");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const response = await fetch("/api/work-orders/vendors", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          work_order_id: workOrderId,
          vendor_id: selectedVendorId,
          vendor_role: "Subcontractor",
        }),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || "Failed to link vendor as subcontractor.");
      }

      setShowSubcontractorModal(false);
      await loadRelatedData(workOrder);
      setStatusMessage("Vendor linked as subcontractor.");
    } catch (error: any) {
      setStatusMessage(error.message || "Failed to link vendor as subcontractor.");
    } finally {
      setLinkingVendor(false);
    }
  }

  async function updateWorkOrderStatus() {
    setStatusMessage("");

    if (!STATUS_OPTIONS.some((option) => option.value === selectedStatus)) {
      setStatusMessage("Please select a valid Work Order status.");
      return;
    }

    try {
      setSavingStatus(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const response = await fetch(`/api/work-orders/${workOrderId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: selectedStatus }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to update Work Order status.");
      }

      setShowStatusModal(false);
      setStatusMessage("Work Order status updated.");
      setWorkOrder((previous: any) =>
        previous ? { ...previous, status: selectedStatus } : previous
      );
      setStatusMessage("Work Order status updated.");
    } catch (error: any) {
      setStatusMessage(error.message || "Failed to update Work Order status.");
    } finally {
      setSavingStatus(false);
    }
  }

  async function reactivateWorkOrder() {
    const reason = reactivationReason.trim();
    setStatusMessage("");

    if (reason.length < 10) {
      setStatusMessage("Reason must be at least 10 characters.");
      return;
    }

    try {
      setReactivating(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const response = await fetch(`/api/work-orders/${workOrderId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "undo_suspension",
          reactivation_reason: reason,
        }),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || "Failed to undo Work Order suspension.");
      }

      setShowReactivateModal(false);
      setReactivationReason("");
      setWorkOrder((previous: any) =>
        previous
          ? {
              ...previous,
              status: result.status || "active",
              approval_status: result.approval_status || previous.approval_status,
            }
          : previous
      );
      setStatusMessage("Work Order suspension undone successfully.");
    } catch (error: any) {
      setStatusMessage(error.message || "Failed to undo Work Order suspension.");
    } finally {
      setReactivating(false);
    }
  }

  function nextChangeNumber(type: ChangeType) {
    const count = workOrderChanges.filter((change) => change.change_type === type).length;
    return `${CHANGE_TYPES[type].numberPrefix}${count + 1}`;
  }

  function openChangeModal(type: ChangeType) {
    setChangeType(type);
    setChangeDate("");
    setApplicableDate("");
    setAdditionalWorkValue("");
    setAdditionalWorkGstPercent("");
    setChangeDescription("");
    setChangeFile(null);
    setStatusMessage("");
    setShowChangeModal(true);
  }

  async function saveWorkOrderChange() {
    setStatusMessage("");

    if (!changeDate) {
      setStatusMessage("Change date is required.");
      return;
    }

    if (!changeDescription.trim()) {
      setStatusMessage("Description is required.");
      return;
    }

    if (changeType === "rate_terms_revision" && !applicableDate) {
      setStatusMessage("New rates/terms applicable date is required.");
      return;
    }

    if (
      changeType === "additional_work" &&
      (!additionalWorkValue || Number(additionalWorkValue) <= 0)
    ) {
      setStatusMessage("Value of Additional Work must be greater than 0.");
      return;
    }

    if (
      changeType === "additional_work" &&
      (!additionalWorkGstPercent || Number(additionalWorkGstPercent) < 0)
    ) {
      setStatusMessage("GST Rate % must be 0 or greater.");
      return;
    }

    if (!changeFile) {
      setStatusMessage("Upload file is required.");
      return;
    }

    try {
      setSavingChange(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const formData = new FormData();
      formData.append("change_type", changeType);
      formData.append("change_date", changeDate);
      formData.append("description", changeDescription.trim());
      formData.append("file", changeFile);

      if (changeType === "rate_terms_revision") {
        formData.append("applicable_date", applicableDate);
      }

      if (changeType === "additional_work") {
        formData.append("additional_work_value", additionalWorkValue);
        formData.append("gst_percent", additionalWorkGstPercent);
      }

      const response = await fetch(`/api/work-orders/${workOrderId}/changes`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || "Failed to save Work Order change.");
      }

      setShowChangeModal(false);
      await loadRelatedData(workOrder);
      setStatusMessage(`${CHANGE_TYPES[changeType].title} saved.`);
    } catch (error: any) {
      setStatusMessage(error.message || "Failed to save Work Order change.");
    } finally {
      setSavingChange(false);
    }
  }

  const mainVendor = vendors.find(isMainVendorLink);
  const mainVendorName = mainVendor?.vendors?.vendor_name || "";

 const totals = useMemo(() => {
  const originalWoBasicValue = Number(workOrder?.wo_value || 0);
  const gstPercent = Number(workOrder?.gst_percent ?? 18);
  const safeOriginalWoBasicValue = Number.isFinite(originalWoBasicValue) ? originalWoBasicValue : 0;
  const safeGstPercent = Number.isFinite(gstPercent) ? gstPercent : 0;
  const originalWoGstAmount = (safeOriginalWoBasicValue * safeGstPercent) / 100;
  const additionalWorkRows = workOrderChanges.filter(
    (change) => change.change_type === "additional_work"
  );
  const additionalWorkTotal = additionalWorkRows.reduce(
    (sum, change) => sum + Number(change.additional_work_value || 0),
    0
  );
  const additionalWorkGstTotal = additionalWorkRows.reduce(
    (sum, change) => sum + Number(change.gst_amount || 0),
    0
  );
  const safeWoBasicValue = safeOriginalWoBasicValue + additionalWorkTotal;
  const woGstAmount = originalWoGstAmount + additionalWorkGstTotal;
  const woTotalValue = safeWoBasicValue + woGstAmount;

  const totalRa = raBills
    .filter((item) => String(item.approval_status || "").toLowerCase() === "approved")
    .reduce((sum, item) => sum + Number(item.net_amount || 0), 0);

  const totalInvoices = invoices.reduce(
    (sum, item) => sum + Number(item.invoice_amount || 0),
    0
  );

  const totalPayments = payments.reduce(
    (sum, item) =>
      sum + Number(item.transferred_amount || item.payment_amount || 0),
    0
  );

  const totalDebitNotes = debitNotes
    .filter((item) => String(item.approval_status || "").toLowerCase() === "approved")
    .reduce((sum, item) => sum + Number(item.total_amount || 0), 0);

  return {
    woBasicValue: safeWoBasicValue,
    woGstAmount,
    woTotalValue,
    gstPercent: safeGstPercent,
    originalWoBasicValue: safeOriginalWoBasicValue,
    originalWoGstAmount,
    additionalWorkTotal,
    additionalWorkGstTotal,
    totalRa,
    totalInvoices,
    totalPayments,
    totalDebitNotes,
    balanceWoValue: woTotalValue - totalRa,
    payableOutstanding: totalInvoices - totalPayments - totalDebitNotes,
    raMinusInvoices: totalRa - totalInvoices,
  };
}, [workOrder, raBills, invoices, payments, debitNotes, workOrderChanges]);
const woLedgerRows = useMemo(() => {
  const rows: any[] = [];

  if (workOrder) {
    rows.push({
      date: workOrder.wo_date || workOrder.created_at,
      type: "Work Order",
      reference: workOrder.wo_number,
      vendor_name: mainVendorName || "-",
      amount: totals.woTotalValue,
      status: workOrder.approval_status || workOrder.status || "-",
      created_by: workOrder.created_by_name || workOrder.created_by_email || "-",
      created_at: workOrder.created_at_user || workOrder.created_at,
      approved_by: workOrder.approved_by_name || workOrder.approved_by_email || "-",
      approved_at: workOrder.approved_at,
    });
  }

  raBills.forEach((bill) => {
    rows.push({
      date: bill.ra_date || bill.created_at,
      type: "RA Bill",
      reference: bill.ra_number,
      vendor_name: bill.vendor_name || "-",
      amount: Number(bill.net_amount || 0),
      status: bill.approval_status || bill.status || "-",
      created_by: bill.created_by_name || bill.created_by_email || "-",
      created_at: bill.created_at,
      approved_by: bill.approved_by_name || bill.approved_by_email || "-",
      approved_at: bill.approved_at,
    });
  });

  invoices.forEach((invoice) => {
    rows.push({
      date: invoice.invoice_date || invoice.created_at,
      type: "Invoice",
      reference: invoice.invoice_number,
      vendor_name: invoice.vendor_name || "-",
      amount: Number(invoice.invoice_amount || 0),
      status: invoice.approval_status || invoice.status || "-",
      created_by: invoice.created_by_name || invoice.created_by_email || "-",
      created_at: invoice.created_at,
      approved_by:
        invoice.itc_claimed_by_name ||
        invoice.itc_claimed_by_email ||
        invoice.itc_rejected_by_name ||
        invoice.itc_rejected_by_email ||
        "-",
      approved_at: invoice.itc_claimed_at || invoice.itc_rejected_at,
    });
  });

  payments.forEach((payment) => {
    rows.push({
      date: payment.payment_date || payment.created_at,
      type: "Payment",
      reference: payment.reference_number || payment.payment_number,
      vendor_name: payment.vendor_name || "-",
      amount: Number(payment.transferred_amount || payment.payment_amount || 0),
      status: payment.status || "-",
      created_by: payment.created_by_name || payment.created_by_email || "-",
      created_at: payment.created_at_user || payment.created_at,
      approved_by: "-",
      approved_at: null,
    });
  });

  debitNotes
  .filter((note) => String(note.approval_status || "").toLowerCase() !== "rejected")
  .forEach((note) => {
    rows.push({
      date: note.debit_note_date || note.created_at,
      type: "Debit Note",
      reference: note.debit_note_number,
      vendor_name: note.vendor_name || "-",
      amount: Number(note.total_amount || 0),
      status: note.approval_status || "-",
      created_by: note.created_by_name || note.created_by_email || "-",
      created_at: note.created_at,
      approved_by: note.approved_by_name || note.approved_by_email || "-",
      approved_at: note.approved_at,
    });
  });

  return rows.sort(
    (a, b) =>
      new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime()
  );
}, [workOrder, raBills, invoices, payments, debitNotes, totals.woTotalValue, mainVendorName]);
function downloadWOLedger() {
  const headers = [
    "Date",
    "Type",
    "Reference",
    "Vendor Name",
    "Amount",
    "Status",
    "Created By",
    "Created At",
    "Approved By",
    "Approved At",
  ];

  const rows = woLedgerRows.map((row) => [
    row.date ? String(row.date).slice(0, 10) : "-",
    row.type,
    row.reference || "-",
    row.vendor_name || "-",
    row.amount || 0,
    row.status || "-",
    row.created_by || "-",
    formatIstTimestamp(row.created_at),
    row.approved_by || "-",
    formatIstTimestamp(row.approved_at),
  ]);

  const csv = [headers, ...rows]
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const safeName = String(workOrder?.wo_number || "Work-Order")
    .replace(/[^a-z0-9]/gi, "-")
    .toLowerCase();

  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeName}-ledger.csv`;
  link.click();

  URL.revokeObjectURL(url);
}
  if (loading) return <p className="text-gray-500">Loading work order...</p>;

  if (message) {
    return (
      <div className="rounded-lg border bg-red-50 p-4 text-red-700">
        {message}
      </div>
    );
  }

  if (!workOrder) return <p className="text-red-600">Work Order not found.</p>;

  const isApprovedWorkOrder =
    String(workOrder.approval_status || "").toLowerCase() === "approved";
  const workOrderStatusKey = String(workOrder.status || "").toLowerCase();
  const workOrderApprovalStatusKey = String(workOrder.approval_status || "").toLowerCase();
  const isSuspendedWorkOrder =
    ["suspended", "cancelled"].includes(workOrderStatusKey) ||
    ["suspended", "cancelled"].includes(workOrderApprovalStatusKey);
  const canMutateWorkOrder = !isSuspendedWorkOrder;
  const canUndoSuspension = hasGlobalAccess(access) && isSuspendedWorkOrder;
  const statusBanner = workOrderStatusBanner(
    workOrder.status,
    workOrder.approval_status
  );
  const workOrderTitle = mainVendorName
    ? `${workOrder.wo_number} - ${mainVendorName}`
    : workOrder.wo_number;
  const filteredVendorOptions = vendorOptions
    .filter((vendor) => vendorMatchesSearch(vendor, vendorSearch))
    .slice(0, 50);
  const selectedVendor = vendorOptions.find((vendor) => vendor.id === selectedVendorId);
  const selectedVendorContact = primaryContact(selectedVendor);
  const liveAdditionalWorkValue = Number(additionalWorkValue || 0);
  const liveAdditionalGstPercent = Number(additionalWorkGstPercent || 0);
  const liveUpdatedWoBasicValue =
    totals.woBasicValue +
    (Number.isFinite(liveAdditionalWorkValue) ? liveAdditionalWorkValue : 0);
  const liveAdditionalGstAmount =
    ((Number.isFinite(liveAdditionalWorkValue) ? liveAdditionalWorkValue : 0) *
      (Number.isFinite(liveAdditionalGstPercent) ? liveAdditionalGstPercent : 0)) /
    100;
  const liveUpdatedGstAmount = totals.woGstAmount + liveAdditionalGstAmount;
  const liveUpdatedWoTotalValue = liveUpdatedWoBasicValue + liveUpdatedGstAmount;

  return (
    <div className="space-y-6">
      {statusMessage && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm font-medium text-slate-800">
          {statusMessage}
        </div>
      )}

      {loadingRelated && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm font-medium text-sky-800">
          Loading related Work Order data...
        </div>
      )}

      {statusBanner && (
        <div className={`rounded-lg border p-4 text-sm font-semibold ${statusBanner.className}`}>
          {statusBanner.text}
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{workOrderTitle}</h1>
          <p className="mt-2 text-gray-500">
            Complete work order view with RA Bills, invoices, payments and vendors.
          </p>
        </div>

       <div className="flex gap-3">
  {canUndoSuspension && (
    <button
      type="button"
      onClick={() => {
        setReactivationReason("");
        setStatusMessage("");
        setShowReactivateModal(true);
      }}
      className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700"
    >
      Undo Suspension
    </button>
  )}

  {isApprovedWorkOrder && canMutateWorkOrder && (
    <button
      type="button"
      onClick={openSubcontractorModal}
      className="rounded-lg bg-[#00658b] px-4 py-2 font-medium text-white hover:opacity-90"
    >
      + Add Subcontractor
    </button>
  )}

  {canExportWorkOrders && (
    <button
      type="button"
      onClick={downloadWOLedger}
      className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-white hover:bg-slate-800"
    >
      <Download className="h-4 w-4" />
      Download Ledger
    </button>
  )}

  {canUpdateStatus && canMutateWorkOrder && (
    <button
      type="button"
      onClick={() => {
        setSelectedStatus(
          STATUS_OPTIONS.some((option) => option.value === String(workOrder.status || "").toLowerCase())
            ? String(workOrder.status || "").toLowerCase()
            : "active"
        );
        setStatusMessage("");
        setShowStatusModal(true);
      }}
      className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-800 hover:bg-slate-50"
    >
      Update Status
    </button>
  )}

  <Link href="/work-orders" className="rounded-lg border px-4 py-2">
    Back to Work Orders
  </Link>
</div>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <Summary title="WO Basic Value" value={money(totals.woBasicValue)} />
        <Summary title="GST Amount" value={money(totals.woGstAmount)} />
        <Summary title="Total Value of WO" value={money(totals.woTotalValue)} />
        <Summary title="Total RA Bills" value={money(totals.totalRa)} />
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <Summary title="Total Invoices" value={money(totals.totalInvoices)} />
        <Summary title="Total Payments" value={money(totals.totalPayments)} />
        <Summary title="RA Bills" value={String(raBills.length)} />
        <Summary title="Invoices" value={String(invoices.length)} />
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <Summary title="Payments" value={String(payments.length)} />
        <Summary title="Debit Notes" value={String(debitNotes.length)} />
        <Summary title="Balance WO Value" value={money(totals.balanceWoValue)} />
        <Summary title="RA Bills Minus Invoices" value={money(totals.raMinusInvoices)} />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
<Summary title="Payable Outstanding" value={money(totals.payableOutstanding)} />
      </section>

      <AuditTrailCard
        createdBy={workOrder.created_by_name || workOrder.created_by_email}
        createdAt={workOrder.created_at_user || workOrder.created_at}
        updatedBy={workOrder.updated_by_name || workOrder.updated_by_email || workOrder.updated_by}
        updatedAt={workOrder.updated_at_user || workOrder.updated_at}
        approvedBy={workOrder.approved_by_name || workOrder.approved_by_email}
        approvedAt={workOrder.approved_at}
      />

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Work Order Information</h2>

        <div className="grid gap-4 md:grid-cols-3">
          <Info label="WO Number" value={workOrder.wo_number} />
          <Info label="Company" value={company?.company_name || "-"} />
          <Info label="Site" value={site?.site_name || "-"} />
          <Info label="Site Location" value={site?.location || "-"} />
          <Info label="WO Date" value={workOrder.wo_date || "-"} />
          <Info label="WO Type" value={workOrder.wo_type || "-"} />
          <Info label="Status" value={statusLabel(workOrder.status)} />
          <Info label="Approval Status" value={workOrder.approval_status || "-"} />
          <Info label="WO Basic Value" value={money(totals.woBasicValue)} />
          <Info label="GST %" value={`${totals.gstPercent}%`} />
          <Info label="GST Amount" value={money(totals.woGstAmount)} />
          <Info label="Total Value of WO" value={money(totals.woTotalValue)} />
          <Info label="Department" value={workOrder.department || "-"} />
          <Info label="Cost Code" value={workOrder.cost_code || "-"} />
          <Info label="Created By" value={workOrder.created_by_name || workOrder.created_by_email || "-"} />
          <Info label="Created At" value={formatIstTimestamp(workOrder.created_at_user || workOrder.created_at)} />
          <Info label="Approved By" value={workOrder.approved_by_name || workOrder.approved_by_email || "-"} />
          <Info label="Approved At" value={formatIstTimestamp(workOrder.approved_at)} />
          <Info label="Updated By" value={workOrder.updated_by_name || workOrder.updated_by_email || workOrder.updated_by || "-"} />
          <Info label="Updated At" value={formatIstTimestamp(workOrder.updated_at_user || workOrder.updated_at)} />
        </div>
<div className="mt-6 border-t pt-4">
  <h3 className="mb-3 font-semibold">
    Work Order Files
  </h3>

  {!documentsLoaded ? (
    <button
      type="button"
      onClick={loadDocuments}
      disabled={loadingDocuments}
      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loadingDocuments ? "Loading files..." : "Load Work Order files"}
    </button>
  ) : documents.length === 0 ? (
    <p className="text-gray-500">No files attached.</p>
  ) : (
    <div className="space-y-2">
      {documents.map((doc) => (
        <div
          key={doc.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-slate-50 p-3"
        >
          <div>
            <p className="font-medium text-slate-950">
              {doc.file_name || "Work Order file"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {doc.file_path || "-"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => openDocument(doc)}
            className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800"
          >
            Open
          </button>
        </div>
      ))}
    </div>
  )}
</div>
        {workOrder.description && (
          <div className="mt-4">
            <p className="text-xs font-medium uppercase text-gray-500">Description</p>
            <p className="mt-1 text-gray-900">{workOrder.description}</p>
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">
          Linked Vendors ({vendors.length})
        </h2>

        {vendors.length === 0 ? (
          <p className="text-gray-500">No vendors linked.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {vendors.map((row) => (
              <div key={row.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <strong>{row.vendors?.vendor_name || "-"}</strong>
                    <div
                      className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-bold tracking-wide ${
                        isMainVendorLink(row)
                          ? "bg-sky-100 text-sky-800"
                          : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {vendorRoleBadge(row)}
                    </div>
                  </div>

                  {!isMainVendorLink(row) && canRemoveLinkedVendor && (
                    <button
                      type="button"
                      onClick={() => removeLinkedVendor(row)}
                      className="rounded-lg border border-red-200 px-3 py-1 text-sm font-semibold text-red-600 hover:bg-red-50"
                    >
                      Remove
                    </button>
                  )}
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <Info label="Role" value={row.vendor_role || "-"} />
                  <Info label="Primary" value={row.is_primary ? "Yes" : "No"} />
                  <Info label="PAN" value={row.vendors?.pan || "-"} />
                  <Info label="GSTIN" value={row.vendors?.gstin || "-"} />
                  <Info
                    label="Primary Contact"
                    value={
                      row.vendors?.primary_contact?.contact_name
                        ? [
                            row.vendors.primary_contact.contact_name,
                            row.vendors.primary_contact.contact_number,
                          ]
                            .filter(Boolean)
                            .join(" / ")
                        : "-"
                    }
                  />
                </div>

                {row.vendors?.id && (
                  <Link
                    href={`/vendors/${row.vendors.id}`}
                    className="mt-3 inline-block rounded border px-3 py-1 text-sm"
                  >
                    View Vendor
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {isApprovedWorkOrder && canMutateWorkOrder && (
        <section className="rounded-lg border bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Post-Approval Changes</h2>
              <p className="mt-1 text-sm text-slate-500">
                Add controlled revisions or additional work without editing the approved Work Order.
              </p>
            </div>

            {canUpdateStatus && (
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => openChangeModal("rate_terms_revision")}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                >
                  Add Rate/Terms Revision
                </button>
                <button
                  type="button"
                  onClick={() => openChangeModal("additional_work")}
                  className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Add Additional Work
                </button>
              </div>
            )}
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-gray-100">
                <tr>
                  {[
                    "Type",
                    "Number",
                    "Date",
                    "Description",
                    "Applicable Date",
                    "Additional Work Value",
                    "GST Rate",
                    "GST Amount",
                    "File",
                    "Created By",
                    "Created At",
                  ].map((header) => (
                    <th key={header} className="p-3 text-left">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {workOrderChanges.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="p-6 text-center text-gray-500">
                      No post-approval changes added.
                    </td>
                  </tr>
                ) : (
                  workOrderChanges.map((change) => (
                    <tr key={change.id} className="border-t">
                      <td className="p-3">
                        {CHANGE_TYPES[change.change_type as ChangeType]?.title || "-"}
                      </td>
                      <td className="p-3 font-semibold">{change.change_number || "-"}</td>
                      <td className="p-3">{change.change_date || "-"}</td>
                      <td className="p-3">{change.description || "-"}</td>
                      <td className="p-3">
                        {change.change_type === "rate_terms_revision"
                          ? change.applicable_date || "-"
                          : "-"}
                      </td>
                      <td className="p-3">
                        {change.change_type === "additional_work"
                          ? money(change.additional_work_value)
                          : "-"}
                      </td>
                      <td className="p-3">
                        {change.change_type === "additional_work"
                          ? `${Number(change.gst_percent || 0)}%`
                          : "-"}
                      </td>
                      <td className="p-3">
                        {change.change_type === "additional_work"
                          ? money(change.gst_amount)
                          : "-"}
                      </td>
                      <td className="p-3">
                        {change.file_url ? (
                          <a
                            href={change.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded border px-3 py-1 text-sm"
                          >
                            Open
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="p-3">{change.created_by || "-"}</td>
                      <td className="p-3">{formatIstTimestamp(change.created_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {showReactivateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div>
              <h2 className="text-xl font-bold text-slate-950">
                Undo Work Order Suspension
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Undo suspension for {workOrder.wo_number || "this Work Order"} only if it was
                suspended by mistake. Existing Drive folders and documents will not be changed.
              </p>
            </div>

            <label className="mt-5 block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Reason
              </span>
              <textarea
                value={reactivationReason}
                onChange={(event) => setReactivationReason(event.target.value)}
                rows={4}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                placeholder="Enter reason for undoing suspension"
                disabled={reactivating}
              />
              <span className="mt-1 block text-xs text-slate-500">
                Minimum 10 characters required.
              </span>
            </label>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowReactivateModal(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                disabled={reactivating}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={reactivateWorkOrder}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                disabled={reactivating}
              >
                {reactivating ? "Undoing..." : "Undo Suspension"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showStatusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-950">Update Status</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Change lifecycle status only for {workOrder.wo_number || "this Work Order"}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowStatusModal(false)}
                className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100"
                disabled={savingStatus}
              >
                x
              </button>
            </div>

            <label className="mt-5 block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Status
              </span>
              <select
                value={selectedStatus}
                onChange={(event) => setSelectedStatus(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                disabled={savingStatus}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowStatusModal(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                disabled={savingStatus}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={updateWorkOrderStatus}
                className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                disabled={savingStatus}
              >
                {savingStatus ? "Saving..." : "Save Status"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSubcontractorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-950">Add Subcontractor</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Link an existing Vendor Master record or create a new vendor and link it to this Work Order.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSubcontractorModal(false)}
                className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100"
                disabled={linkingVendor}
              >
                x
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 ${
                  subcontractorMode === "existing"
                    ? "border-[#00658b] bg-sky-50"
                    : "border-slate-200"
                }`}
              >
                <input
                  type="radio"
                  checked={subcontractorMode === "existing"}
                  onChange={() => setSubcontractorMode("existing")}
                  disabled={linkingVendor}
                />
                <span className="font-semibold text-slate-900">Select Existing Vendor</span>
              </label>

              <label
                className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 ${
                  subcontractorMode === "new"
                    ? "border-[#00658b] bg-sky-50"
                    : "border-slate-200"
                }`}
              >
                <input
                  type="radio"
                  checked={subcontractorMode === "new"}
                  onChange={() => setSubcontractorMode("new")}
                  disabled={linkingVendor}
                />
                <span className="font-semibold text-slate-900">Create New Vendor</span>
              </label>
            </div>

            {subcontractorMode === "existing" ? (
              <div className="mt-5 space-y-4">
                <label className="block">
                  <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                    Search Vendor Master
                  </span>
                  <input
                    value={vendorSearch}
                    onChange={(event) => setVendorSearch(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                    placeholder="Search by vendor name, PAN, GSTIN, or contact person"
                    disabled={loadingVendors || linkingVendor}
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                    Vendor
                  </span>
                  <select
                    value={selectedVendorId}
                    onChange={(event) => setSelectedVendorId(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                    disabled={loadingVendors || linkingVendor}
                  >
                    <option value="">
                      {loadingVendors ? "Loading vendors..." : "Select vendor"}
                    </option>
                    {filteredVendorOptions.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>
                        {vendor.vendor_name}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedVendor && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-bold text-slate-950">
                          {selectedVendor.vendor_name || "-"}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">
                          {selectedVendor.contractor_type || "Vendor Master"}
                        </p>
                      </div>
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
                        SUBCONTRACTOR
                      </span>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <Info label="PAN" value={selectedVendor.pan || "-"} />
                      <Info label="GSTIN" value={selectedVendor.gstin || "-"} />
                      <Info label="Contractor Type" value={selectedVendor.contractor_type || "-"} />
                      <Info
                        label="Primary Contact"
                        value={
                          selectedVendorContact?.contact_name
                            ? [
                                selectedVendorContact.contact_name,
                                selectedVendorContact.contact_number,
                              ]
                                .filter(Boolean)
                                .join(" / ")
                            : "-"
                        }
                      />
                    </div>
                  </div>
                )}

                {filteredVendorOptions.length === 0 && !loadingVendors && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    No matching vendors found. Choose Create New Vendor to add one.
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm text-slate-700">
                  This opens the existing Vendor creation form with all Vendor Master validations. After save,
                  the vendor will be linked to this Work Order as a subcontractor.
                </p>
                <Link
                  href={`/vendors/new?link_work_order_id=${encodeURIComponent(
                    workOrderId,
                  )}&vendor_role=Subcontractor&return_to=${encodeURIComponent(
                    `/work-orders/${workOrderId}`,
                  )}`}
                  className="mt-4 inline-flex rounded-lg bg-[#00658b] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                >
                  Open Vendor Creation Form
                </Link>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowSubcontractorModal(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                disabled={linkingVendor}
              >
                Cancel
              </button>
              {subcontractorMode === "existing" && (
                <button
                  type="button"
                  onClick={linkExistingVendorAsSubcontractor}
                  className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  disabled={linkingVendor || loadingVendors || !selectedVendorId}
                >
                  {linkingVendor ? "Linking..." : "Link as Subcontractor"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showChangeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4">
          <div className="w-full max-w-[950px] rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-950">
                  Add {CHANGE_TYPES[changeType].title}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Upload one supporting file. Original approved Work Order fields will not change.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowChangeModal(false)}
                className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100"
                disabled={savingChange}
              >
                x
              </button>
            </div>

            <div className="mt-5 grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                    {changeType === "additional_work" ? "Addition Number" : "Revision Number"}
                  </span>
                  <input
                    value={nextChangeNumber(changeType)}
                    readOnly
                    className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                    {changeType === "additional_work" ? "Date" : "Revision Date"}
                  </span>
                  <input
                    type="date"
                    value={changeDate}
                    onChange={(event) => setChangeDate(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                    disabled={savingChange}
                  />
                </label>
              </div>

              {changeType === "rate_terms_revision" ? (
                <label className="block">
                  <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                    New Rates/Terms Applicable Date
                  </span>
                  <input
                    type="date"
                    value={applicableDate}
                    onChange={(event) => setApplicableDate(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                    disabled={savingChange}
                  />
                </label>
              ) : (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                        Value of Additional Work
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={additionalWorkValue}
                        onChange={(event) => setAdditionalWorkValue(event.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                        disabled={savingChange}
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                        GST Rate %
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={additionalWorkGstPercent}
                        onChange={(event) => setAdditionalWorkGstPercent(event.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                        disabled={savingChange}
                      />
                    </label>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <Summary title="Updated Work Order Value" value={money(liveUpdatedWoBasicValue)} />
                    <Summary title="Updated GST Amount" value={money(liveUpdatedGstAmount)} />
                    <Summary title="Updated Total WO Value" value={money(liveUpdatedWoTotalValue)} />
                  </div>
                </>
              )}

              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                  Description
                </span>
                <textarea
                  value={changeDescription}
                  onChange={(event) => setChangeDescription(event.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                  disabled={savingChange}
                  placeholder={
                    changeType === "additional_work"
                      ? "Describe the additional work scope."
                      : "Describe the rate or terms revision."
                  }
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                  Upload {changeType === "additional_work" ? "Additional Work" : "Revision"} File
                </span>
                <input
                  type="file"
                  onChange={(event) => setChangeFile(event.target.files?.[0] || null)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                  disabled={savingChange}
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowChangeModal(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                disabled={savingChange}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveWorkOrderChange}
                className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                disabled={savingChange}
              >
                {savingChange ? "Saving..." : "Save Change"}
              </button>
            </div>
          </div>
        </div>
      )}

    <DataTable
      title={`Linked RA Bills (${raBills.length})`}
      empty="No RA Bills found."
      headers={[
        "RA Number",
        "RA Date",
        "Amount",
        "Status",
        "Approval Status",
        "Created By",
        "Created At",
        "Approved By",
        "Approved At",
        "Action",
      ]}
      rows={raBills.map((item) => [
        item.ra_number,
        item.ra_date || "-",
        money(item.net_amount),
        item.status || "Draft",
        item.approval_status || "Pending",
        item.created_by_name || item.created_by_email || "-",
        formatIstTimestamp(item.created_at),
        item.approved_by_name || item.approved_by_email || "-",
        formatIstTimestamp(item.approved_at),
        <Link
          key={item.id}
          href={`/ra-bills/${item.id}`}
          className="rounded border px-3 py-1"
        >
          View
        </Link>,
      ])}
    />

    <DataTable
      title={`Linked Invoices (${invoices.length})`}
      empty="No invoices found."
      headers={[
        "Invoice Number",
        "Vendor Name",
        "Invoice Date",
        "Invoice Amount",
        "ITC Status",
        "Created By",
        "Created At",
        "Approved/ITC Updated By",
        "Approved/ITC Updated At",
        "Action",
      ]}
      rows={invoices.map((item) => [
        item.invoice_number,
        item.vendor_name || "-",
        item.invoice_date || "-",
        money(item.invoice_amount),
        item.itc_status || "-",
        item.created_by_name || item.created_by_email || "-",
        formatIstTimestamp(item.created_at),
        item.itc_claimed_by_name ||
          item.itc_claimed_by_email ||
          item.itc_rejected_by_name ||
          item.itc_rejected_by_email ||
          "-",
        formatIstTimestamp(item.itc_claimed_at || item.itc_rejected_at),
        <Link
          key={item.id}
          href={`/invoices/${item.id}`}
          className="rounded border px-3 py-1"
        >
          View
        </Link>,
      ])}
    />

    <DataTable
      title={`Linked Payments (${payments.length})`}
      empty="No payments found."
      headers={[
        "Payment Number",
        "Vendor Name",
        "Payment Date",
        "Amount",
        "UTR / Reference",
        "Created By",
        "Created At",
        "Updated By",
        "Updated At",
      ]}
      rows={payments.map((item) => [
        item.payment_number,
        item.vendor_name || "-",
        item.payment_date || "-",
        money(item.transferred_amount || item.payment_amount || item.total_payment),
        item.utr_number || item.reference_number || "-",
        item.created_by_name || item.created_by_email || "-",
        formatIstTimestamp(item.created_at_user || item.created_at),
        item.updated_by_name || item.updated_by_email || "-",
        formatIstTimestamp(item.updated_at_user || item.updated_at),
      ])}
    />

    <DataTable
  title="WO Ledger"
  empty="No ledger records found."
  headers={[
    "Date",
    "Type",
    "Reference",
    "Vendor Name",
    "Amount",
    "Status",
    "Created By",
    "Created At",
    "Approved By",
    "Approved At",
  ]}
  rows={woLedgerRows.map((item) => [
    item.date ? String(item.date).slice(0, 10) : "-",
    item.type,
    item.reference || "-",
    item.vendor_name || "-",
    money(item.amount),
    item.status || "-",
    item.created_by || "-",
    formatIstTimestamp(item.created_at),
    item.approved_by || "-",
    formatIstTimestamp(item.approved_at),
  ])}
/>

<DataTable
  title={`Linked Debit Notes (${debitNotes.length})`}
  empty="No debit notes found."
  headers={["Debit Note Number", "Date", "Amount", "Status", "Action"]}
  rows={debitNotes.map((item) => [
    item.debit_note_number || "-",
    item.debit_note_date || "-",
    money(item.total_amount),
    item.status || item.approval_status || "-",
    <Link
      key={item.id}
      href={`/debit-notes/${item.id}`}
      className="rounded border px-3 py-1"
    >
      View
    </Link>,
  ])}
/>
        
    </div>
  );
}

function Summary({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-sm text-gray-500">{title}</p>
      <p className="mt-2 text-xl font-bold">{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-gray-500">{label}</p>
      <p className="mt-1 font-medium text-gray-900">{value}</p>
    </div>
  );
}

function DataTable({
  title,
  headers,
  rows,
  empty,
}: {
  title: string;
  headers: string[];
  rows: any[][];
  empty: string;
}) {
  return (
    <section className="rounded-lg border bg-white p-6">
      <h2 className="mb-4 text-xl font-semibold">{title}</h2>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-gray-100">
            <tr>
              {headers.map((header) => (
                <th key={header} className="p-3 text-left">
                  {header}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={headers.length} className="p-6 text-center text-gray-500">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="p-3">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
