"use client";

import { useEffect, useMemo, useState } from "react";
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
import { can, getCurrentUserAccess } from "@/lib/accessControl";

type WorkOrder = {
  id: string;
  wo_number: string | null;
  wo_date: string | null;
  wo_type: string | null;
  description: string | null;
  status: string | null;
  wo_value: number | string | null;
  approval_status: string | null;
  approved_by_name: string | null;
  approved_by_email: string | null;
  approved_at: string | null;
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
  return value
    .replace(/_/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function getStatusFilterValue(wo: WorkOrder) {
  const approvalStatus = wo.approval_status?.trim();
  if (approvalStatus && approvalStatus.toLowerCase() !== "approved") {
    return titleCase(approvalStatus);
  }

  return titleCase(wo.status);
}

function getUniqueValues(values: string[]) {
  const unique = Array.from(new Set(values.map((value) => value || "Unassigned")));
  return unique.sort((a, b) => {
    if (a === "Unassigned") return 1;
    if (b === "Unassigned") return -1;
    return a.localeCompare(b);
  });
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

function getApprovedBy(wo: WorkOrder) {
  const value = [wo.approved_by_name, wo.approved_by_email].find(
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

  if (normalized === "terminated" || normalized === "rejected") {
    return "bg-red-100 text-red-800 border-red-200";
  }

  return "bg-gray-100 text-gray-700 border-gray-200";
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function compareValues(a: string | number, b: string | number) {
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }

  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
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
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [woSearch, setWoSearch] = useState("");
  const [contractorSearch, setContractorSearch] = useState("");
  const [selectedCompanies, setSelectedCompanies] = useState<SelectionMap>({});
  const [selectedSites, setSelectedSites] = useState<SelectionMap>({});
  const [selectedStatuses, setSelectedStatuses] = useState<SelectionMap>({});
  const [selectedTypes, setSelectedTypes] = useState<SelectionMap>({});
  const [sortField, setSortField] = useState<SortField>("wo_date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [message, setMessage] = useState("");
  const [canDelete, setCanDelete] = useState(false);
  const [deleteWorkOrder, setDeleteWorkOrder] = useState<WorkOrder | null>(null);
  const [deletionReason, setDeletionReason] = useState("");
  const [deleting, setDeleting] = useState(false);

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

  async function loadWorkOrders() {
    setLoading(true);
    setError(null);

    const { data, error: loadError } = await supabase
      .from("work_orders")
      .select(
        `
          id,
          wo_number,
          wo_date,
          wo_type,
          description,
          status,
          wo_value,
          approval_status,
          approved_by_name,
          approved_by_email,
          approved_at,
          company_id,
          site_id,
          organization_id,
          department,
          cost_code,
          created_at
        `,
      )
      .ilike("approval_status", "approved")
      .order("created_at", { ascending: false });

    if (loadError) {
      setError(loadError.message);
      setWorkOrders([]);
    } else {
      const rows = ((data as WorkOrder[]) || []).map((row) => ({ ...row }));
      const companyIds = Array.from(new Set(rows.map((row) => row.company_id).filter(Boolean)));
      const siteIds = Array.from(new Set(rows.map((row) => row.site_id).filter(Boolean)));
      const workOrderIds = rows.map((row) => row.id);

      const [companiesResult, sitesResult] = await Promise.all([
        companyIds.length
          ? supabase
              .from("companies")
              .select("id, company_name, company_code, organization_id")
              .in("id", companyIds)
          : Promise.resolve({ data: [] as Company[], error: null }),
        siteIds.length
          ? supabase
              .from("sites")
              .select("id, site_name, site_code, organization_id")
              .in("id", siteIds)
          : Promise.resolve({ data: [] as Site[], error: null }),
      ]);

      if (companiesResult.error || sitesResult.error) {
        setError(
          companiesResult.error?.message ||
            sitesResult.error?.message ||
            "Could not load related work order names.",
        );
        setWorkOrders([]);
        setLoading(false);
        return;
      }

      const companyMap = new Map(
        ((companiesResult.data as Company[]) || []).map((company) => [company.id, company]),
      );
      const siteMap = new Map(((sitesResult.data as Site[]) || []).map((site) => [site.id, site]));

      let documentsByWorkOrder = new Map<string, WorkOrderDocument[]>();
      let vendorsByWorkOrder = new Map<string, WorkOrderVendorSummary>();

      if (workOrderIds.length) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token;

        if (!token) {
          setError("Unable to load Work Order documents: missing auth session.");
          setWorkOrders([]);
          setLoading(false);
          return;
        }

        const documentRows: WorkOrderDocument[] = [];

        for (const idChunk of chunkArray(workOrderIds, 50)) {
          const response = await fetch(
            `/api/work-orders/documents?work_order_ids=${encodeURIComponent(
              idChunk.join(","),
            )}`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          );
          const result = await response.json();

          if (!response.ok) {
            setError(result.error || "Could not load Work Order documents.");
            setWorkOrders([]);
            setLoading(false);
            return;
          }

          documentRows.push(...((result.documents as WorkOrderDocument[]) || []));
        }

        documentsByWorkOrder = documentRows.reduce<Map<string, WorkOrderDocument[]>>(
          (map, document) => {
            const existing = map.get(document.work_order_id) || [];
            map.set(document.work_order_id, [...existing, document]);
            return map;
          },
          new Map(),
        );

        const vendorRows: Array<[string, WorkOrderVendorSummary | null]> = [];

        for (const idChunk of chunkArray(workOrderIds, 50)) {
          const response = await fetch(
            `/api/work-orders/vendors?work_order_ids=${encodeURIComponent(
              idChunk.join(","),
            )}`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          );
          const result = await response.json();

          if (!response.ok) {
            setError(result.error || "Could not load Work Order vendors.");
            setWorkOrders([]);
            setLoading(false);
            return;
          }

          vendorRows.push(
            ...Object.entries(result.vendors || {}) as Array<
              [string, WorkOrderVendorSummary | null]
            >,
          );
        }

        vendorsByWorkOrder = new Map(
          vendorRows.filter(([, vendor]) => vendor?.vendor_name) as Array<
            [string, WorkOrderVendorSummary]
          >,
        );
      }

      const enrichedRows = rows.map((row) => {
        const company = row.company_id ? companyMap.get(row.company_id) : null;
        const site = row.site_id ? siteMap.get(row.site_id) : null;
        const vendor = vendorsByWorkOrder.get(row.id);
        const vendorName = vendor?.vendor_name?.trim() || null;

        return {
          ...row,
          company_name: company?.company_name || company?.company_code || null,
          company_code: company?.company_code || null,
          site_name: site?.site_name || site?.site_code || null,
          site_code: site?.site_code || null,
          vendor_names: vendorName ? [vendorName] : [],
          vendor_name: vendorName,
          documents: documentsByWorkOrder.get(row.id) || [],
        };
      });

      setWorkOrders(enrichedRows);
      setLastUpdated(new Date());
    }

    setLoading(false);
  }

  async function loadAccess() {
    const access = await getCurrentUserAccess();
    setCanDelete(can(access.permissions, "work_orders", "delete"));
  }

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
    loadAccess();
    loadWorkOrders();
  }, []);

  const companyOptions = useMemo(
    () => getUniqueValues(workOrders.map((wo) => getCompanyName(wo))),
    [workOrders],
  );

  const siteOptions = useMemo(
    () => getUniqueValues(workOrders.map((wo) => getSiteName(wo))),
    [workOrders],
  );

  const statusOptions = useMemo(
    () => getUniqueValues(workOrders.map((wo) => getStatusFilterValue(wo))),
    [workOrders],
  );

  const typeOptions = useMemo(
    () => getUniqueValues(workOrders.map((wo) => titleCase(wo.wo_type))),
    [workOrders],
  );

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

  const filteredWorkOrders = useMemo(() => {
    const normalizedWoSearch = woSearch.trim().toLowerCase();
    const normalizedContractorSearch = contractorSearch.trim().toLowerCase();

    return workOrders.filter((wo) => {
      const company = getCompanyName(wo);
      const site = getSiteName(wo);
      const status = getStatusFilterValue(wo);
      const type = titleCase(wo.wo_type);

      const matchesWo =
        !normalizedWoSearch || (wo.wo_number || "").toLowerCase().includes(normalizedWoSearch);
      const vendorSearchText = [getVendorName(wo), ...(wo.vendor_names || [])]
        .join(" ")
        .toLowerCase();
      const matchesContractor =
        !normalizedContractorSearch || vendorSearchText.includes(normalizedContractorSearch);

      return (
        matchesWo &&
        matchesContractor &&
        selectedCompanies[company] !== false &&
        selectedSites[site] !== false &&
        selectedStatuses[status] !== false &&
        selectedTypes[type] !== false &&
        hasAnySelected(selectedCompanies) &&
        hasAnySelected(selectedSites) &&
        hasAnySelected(selectedStatuses) &&
        hasAnySelected(selectedTypes)
      );
    });
  }, [
    workOrders,
    woSearch,
    contractorSearch,
    selectedCompanies,
    selectedSites,
    selectedStatuses,
    selectedTypes,
  ]);

  const sortedWorkOrders = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;

    return [...filteredWorkOrders].sort((a, b) => {
      let aValue: string | number;
      let bValue: string | number;

      switch (sortField) {
        case "vendor_name":
          aValue = getVendorName(a);
          bValue = getVendorName(b);
          break;
        case "wo_value":
          aValue = typeof a.wo_value === "string" ? Number(a.wo_value) || 0 : a.wo_value || 0;
          bValue = typeof b.wo_value === "string" ? Number(b.wo_value) || 0 : b.wo_value || 0;
          break;
        case "status":
          aValue = titleCase(a.status);
          bValue = titleCase(b.status);
          break;
        case "approval_status":
          aValue = titleCase(a.approval_status);
          bValue = titleCase(b.approval_status);
          break;
        case "wo_date":
          aValue = new Date(a.wo_date || a.created_at || 0).getTime() || 0;
          bValue = new Date(b.wo_date || b.created_at || 0).getTime() || 0;
          break;
        case "wo_number":
        default:
          aValue = a.wo_number || "";
          bValue = b.wo_number || "";
      }

      return compareValues(aValue, bValue) * direction;
    });
  }, [filteredWorkOrders, sortDirection, sortField]);

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
                ? lastUpdated.toLocaleString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "-"}
            </p>
          </div>

          <button
            type="button"
            onClick={loadWorkOrders}
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
              {sortedWorkOrders.length === 0
                ? "Showing 0 of 0"
                : `Showing 1-${sortedWorkOrders.length} of ${sortedWorkOrders.length}`}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="p-10 text-center text-slate-500">Loading work orders...</div>
        ) : error ? (
          <div className="m-4 border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        ) : sortedWorkOrders.length === 0 ? (
          <div className="p-10 text-center text-slate-500">No work orders match the selected filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1420px] border-collapse text-left text-sm">
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
                  <th className="w-[9%] px-6 py-4 text-xs font-bold uppercase tracking-wide text-slate-600">
                    Value
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
                {sortedWorkOrders.map((wo) => (
                  <tr key={wo.id} className="transition hover:bg-[#f6f3f5]">
                    <td className="px-6 py-5 align-top text-base font-bold text-[#00658b]">
                      {wo.wo_number || "-"}
                    </td>
                    <td className="px-6 py-5 align-top">
                      <div className="text-base font-semibold text-slate-950">{getVendorName(wo)}</div>
                      <div className="mt-1 text-sm text-slate-500">{getSiteName(wo)}</div>
                    </td>
                    <td className="px-6 py-5 align-top text-base text-slate-700">
                      <p className="line-clamp-2 max-w-[280px] leading-6">{wo.description || "-"}</p>
                    </td>
                    <td className="px-6 py-5 align-top text-base font-bold text-slate-950">
                      {formatCurrency(wo.wo_value)}
                    </td>
                    <td className="px-6 py-5 align-top">
                      {wo.documents && wo.documents.length > 0 ? (
                        <div className="space-y-1.5">
                          <div className="inline-flex items-center gap-1 text-sm font-semibold text-slate-700">
                            <FileText className="h-4 w-4 text-slate-400" />
                            {wo.documents.length} file{wo.documents.length === 1 ? "" : "s"}
                          </div>
                          {wo.documents.map((document) => (
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
                      ) : (
                        <span className="inline-flex items-center gap-1 text-sm text-slate-400">
                          <FileText className="h-4 w-4" />
                          No file
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-5 align-top">
                      <span
                        className={`inline-flex border px-2.5 py-1.5 text-sm font-semibold ${statusBadgeClass(
                          wo.status,
                        )}`}
                      >
                        {titleCase(wo.status)}
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
                ))}
              </tbody>
            </table>
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
