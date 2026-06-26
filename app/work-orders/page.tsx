"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Eye,
  ExternalLink,
  FileText,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import { formatIstTimestamp } from "@/lib/dateTime";

type WorkOrder = {
  id: string;
  wo_number: string | null;
  wo_date: string | null;
  wo_type: string | null;
  description: string | null;
  status: string | null;
  wo_value: number | string | null;
  gst_percent: number | string | null;
  approval_status: string | null;
  approved_by_name: string | null;
  approved_by_email: string | null;
  approved_at: string | null;
  created_by_name: string | null;
  created_by_email: string | null;
  company_id: string | null;
  site_id: string | null;
  organization_id: string | null;
  department: string | null;
  cost_code: string | null;
  created_at: string | null;
  company_name?: string | null;
  company_code?: string | null;
  site_name?: string | null;
  site_code?: string | null;
  vendor_name?: string | null;
  vendor_names?: string[] | null;
  documents?: WorkOrderDocument[] | null;
  document_count?: number | null;
  company?: { company_name?: string | null } | null;
  site?: { site_name?: string | null } | null;
  vendor?: { vendor_name?: string | null } | null;
  companies?: { company_name?: string | null } | null;
  sites?: { site_name?: string | null } | null;
  vendors?: { vendor_name?: string | null } | null;
};

type Company = {
  id: string;
  company_name: string | null;
  company_code: string | null;
  organization_id: string | null;
};

type Site = {
  id: string;
  site_name: string | null;
  site_code: string | null;
  organization_id: string | null;
};

type WorkOrderVendorSummary = {
  vendor_id: string;
  vendor_name: string | null;
  vendor_role: string | null;
  is_primary: boolean | null;
};

type WorkOrderDocument = {
  id: string;
  work_order_id: string;
  file_name: string | null;
  file_path: string | null;
  signed_url?: string | null;
  signed_url_error?: string | null;
};

type SelectionMap = Record<string, boolean>;
type SortField = "wo_number" | "vendor_name" | "wo_value" | "status" | "approval_status" | "wo_date";
type SortDirection = "asc" | "desc";

const LIFECYCLE_STATUS_OPTIONS = [
  { value: "yet_to_start", label: "Yet to Start" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "suspended", label: "Suspended" },
  { value: "terminated", label: "Terminated" },
];

const PAGE_SIZE = 50;

function cleanValue(...values: Array<string | null | undefined>) {
  const value = values.find((item) => item && item.trim().length > 0);
  return value?.trim() || "Unassigned";
}

function getCompanyName(wo: WorkOrder) {
  return cleanValue(
    wo.company_name,
    wo.company_code,
    wo.company?.company_name,
    wo.companies?.company_name,
  );
}

function getSiteName(wo: WorkOrder) {
  return cleanValue(wo.site_name, wo.site_code, wo.site?.site_name, wo.sites?.site_name);
}

function getVendorName(wo: WorkOrder) {
  const value = [wo.vendor_name, wo.vendor?.vendor_name, wo.vendors?.vendor_name].find(
    (item) => item && item.trim().length > 0,
  );

  return value?.trim() || "-";
}

function titleCase(value: string | null | undefined) {
  if (!value) return "Unassigned";
  if (value.trim().toLowerCase() === "yet_to_start") return "Yet to Start";
  return value
    .replace(/_/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function getStatusFilterValue(wo: WorkOrder) {
  return titleCase(lifecycleStatusValue(wo.status));
}

function lifecycleStatusValue(status: string | null | undefined) {
  const normalized = String(status || "").trim().toLowerCase();
  return LIFECYCLE_STATUS_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : "yet_to_start";
}

function selectAll(values: string[]) {
  return values.reduce<SelectionMap>((next, value) => {
    next[value] = true;
    return next;
  }, {});
}

function hasAnySelected(selection: SelectionMap) {
  return Object.values(selection).some(Boolean);
}

function toggleAll(values: string[], selection: SelectionMap) {
  const shouldSelectAll = !values.every((value) => selection[value]);
  return values.reduce<SelectionMap>((next, value) => {
    next[value] = shouldSelectAll;
    return next;
  }, {});
}

function formatCurrency(value: number | string | null) {
  const amount = typeof value === "string" ? Number(value) : value;

  if (!amount || Number.isNaN(amount)) {
    return "₹0";
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function workOrderCommercials(wo: Pick<WorkOrder, "wo_value" | "gst_percent">) {
  const basicValue = Number(wo.wo_value || 0);
  const gstPercent = Number(wo.gst_percent ?? 18);
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

function formatDate(date: string | null) {
  if (!date) return "-";

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "-";

  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(date: string | null) {
  return formatIstTimestamp(date);
}

function getApprovedBy(wo: WorkOrder) {
  const value = [wo.approved_by_name, wo.approved_by_email].find(
    (item) => item && item.trim().length > 0,
  );

  return value?.trim() || "-";
}

function getCreatedBy(wo: WorkOrder) {
  const value = [wo.created_by_name, wo.created_by_email].find(
    (item) => item && item.trim().length > 0,
  );

  return value?.trim() || "-";
}

function statusBadgeClass(status: string | null) {
  const normalized = status?.toLowerCase();

  if (normalized === "active" || normalized === "approved" || normalized === "completed") {
    return "bg-green-100 text-green-800 border-green-200";
  }

  if (normalized === "pending" || normalized === "approval pending" || normalized === "draft") {
    return "bg-blue-100 text-blue-800 border-blue-200";
  }

  if (normalized === "suspended") {
    return "bg-amber-100 text-amber-800 border-amber-200";
  }

  if (normalized === "terminated" || normalized === "rejected" || normalized === "cancelled") {
    return "bg-red-100 text-red-800 border-red-200";
  }

  return "bg-gray-100 text-gray-700 border-gray-200";
}

function selectedFilterValues(values: string[], selection: SelectionMap) {
  if (values.length === 0) return [];
  const selected = values.filter((value) => selection[value] !== false);

  if (selected.length === values.length) return [];
  if (selected.length === 0) return ["__none__"];
  return selected;
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function FilterGroup({
  title,
  values,
  selection,
  onChange,
}: {
  title: string;
  values: string[];
  selection: SelectionMap;
  onChange: (selection: SelectionMap) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
        {title}
      </label>
      <div className="max-h-40 overflow-y-auto border border-slate-300 bg-[#f6f3f5] p-2">
        <label className="flex items-center gap-2 border-b border-slate-300 pb-2 text-sm text-slate-900">
          <input
            type="checkbox"
            checked={values.length > 0 && values.every((value) => selection[value])}
            onChange={() => onChange(toggleAll(values, selection))}
            className="h-4 w-4 rounded border-slate-400 text-[#00658b] focus:ring-[#00658b]"
          />
          Select all
        </label>

        <div className="mt-2 space-y-1">
          {values.map((value) => (
            <label key={value} className="flex items-start gap-2 text-sm text-slate-900">
              <input
                type="checkbox"
                checked={selection[value] ?? true}
                onChange={() =>
                  onChange({
                    ...selection,
                    [value]: !(selection[value] ?? true),
                  })
                }
                className="mt-0.5 h-4 w-4 rounded border-slate-400 text-[#00658b] focus:ring-[#00658b]"
              />
              <span className="leading-5">{value}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function WorkOrdersPage() {
  const { access } = useAccessContext();
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [woSearch, setWoSearch] = useState("");
  const [debouncedWoSearch, setDebouncedWoSearch] = useState("");
  const [contractorSearch, setContractorSearch] = useState("");
  const [debouncedContractorSearch, setDebouncedContractorSearch] = useState("");
  const [selectedCompanies, setSelectedCompanies] = useState<SelectionMap>({});
  const [selectedSites, setSelectedSites] = useState<SelectionMap>({});
  const [selectedStatuses, setSelectedStatuses] = useState<SelectionMap>({});
  const [selectedTypes, setSelectedTypes] = useState<SelectionMap>({});
  const [companyOptions, setCompanyOptions] = useState<string[]>([]);
  const [siteOptions, setSiteOptions] = useState<string[]>([]);
  const [typeOptions, setTypeOptions] = useState<string[]>([]);
  const [totalWorkOrders, setTotalWorkOrders] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedDocumentsByWorkOrder, setLoadedDocumentsByWorkOrder] = useState<
    Record<string, WorkOrderDocument[]>
  >({});
  const [loadingDocumentsByWorkOrder, setLoadingDocumentsByWorkOrder] = useState<
    Record<string, boolean>
  >({});
  const [sortField, setSortField] = useState<SortField>("wo_number");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [message, setMessage] = useState("");
  const [canDelete, setCanDelete] = useState(false);
  const [deleteWorkOrder, setDeleteWorkOrder] = useState<WorkOrder | null>(null);
  const [deletionReason, setDeletionReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const hasLoadedRef = useRef(false);
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inFlightRequestKeyRef = useRef<string | null>(null);

  function openDocument(document: WorkOrderDocument) {
    if (!document.signed_url) {
      setError(
        document.signed_url_error ||
          "Unable to open Work Order file. Signed URL was not available.",
      );
      return;
    }

    window.open(document.signed_url, "_blank", "noopener,noreferrer");
  }

  async function loadDocumentsForWorkOrder(workOrderId: string) {
    if (loadedDocumentsByWorkOrder[workOrderId] || loadingDocumentsByWorkOrder[workOrderId]) {
      return;
    }

    setLoadingDocumentsByWorkOrder((previous) => ({
      ...previous,
      [workOrderId]: true,
    }));
    setError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Unable to load Work Order documents: missing auth session.");
      }

      const response = await fetch(
        `/api/work-orders/documents?work_order_id=${encodeURIComponent(workOrderId)}`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        },
      );
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Could not load Work Order documents.");
      }

      setLoadedDocumentsByWorkOrder((previous) => ({
        ...previous,
        [workOrderId]: (result.documents || []) as WorkOrderDocument[],
      }));
    } catch (documentError: any) {
      setError(documentError.message || "Could not load Work Order documents.");
    } finally {
      setLoadingDocumentsByWorkOrder((previous) => ({
        ...previous,
        [workOrderId]: false,
      }));
    }
  }

  const statusOptions = useMemo(
    () => LIFECYCLE_STATUS_OPTIONS.map((option) => option.label),
    [],
  );
  const companyFilterKey = selectedFilterValues(companyOptions, selectedCompanies).join("\u001f");
  const siteFilterKey = selectedFilterValues(siteOptions, selectedSites).join("\u001f");
  const statusFilterKey = selectedFilterValues(statusOptions, selectedStatuses).join("\u001f");
  const typeFilterKey = selectedFilterValues(typeOptions, selectedTypes).join("\u001f");
  const requestQuery = useMemo(() => {
    const params = new URLSearchParams({
      page: String(pageIndex + 1),
      page_size: String(PAGE_SIZE),
      sort_field: sortField,
      sort_direction: sortDirection,
      include_documents: "count",
    });

    if (debouncedWoSearch) params.set("wo_search", debouncedWoSearch);
    if (debouncedContractorSearch) {
      params.set("contractor_search", debouncedContractorSearch);
    }

    companyFilterKey
      .split("\u001f")
      .filter(Boolean)
      .forEach((value) => params.append("company", value));
    siteFilterKey
      .split("\u001f")
      .filter(Boolean)
      .forEach((value) => params.append("site", value));
    statusFilterKey
      .split("\u001f")
      .filter(Boolean)
      .forEach((value) => params.append("statuses", value));
    typeFilterKey
      .split("\u001f")
      .filter(Boolean)
      .forEach((value) => params.append("wo_types", value));

    return params.toString();
  }, [
    companyFilterKey,
    debouncedContractorSearch,
    debouncedWoSearch,
    pageIndex,
    siteFilterKey,
    sortDirection,
    sortField,
    statusFilterKey,
    typeFilterKey,
  ]);
  const requestKey = `${requestQuery}|refresh=${refreshNonce}`;

  useEffect(() => {
    if (!access) return;

    if (inFlightRequestKeyRef.current === requestKey) {
      return;
    }

    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    inFlightRequestKeyRef.current = requestKey;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const hasLoaded = hasLoadedRef.current;

    if (hasLoaded) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    async function fetchWorkOrders() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.access_token) {
          setError("Unable to load Work Orders: missing auth session.");
          setWorkOrders([]);
          return;
        }

        const response = await fetch(`/api/work-orders/register?${requestQuery}`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          signal: abortController.signal,
        });
        const result = await response.json();

        if (requestId !== requestIdRef.current) return;

        if (!response.ok) {
          setError(result.error || "Could not load Work Orders.");
          if (!hasLoaded) setWorkOrders([]);
        } else {
          setWorkOrders((result.rows || []) as WorkOrder[]);
          setTotalWorkOrders(Number(result.total || 0));
          const nextCompanies = result.filters?.companies || [];
          const nextSites = result.filters?.sites || [];
          const nextTypes = result.filters?.wo_types || [];

          setCompanyOptions((previous) =>
            sameStringArray(previous, nextCompanies) ? previous : nextCompanies,
          );
          setSiteOptions((previous) =>
            sameStringArray(previous, nextSites) ? previous : nextSites,
          );
          setTypeOptions((previous) =>
            sameStringArray(previous, nextTypes) ? previous : nextTypes,
          );
          setLastUpdated(result.last_updated ? new Date(result.last_updated) : new Date());
          hasLoadedRef.current = true;
      }
    } catch (fetchError: any) {
      if (fetchError?.name === "AbortError") {
          return;
        }

        setError(fetchError.message || "Could not load Work Orders.");
        if (!hasLoaded) setWorkOrders([]);
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }

        if (inFlightRequestKeyRef.current === requestKey) {
          inFlightRequestKeyRef.current = null;
        }
      }
    }

    fetchWorkOrders();
  }, [access, requestKey, requestQuery]);

  async function confirmDelete() {
    if (!deleteWorkOrder) return;

    const reason = deletionReason.trim();

    if (reason.length < 10) {
      setMessage("Deletion reason must be at least 10 characters.");
      return;
    }

    try {
      setDeleting(true);
      setMessage("");
      setError(null);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Please sign in again to delete this Work Order.");
      }

      const response = await fetch(
        `/api/work-orders?work_order_id=${encodeURIComponent(deleteWorkOrder.id)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ deletion_reason: reason }),
        },
      );
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to delete Work Order.");
      }

      setWorkOrders((prev) => prev.filter((wo) => wo.id !== deleteWorkOrder.id));
      setTotalWorkOrders((prev) => Math.max(0, prev - 1));
      setDeleteWorkOrder(null);
      setDeletionReason("");
      setMessage("Work Order deleted successfully.");
    } catch (deleteError: any) {
      setMessage(deleteError.message || "Failed to delete Work Order.");
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (!access) return;
    setCanDelete(can(access.permissions, "work_orders", "delete"));
  }, [access]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedWoSearch(woSearch.trim());
    }, 450);

    return () => window.clearTimeout(timer);
  }, [woSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedContractorSearch(contractorSearch.trim());
    }, 450);

    return () => window.clearTimeout(timer);
  }, [contractorSearch]);

  useEffect(() => {
    setSelectedCompanies(selectAll(companyOptions));
  }, [companyOptions]);

  useEffect(() => {
    setSelectedSites(selectAll(siteOptions));
  }, [siteOptions]);

  useEffect(() => {
    setSelectedStatuses(selectAll(statusOptions));
  }, [statusOptions]);

  useEffect(() => {
    setSelectedTypes(selectAll(typeOptions));
  }, [typeOptions]);

  const sortedWorkOrders = workOrders;

  useEffect(() => {
    setPageIndex(0);
  }, [
    woSearch,
    contractorSearch,
    sortField,
    sortDirection,
    selectedCompanies,
    selectedSites,
    selectedStatuses,
    selectedTypes,
  ]);

  const totalPages = Math.max(1, Math.ceil(totalWorkOrders / PAGE_SIZE));
  const currentPageIndex = Math.min(pageIndex, totalPages - 1);
  const startIndex = currentPageIndex * PAGE_SIZE;
  const endIndex = Math.min(startIndex + sortedWorkOrders.length, totalWorkOrders);
  const paginatedWorkOrders = sortedWorkOrders;
  const rangeStart = totalWorkOrders === 0 ? 0 : startIndex + 1;

  useEffect(() => {
    if (pageIndex > totalPages - 1) {
      setPageIndex(totalPages - 1);
    }
  }, [pageIndex, totalPages]);

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <nav className="mb-3 flex items-center gap-2 text-[11px] font-medium text-slate-500">
            <span>Procurement</span>
            <span>/</span>
            <span className="font-semibold text-[#00658b]">Work Orders</span>
          </nav>
          <h1 className="text-4xl font-bold tracking-tight text-slate-950">Work Orders Management</h1>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/work-orders/new"
            className="inline-flex items-center gap-2 bg-[#00658b] px-6 py-3 text-sm font-bold text-white transition hover:bg-[#005174]"
          >
            <Plus className="h-4 w-4" />
            New Work Order
          </Link>
        </div>
      </section>

      <section className="border border-slate-300 bg-white p-6 shadow-sm">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-950">Search &amp; Filters</h2>
            <p className="mt-1 text-xs text-slate-500">
              Updated{" "}
              {lastUpdated
                ? formatIstTimestamp(lastUpdated)
                : "-"}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setRefreshNonce((value) => value + 1)}
            className="inline-flex items-center justify-center gap-2 bg-[#00658b] px-6 py-3 text-sm font-bold text-white transition hover:bg-[#005174]"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        <div className="mb-7 grid grid-cols-1 gap-6 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              Search by Work Order Number
            </span>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={woSearch}
                onChange={(event) => setWoSearch(event.target.value)}
                placeholder="Example: CRPF/126"
                className="w-full border border-slate-300 bg-[#f6f3f5] py-3 pl-10 pr-3 text-sm outline-none focus:border-[#00658b] focus:ring-1 focus:ring-[#00658b]"
              />
            </div>
          </label>

          <label className="space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              Search by Contractor
            </span>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={contractorSearch}
                onChange={(event) => setContractorSearch(event.target.value)}
                placeholder="Type contractor name"
                className="w-full border border-slate-300 bg-[#f6f3f5] py-3 pl-10 pr-3 text-sm outline-none focus:border-[#00658b] focus:ring-1 focus:ring-[#00658b]"
              />
            </div>
          </label>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          <FilterGroup
            title="Company"
            values={companyOptions}
            selection={selectedCompanies}
            onChange={setSelectedCompanies}
          />
          <FilterGroup
            title="Site"
            values={siteOptions}
            selection={selectedSites}
            onChange={setSelectedSites}
          />
          <FilterGroup
            title="WO Status"
            values={statusOptions}
            selection={selectedStatuses}
            onChange={setSelectedStatuses}
          />
          <FilterGroup
            title="Work Order Type"
            values={typeOptions}
            selection={selectedTypes}
            onChange={setSelectedTypes}
          />
        </div>
      </section>

      {message && (
        <div className="border border-sky-200 bg-sky-50 p-4 text-sm font-medium text-sky-800">
          {message}
        </div>
      )}

      <section className="overflow-hidden border border-slate-300 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-300 p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
              Sort by
              <select
                value={sortField}
                onChange={(event) => setSortField(event.target.value as SortField)}
                className="border border-slate-300 bg-[#f6f3f5] px-3 py-2 text-xs text-slate-900 outline-none focus:border-[#00658b] focus:ring-1 focus:ring-[#00658b]"
              >
                <option value="wo_number">WO Number</option>
                <option value="vendor_name">Vendor Name</option>
                <option value="wo_value">WO Value</option>
                <option value="status">Status</option>
                <option value="approval_status">Approval Status</option>
                <option value="wo_date">WO Date / Created Date</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
              Direction
              <select
                value={sortDirection}
                onChange={(event) => setSortDirection(event.target.value as SortDirection)}
                className="border border-slate-300 bg-[#f6f3f5] px-3 py-2 text-xs text-slate-900 outline-none focus:border-[#00658b] focus:ring-1 focus:ring-[#00658b]"
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </label>
            <span className="text-xs text-slate-500">
              {totalWorkOrders === 0
                ? "Showing 0 of 0"
                : `Showing ${rangeStart}–${endIndex} of ${totalWorkOrders}`}
              {refreshing ? " · Updating..." : ""}
            </span>
          </div>
        </div>

        {loading && sortedWorkOrders.length === 0 ? (
          <div className="p-10 text-center text-slate-500">Loading work orders...</div>
        ) : error ? (
          <div className="m-4 border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        ) : totalWorkOrders === 0 ? (
          <div className="p-10 text-center text-slate-500">No work orders match the selected filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1660px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-300 bg-[#f6f3f5]">
                  <th className="w-[12%] px-6 py-4 text-xs font-bold uppercase tracking-wide text-slate-600">
                    WO ID
                  </th>
                  <th className="w-[16%] px-6 py-4 text-xs font-bold uppercase tracking-wide text-slate-600">
                    Vendor Name
                  </th>
                  <th className="w-[16%] px-6 py-4 text-xs font-bold uppercase tracking-wide text-slate-600">
                    Description
                  </th>
                  <th className="w-[11%] px-6 py-4 text-xs font-bold uppercase tracking-wide text-slate-600">
                    WO Value
                  </th>
                  <th className="w-[14%] px-6 py-4 text-xs font-bold uppercase tracking-wide text-slate-600">
                    Documentation
                  </th>
                  <th className="w-[8%] px-6 py-4 text-xs font-bold uppercase tracking-wide text-slate-600">
                    Status
                  </th>
                  <th className="w-[8%] px-6 py-4 text-xs font-bold uppercase tracking-wide text-slate-600">
                    Approval
                  </th>
                  <th className="w-[12%] px-6 py-4 text-xs font-bold uppercase tracking-wide text-slate-600">
                    Created By
                  </th>
                  <th className="w-[11%] px-6 py-4 text-xs font-bold uppercase tracking-wide text-slate-600">
                    Created At
                  </th>
                  <th className="w-[12%] px-6 py-4 text-xs font-bold uppercase tracking-wide text-slate-600">
                    Approved By
                  </th>
                  <th className="w-[11%] px-6 py-4 text-xs font-bold uppercase tracking-wide text-slate-600">
                    Approved At
                  </th>
                  <th className="w-[8%] px-6 py-4 text-xs font-bold uppercase tracking-wide text-slate-600">
                    WO Date
                  </th>
                  <th className="w-[5%] px-6 py-4 text-right text-xs font-bold uppercase tracking-wide text-slate-600">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {paginatedWorkOrders.map((wo) => {
                  const lifecycleStatus = lifecycleStatusValue(wo.status);
                  const commercials = workOrderCommercials(wo);
                  const vendorName = getVendorName(wo);

                  return (
                  <tr key={wo.id} className="transition hover:bg-[#f6f3f5]">
                    <td className="px-6 py-5 align-top">
                      <div className="max-w-[320px] text-base font-bold leading-6">
                        <Link
                          href={`/work-orders/${wo.id}`}
                          className="text-[#00658b] hover:underline"
                        >
                          {wo.wo_number || "-"}
                        </Link>
                      </div>
                    </td>
                    <td className="px-6 py-5 align-top">
                      <div className="text-base font-semibold text-slate-950">{vendorName}</div>
                      <div className="mt-1 text-sm text-slate-500">{getSiteName(wo)}</div>
                    </td>
                    <td className="px-6 py-5 align-top text-base text-slate-700">
                      <p className="line-clamp-2 max-w-[280px] leading-6">{wo.description || "-"}</p>
                    </td>
                    <td className="px-6 py-5 align-top">
                      <div className="text-base font-bold text-slate-950">
                        {formatCurrency(commercials.totalValue)}
                      </div>
                      <div className="mt-1 space-y-0.5 text-xs font-medium text-slate-500">
                        <p>Basic: {formatCurrency(commercials.basicValue)}</p>
                        <p>
                          GST: {formatCurrency(commercials.gstAmount)} ({commercials.gstPercent}%)
                        </p>
                      </div>
                    </td>
                    <td className="px-6 py-5 align-top">
                      {(() => {
                        const loadedDocuments = loadedDocumentsByWorkOrder[wo.id];
                        const isLoadingDocuments = loadingDocumentsByWorkOrder[wo.id] === true;
                        const documentCount =
                          Number(wo.document_count ?? loadedDocuments?.length ?? 0) || 0;

                        if (loadedDocuments && loadedDocuments.length > 0) {
                          return (
                        <div className="space-y-1.5">
                          <div className="inline-flex items-center gap-1 text-sm font-semibold text-slate-700">
                            <FileText className="h-4 w-4 text-slate-400" />
                                  {loadedDocuments.length} file
                                  {loadedDocuments.length === 1 ? "" : "s"}
                          </div>
                              {loadedDocuments.map((document) => (
                            <div
                              key={document.id}
                              className="flex max-w-[260px] items-center gap-2"
                            >
                              <span className="truncate text-sm text-slate-600">
                                {document.file_name || "Work Order file"}
                              </span>
                              <button
                                type="button"
                                onClick={() => openDocument(document)}
                                className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-[#00658b] hover:underline"
                              >
                                Open
                                <ExternalLink className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                          );
                        }

                        if (documentCount > 0) {
                          return (
                            <div className="space-y-1.5">
                              <div className="inline-flex items-center gap-1 text-sm font-semibold text-slate-700">
                                <FileText className="h-4 w-4 text-slate-400" />
                                {documentCount} document{documentCount === 1 ? "" : "s"}
                              </div>
                              <button
                                type="button"
                                onClick={() => loadDocumentsForWorkOrder(wo.id)}
                                disabled={isLoadingDocuments}
                                className="text-sm font-semibold text-[#00658b] hover:underline disabled:cursor-wait disabled:text-slate-400"
                              >
                                {isLoadingDocuments ? "Loading documents..." : "Load documents"}
                              </button>
                            </div>
                          );
                        }

                        return (
                          <span className="inline-flex items-center gap-1 text-sm text-slate-400">
                            <FileText className="h-4 w-4" />
                            No documents
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-5 align-top">
                      <span
                        className={`inline-flex border px-2.5 py-1.5 text-sm font-semibold ${statusBadgeClass(
                          lifecycleStatus,
                        )}`}
                      >
                        {titleCase(lifecycleStatus)}
                      </span>
                    </td>
                    <td className="px-6 py-5 align-top">
                      <span
                        className={`inline-flex border px-2.5 py-1.5 text-sm font-semibold ${statusBadgeClass(
                          wo.approval_status,
                        )}`}
                      >
                        {titleCase(wo.approval_status)}
                      </span>
                    </td>
                    <td className="px-6 py-5 align-top">
                      <div className="max-w-[180px] truncate text-sm font-medium text-slate-800">
                        {getCreatedBy(wo)}
                      </div>
                      {wo.created_by_name && wo.created_by_email && wo.created_by_name !== wo.created_by_email && (
                        <div className="mt-1 max-w-[180px] truncate text-xs text-slate-500">
                          {wo.created_by_email}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-5 align-top text-sm font-medium text-slate-700">
                      {formatDateTime(wo.created_at)}
                    </td>
                    <td className="px-6 py-5 align-top">
                      <div className="max-w-[180px] truncate text-sm font-medium text-slate-800">
                        {getApprovedBy(wo)}
                      </div>
                      {wo.approved_by_name && wo.approved_by_email && wo.approved_by_name !== wo.approved_by_email && (
                        <div className="mt-1 max-w-[180px] truncate text-xs text-slate-500">
                          {wo.approved_by_email}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-5 align-top text-sm font-medium text-slate-700">
                      {formatDateTime(wo.approved_at)}
                    </td>
                    <td className="px-6 py-5 align-top text-base text-slate-600">
                      {formatDate(wo.wo_date || wo.created_at)}
                    </td>
                    <td className="px-6 py-5 align-top">
                      <div className="flex justify-end gap-2">
                        <Link
                          href={`/work-orders/${wo.id}`}
                          className="inline-flex h-9 w-9 items-center justify-center border border-slate-200 text-slate-500 transition hover:bg-[#f6f3f5] hover:text-slate-950"
                          title="View"
                        >
                          <Eye className="h-4 w-4" />
                        </Link>

                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteWorkOrder(wo);
                              setDeletionReason("");
                              setMessage("");
                            }}
                            className="inline-flex h-9 w-9 items-center justify-center border border-red-200 text-red-600 transition hover:bg-red-50"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <div>
                Showing {rangeStart}–{endIndex} of {totalWorkOrders}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPageIndex((value) => Math.max(0, value - 1))}
                  disabled={currentPageIndex <= 0}
                  className="border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setPageIndex((value) => Math.min(totalPages - 1, value + 1))
                  }
                  disabled={currentPageIndex >= totalPages - 1}
                  className="border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {deleteWorkOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-950">
                  Delete Work Order
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  This will hard delete Work Order{" "}
                  <span className="font-semibold text-slate-950">
                    {deleteWorkOrder.wo_number || "-"}
                  </span>{" "}
                  after saving an audit snapshot.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setDeleteWorkOrder(null);
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
                placeholder="Enter why this Work Order is being deleted..."
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
                  setDeleteWorkOrder(null);
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
                {deleting ? "Deleting..." : "Delete Work Order"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
