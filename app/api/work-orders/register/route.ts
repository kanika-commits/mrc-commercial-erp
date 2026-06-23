import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";

const DOCUMENT_BUCKET = "work-order-documents";
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 100;
const FILTER_METADATA_TTL_MS = 45 * 1000;

type FilterMetadataCacheEntry = {
  expiresAt: number;
  value: Awaited<ReturnType<typeof loadFilterMetadataUncached>>;
};

const filterMetadataCache = new Map<string, FilterMetadataCacheEntry>();

type Permission = {
  module_code: string;
  action_code: string;
  allowed: boolean;
};

type WorkOrderRow = {
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
};

type WorkOrderFilterRow = {
  company_id: string | null;
  site_id: string | null;
  status: string | null;
  wo_type: string | null;
};

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

async function requireUser(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const token = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    return { error: "Missing auth token.", status: 401 };
  }

  const authClient = createClient(supabaseUrl, anonKey);
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(token);

  if (error) throw error;

  if (!user) {
    return { error: "User not found.", status: 401 };
  }

  return { user };
}

function hasWildcardPermission(permissions: Permission[]) {
  return permissions.some(
    (permission) =>
      permission.allowed === true &&
      permission.module_code === "*" &&
      permission.action_code === "*",
  );
}

async function getRestrictedSiteIds(
  admin: ReturnType<typeof adminClient>,
  userId: string,
) {
  const [userRoles, userPermissions] = await Promise.all([
    admin.from("user_roles").select("role_id").eq("user_id", userId),
    admin
      .from("user_permissions")
      .select("module_code, action_code, allowed")
      .eq("user_id", userId),
  ]);

  for (const result of [userRoles, userPermissions]) {
    if (result.error) throw result.error;
  }

  const roleIds = (userRoles.data || [])
    .map((row) => row.role_id)
    .filter(Boolean);
  let roleCodes: string[] = [];
  let rolePermissions: Permission[] = [];

  if (roleIds.length > 0) {
    const roles = await admin.from("roles").select("role_code").in("id", roleIds);

    if (roles.error) throw roles.error;

    roleCodes = (roles.data || [])
      .map((role) => role.role_code)
      .filter(Boolean);

    if (roleCodes.includes("platform_owner") || roleCodes.includes("super_admin")) {
      return [];
    }

    const permissions = await admin
      .from("role_permissions")
      .select("module_code, action_code, allowed")
      .in("role_id", roleIds);

    if (permissions.error) throw permissions.error;
    rolePermissions = permissions.data || [];
  }

  const permissions = [
    ...rolePermissions,
    ...((userPermissions.data || []) as Permission[]),
  ];
  const isSuperUser =
    roleCodes.includes("platform_owner") ||
    roleCodes.includes("super_admin") ||
    hasWildcardPermission(permissions);

  if (isSuperUser) return [];

  const accessRows = await admin
    .from("user_access_assignments")
    .select("site_id")
    .eq("user_id", userId);

  if (accessRows.error) throw accessRows.error;

  return Array.from(
    new Set((accessRows.data || []).map((row) => row.site_id).filter(Boolean)),
  );
}

function parseList(searchParams: URLSearchParams, ...keys: string[]) {
  return keys
    .flatMap((key) => [
      ...searchParams.getAll(key),
      ...(searchParams.get(key)?.split(",") || []),
    ])
    .map((value) => value.trim())
    .filter(Boolean);
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

function lifecycleStatusValue(status: string | null | undefined) {
  const normalized = String(status || "").trim().toLowerCase();
  return ["yet_to_start", "active", "completed", "suspended", "terminated"].includes(
    normalized,
  )
    ? normalized
    : "yet_to_start";
}

function getCompanyLabel(company: any) {
  return (
    String(company?.company_name || company?.company_code || "").trim() ||
    "Unassigned"
  );
}

function getSiteLabel(site: any) {
  return String(site?.site_name || site?.site_code || "").trim() || "Unassigned";
}

function sortLabels(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => {
    if (a === "Unassigned") return 1;
    if (b === "Unassigned") return -1;
    return a.localeCompare(b);
  });
}

function mapIdsByLabel(rows: any[], labelForRow: (row: any) => string) {
  const map = new Map<string, string[]>();

  rows.forEach((row) => {
    const label = labelForRow(row);
    map.set(label, [...(map.get(label) || []), row.id]);
  });

  return map;
}

function applyWorkOrderScope(query: any, restrictedSiteIds: string[]) {
  let next = query.ilike("approval_status", "approved");

  if (restrictedSiteIds.length > 0) {
    next = next.in("site_id", restrictedSiteIds);
  }

  return next;
}

function normalizeStoragePath(document: any) {
  const explicitPath = String(document.file_path || "").trim();
  if (explicitPath) return explicitPath.replace(/^\/+/, "");

  const raw = String(document.file_url || "").trim();
  if (!raw) return "";
  if (!raw.startsWith("http")) return raw.replace(/^\/+/, "");

  const markers = [
    `/storage/v1/object/public/${DOCUMENT_BUCKET}/`,
    `/storage/v1/object/sign/${DOCUMENT_BUCKET}/`,
  ];

  for (const marker of markers) {
    const markerIndex = raw.indexOf(marker);
    if (markerIndex >= 0) {
      return decodeURIComponent(raw.slice(markerIndex + marker.length));
    }
  }

  return raw;
}

function isDriveUrl(value: string | null | undefined) {
  const url = String(value || "").trim();
  return (
    url.startsWith("https://drive.google.com/") ||
    url.startsWith("https://docs.google.com/")
  );
}

async function loadDocumentsForPage(
  admin: ReturnType<typeof adminClient>,
  workOrderIds: string[],
) {
  if (workOrderIds.length === 0) return new Map<string, any[]>();

  const { data, error } = await admin
    .from("work_order_documents")
    .select("id, organization_id, work_order_id, file_name, file_url, file_path, uploaded_at")
    .in("work_order_id", workOrderIds)
    .order("uploaded_at", { ascending: false });

  if (error) throw error;

  const signedDocuments = await Promise.all(
    (data || []).map(async (document) => {
      if (isDriveUrl(document.file_url)) {
        return {
          ...document,
          signed_url: document.file_url,
          signed_url_error: null,
        };
      }

      const path = normalizeStoragePath(document);
      let signed_url: string | null = null;
      let signed_url_error: string | null = null;

      if (path) {
        const { data: signedData, error: signedError } = await admin.storage
          .from(DOCUMENT_BUCKET)
          .createSignedUrl(path, 60 * 10);

        signed_url = signedData?.signedUrl || null;
        signed_url_error = signedError?.message || null;
      }

      return {
        ...document,
        file_path: path || document.file_path,
        signed_url,
        signed_url_error,
      };
    }),
  );

  const documentMap = signedDocuments.reduce<Map<string, any[]>>((map, document) => {
    const rows = map.get(document.work_order_id) || [];
    rows.push(document);
    map.set(document.work_order_id, rows);
    return map;
  }, new Map());

  return documentMap;
}

async function loadDocumentCountsForPage(
  admin: ReturnType<typeof adminClient>,
  workOrderIds: string[],
) {
  if (workOrderIds.length === 0) return new Map<string, number>();

  const { data, error } = await admin
    .from("work_order_documents")
    .select("work_order_id")
    .in("work_order_id", workOrderIds);

  if (error) throw error;

  const countMap = (data || []).reduce<Map<string, number>>((map, document) => {
    map.set(document.work_order_id, (map.get(document.work_order_id) || 0) + 1);
    return map;
  }, new Map());

  return countMap;
}

async function loadVendorsForWorkOrders(
  admin: ReturnType<typeof adminClient>,
  workOrderIds: string[],
) {
  if (workOrderIds.length === 0) return new Map<string, any>();

  const embeddedResult = await admin
    .from("work_order_vendors")
    .select("id, work_order_id, vendor_id, vendor_role, is_primary, vendors(id, vendor_name)")
    .in("work_order_id", workOrderIds)
    .order("is_primary", { ascending: false });

  if (!embeddedResult.error) {
    const primaryLinkByWorkOrder = new Map<string, any>();
    (embeddedResult.data || []).forEach((link: any) => {
      if (!primaryLinkByWorkOrder.has(link.work_order_id)) {
        primaryLinkByWorkOrder.set(link.work_order_id, link);
      }
    });

    const vendorResult = new Map(
      workOrderIds.map((workOrderId) => {
        const link = primaryLinkByWorkOrder.get(workOrderId);
        const embeddedVendor = Array.isArray(link?.vendors)
          ? link.vendors[0]
          : link?.vendors;

        return [
          workOrderId,
          link?.vendor_id
            ? {
                vendor_id: link.vendor_id,
                vendor_name: embeddedVendor?.vendor_name || "-",
                vendor_role: link.vendor_role || "-",
                is_primary: link.is_primary === true,
              }
            : null,
        ];
      }),
    );

    return vendorResult;
  }

  const { data: links, error: linksError } = await admin
    .from("work_order_vendors")
    .select("id, work_order_id, vendor_id, vendor_role, is_primary")
    .in("work_order_id", workOrderIds)
    .order("is_primary", { ascending: false });

  if (linksError) throw linksError;

  const primaryLinkByWorkOrder = new Map<string, any>();
  (links || []).forEach((link) => {
    if (!primaryLinkByWorkOrder.has(link.work_order_id)) {
      primaryLinkByWorkOrder.set(link.work_order_id, link);
    }
  });

  const vendorIds = Array.from(
    new Set((links || []).map((link) => link.vendor_id).filter(Boolean)),
  );
  const { data: vendors, error: vendorsError } = vendorIds.length
    ? await admin.from("vendors").select("id, vendor_name").in("id", vendorIds)
    : { data: [], error: null };

  if (vendorsError) throw vendorsError;

  const vendorMap = new Map((vendors || []).map((vendor) => [vendor.id, vendor]));

  const vendorResult = new Map(
    workOrderIds.map((workOrderId) => {
      const link = primaryLinkByWorkOrder.get(workOrderId);
      const vendor = link?.vendor_id ? vendorMap.get(link.vendor_id) : null;

      return [
        workOrderId,
        link?.vendor_id
          ? {
              vendor_id: link.vendor_id,
              vendor_name: vendor?.vendor_name || "-",
              vendor_role: link.vendor_role || "-",
              is_primary: link.is_primary === true,
            }
          : null,
      ];
    }),
  );

  return vendorResult;
}

function filterMetadataCacheKey(restrictedSiteIds: string[]) {
  return restrictedSiteIds.length
    ? `sites:${[...restrictedSiteIds].sort().join(",")}`
    : "sites:all";
}

async function loadFilterMetadataUncached(
  admin: ReturnType<typeof adminClient>,
  restrictedSiteIds: string[],
) {
  const { data: workOrders, error } = await applyWorkOrderScope(
    admin.from("work_orders").select("company_id, site_id, status, wo_type"),
    restrictedSiteIds,
  );

  if (error) throw error;

  const filterRows = (workOrders || []) as WorkOrderFilterRow[];
  const companyIds = Array.from(
    new Set(filterRows.map((row) => row.company_id).filter(Boolean)),
  );
  const siteIds = Array.from(
    new Set(filterRows.map((row) => row.site_id).filter(Boolean)),
  );

  const [companiesResult, sitesResult] = await Promise.all([
    companyIds.length
      ? admin
          .from("companies")
          .select("id, company_name, company_code")
          .in("id", companyIds)
      : Promise.resolve({ data: [], error: null }),
    siteIds.length
      ? admin.from("sites").select("id, site_name, site_code").in("id", siteIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (companiesResult.error) throw companiesResult.error;
  if (sitesResult.error) throw sitesResult.error;

  const companyMap = new Map((companiesResult.data || []).map((row) => [row.id, row]));
  const siteMap = new Map((sitesResult.data || []).map((row) => [row.id, row]));
  const companyRows = companiesResult.data || [];
  const siteRows = sitesResult.data || [];
  const statusValues = ["Yet to Start", "Active", "Completed", "Suspended", "Terminated"];
  const typeLabels = sortLabels(
    filterRows.map((row) => titleCase(row.wo_type)),
  );
  const typeMap = new Map<string, string[]>();

  filterRows.forEach((row) => {
    const label = titleCase(row.wo_type);
    const raw = row.wo_type || "";
    typeMap.set(label, [...(typeMap.get(label) || []), raw]);
  });

  const result = {
    filters: {
      companies: sortLabels(
        companyIds.map((id) => getCompanyLabel(companyMap.get(id))),
      ),
      sites: sortLabels(siteIds.map((id) => getSiteLabel(siteMap.get(id)))),
      statuses: statusValues,
      wo_types: typeLabels,
    },
    companyLabelMap: mapIdsByLabel(companyRows, getCompanyLabel),
    siteLabelMap: mapIdsByLabel(siteRows, getSiteLabel),
    typeMap,
  };

  return result;
}

async function loadFilterMetadata(
  admin: ReturnType<typeof adminClient>,
  restrictedSiteIds: string[],
) {
  const cacheKey = filterMetadataCacheKey(restrictedSiteIds);
  const cached = filterMetadataCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = await loadFilterMetadataUncached(admin, restrictedSiteIds);
  filterMetadataCache.set(cacheKey, {
    expiresAt: Date.now() + FILTER_METADATA_TTL_MS,
    value,
  });
  return value;
}

function applyCommonFilters(query: any, filters: any) {
  let next = query;

  if (filters.companyIds?.length) {
    next = next.in("company_id", filters.companyIds);
  }

  if (filters.siteIds?.length) {
    next = next.in("site_id", filters.siteIds);
  }

  if (filters.statuses?.length) {
    const typed = filters.statuses.filter((value: string) => value !== "yet_to_start");
    const includeYetToStart = filters.statuses.includes("yet_to_start");

    if (typed.length > 0 && includeYetToStart) {
      next = next.or(`status.in.(${typed.join(",")}),status.eq.yet_to_start,status.is.null`);
    } else if (typed.length > 0) {
      next = next.in("status", typed);
    } else if (includeYetToStart) {
      next = next.or("status.eq.yet_to_start,status.is.null");
    }
  }

  if (filters.woTypes?.length) {
    const typed = filters.woTypes.filter(Boolean);
    const includeUnassigned = filters.woTypes.some((value: string) => !value);
    if (typed.length > 0 && includeUnassigned) {
      const typeList = typed.map((value: string) => JSON.stringify(value)).join(",");
      next = next.or(`wo_type.in.(${typeList}),wo_type.is.null`);
    } else if (typed.length > 0) {
      next = next.in("wo_type", typed);
    } else if (includeUnassigned) {
      next = next.is("wo_type", null);
    }
  }

  if (filters.woSearch) {
    next = next.ilike("wo_number", `%${filters.woSearch}%`);
  }

  if (filters.workOrderIds) {
    if (filters.workOrderIds.length === 0) return null;
    next = next.in("id", filters.workOrderIds);
  }

  return next;
}

function sortRowsByVendor(rows: WorkOrderRow[], vendorMap: Map<string, any>, direction: "asc" | "desc") {
  const multiplier = direction === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const aVendor = vendorMap.get(a.id)?.vendor_name || "";
    const bVendor = vendorMap.get(b.id)?.vendor_name || "";
    return (
      aVendor.localeCompare(bVendor, undefined, {
        numeric: true,
        sensitivity: "base",
      }) * multiplier
    );
  });
}

function applySqlSort(query: any, field: string, direction: "asc" | "desc") {
  const ascending = direction === "asc";

  switch (field) {
    case "wo_value":
      return query.order("wo_value", { ascending });
    case "status":
      return query.order("status", { ascending });
    case "approval_status":
      return query.order("approval_status", { ascending });
    case "wo_date":
      return query.order("wo_date", { ascending }).order("created_at", { ascending });
    case "wo_number":
    default:
      return query.order("wo_number", { ascending });
  }
}

function enrichRows(
  rows: WorkOrderRow[],
  companyMap: Map<string, any>,
  siteMap: Map<string, any>,
  vendorMap: Map<string, any>,
  documentsMap: Map<string, any[]>,
  documentCountMap: Map<string, number> = new Map(),
) {
  return rows.map((row) => {
    const company = row.company_id ? companyMap.get(row.company_id) : null;
    const site = row.site_id ? siteMap.get(row.site_id) : null;
    const vendor = vendorMap.get(row.id);
    const documents = documentsMap.get(row.id) || [];
    const vendorName = vendor?.vendor_name?.trim() || null;

    return {
      ...row,
      company_name: company?.company_name || company?.company_code || null,
      company_code: company?.company_code || null,
      site_name: site?.site_name || site?.site_code || null,
      site_code: site?.site_code || null,
      vendor_id: vendor?.vendor_id || null,
      vendor_name: vendorName,
      vendor_names: vendorName ? [vendorName] : [],
      vendor_role: vendor?.vendor_role || null,
      is_primary_vendor: vendor?.is_primary ?? null,
      documents,
      document_count: documentCountMap.get(row.id) ?? documents.length,
    };
  });
}

const WORK_ORDER_COLUMNS = `
  id,
  wo_number,
  wo_date,
  wo_type,
  description,
  status,
  wo_value,
  gst_percent,
  approval_status,
  approved_by_name,
  approved_by_email,
  approved_at,
  created_by_name,
  created_by_email,
  company_id,
  site_id,
  organization_id,
  department,
  cost_code,
  created_at
`;

async function loadPageRows({
  admin,
  restrictedSiteIds,
  commonFilters,
  sortField,
  sortDirection,
  from,
  to,
}: {
  admin: ReturnType<typeof adminClient>;
  restrictedSiteIds: string[];
  commonFilters: any;
  sortField: string;
  sortDirection: "asc" | "desc";
  from: number;
  to: number;
}) {
  let rows: WorkOrderRow[] = [];
  let total = 0;

  if (commonFilters.workOrderIds?.length === 0) {
    return { rows, total };
  }

  if (sortField === "vendor_name") {
    let allQuery = applyCommonFilters(
      applyWorkOrderScope(
        admin.from("work_orders").select(WORK_ORDER_COLUMNS),
        restrictedSiteIds,
      ),
      commonFilters,
    );

    if (allQuery) {
      const { data, error } = await allQuery;
      if (error) throw error;

      const allRows = (data || []) as WorkOrderRow[];
      const allVendorMap = await loadVendorsForWorkOrders(
        admin,
        allRows.map((row) => row.id),
      );
      const sortedRows = sortRowsByVendor(allRows, allVendorMap, sortDirection);
      total = sortedRows.length;
      rows = sortedRows.slice(from, to + 1);
    }
  } else {
    let query = applyCommonFilters(
      applyWorkOrderScope(
        admin.from("work_orders").select(WORK_ORDER_COLUMNS, {
          count: "exact",
        }),
        restrictedSiteIds,
      ),
      commonFilters,
    );

    if (query) {
      query = applySqlSort(query, sortField, sortDirection).range(from, to);
      const { data, error, count } = await query;

      if (error) throw error;
      rows = (data || []) as WorkOrderRow[];
      total = count || 0;
    }
  }

  return { rows, total };
}

export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, "work_orders", "view");

    if ("response" in auth) {
      return auth.response;
    }

    const admin = adminClient();
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page") || 1) || 1);
    const pageSize = Math.min(
      PAGE_SIZE_MAX,
      Math.max(1, Number(searchParams.get("page_size") || PAGE_SIZE_DEFAULT) || PAGE_SIZE_DEFAULT),
    );
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const sortField = String(searchParams.get("sort_field") || "wo_number");
    const sortDirection =
      String(searchParams.get("sort_direction") || "asc").toLowerCase() === "desc"
        ? "desc"
        : "asc";
    const restrictedSiteIds = await getRestrictedSiteIds(admin, auth.user.id);

    const selectedCompanyLabels = parseList(searchParams, "company", "companies");
    const selectedSiteLabels = parseList(searchParams, "site", "sites");
    const selectedStatusLabels = parseList(searchParams, "statuses", "status");
    const selectedTypeLabels = parseList(searchParams, "wo_types", "wo_type");
    const explicitCompanyIds = parseList(searchParams, "company_ids");
    const explicitSiteIds = parseList(searchParams, "site_ids");
    const statuses = selectedStatusLabels.map((label) =>
      lifecycleStatusValue(label.replace(/\s+/g, "_")),
    );
    const woSearch = String(searchParams.get("wo_search") || "").trim();
    const contractorSearch = String(searchParams.get("contractor_search") || "").trim();
    const metadataPromise = loadFilterMetadata(admin, restrictedSiteIds);
    const needsMetadataForFilters =
      (selectedCompanyLabels.length > 0 && explicitCompanyIds.length === 0) ||
      (selectedSiteLabels.length > 0 && explicitSiteIds.length === 0) ||
      selectedTypeLabels.length > 0;
    let contractorWorkOrderIds: string[] | null = null;

    if (contractorSearch) {
      const { data: matchingVendors, error: vendorSearchError } = await admin
        .from("vendors")
        .select("id")
        .ilike("vendor_name", `%${contractorSearch}%`);

      if (vendorSearchError) throw vendorSearchError;

      const vendorIds = (matchingVendors || []).map((vendor) => vendor.id).filter(Boolean);

      if (vendorIds.length === 0) {
        contractorWorkOrderIds = [];
      } else {
        const { data: matchingLinks, error: matchingLinksError } = await admin
          .from("work_order_vendors")
          .select("work_order_id")
          .in("vendor_id", vendorIds);

        if (matchingLinksError) throw matchingLinksError;

        contractorWorkOrderIds = Array.from(
          new Set((matchingLinks || []).map((link) => link.work_order_id).filter(Boolean)),
        );
      }
    }

    let rows: WorkOrderRow[] = [];
    let total = 0;
    let metadata: Awaited<ReturnType<typeof loadFilterMetadata>>;

    if (
      selectedCompanyLabels.includes("__none__") ||
      selectedSiteLabels.includes("__none__") ||
      selectedStatusLabels.includes("__none__") ||
      selectedTypeLabels.includes("__none__") ||
      contractorWorkOrderIds?.length === 0
    ) {
      metadata = await metadataPromise;
      rows = [];
      total = 0;
    } else if (needsMetadataForFilters) {
      metadata = await metadataPromise;
      const commonFilters = {
        companyIds: explicitCompanyIds.length
          ? explicitCompanyIds
          : selectedCompanyLabels.flatMap((label) => metadata.companyLabelMap.get(label) || []),
        siteIds: explicitSiteIds.length
          ? explicitSiteIds
          : selectedSiteLabels.flatMap((label) => metadata.siteLabelMap.get(label) || []),
        statuses,
        woTypes: selectedTypeLabels.flatMap((label) => metadata.typeMap.get(label) || []),
        woSearch,
        workOrderIds: contractorWorkOrderIds,
      };
      const pageRows = await loadPageRows({
        admin,
        restrictedSiteIds,
        commonFilters,
        sortField,
        sortDirection,
        from,
        to,
      });
      rows = pageRows.rows;
      total = pageRows.total;
    } else {
      const commonFilters = {
        companyIds: explicitCompanyIds,
        siteIds: explicitSiteIds,
        statuses,
        woTypes: [],
        woSearch,
        workOrderIds: contractorWorkOrderIds,
      };
      const pageRowsPromise = loadPageRows({
        admin,
        restrictedSiteIds,
        commonFilters,
        sortField,
        sortDirection,
        from,
        to,
      });
      const [nextMetadata, pageRows] = await Promise.all([
        metadataPromise,
        pageRowsPromise,
      ]);
      metadata = nextMetadata;
      rows = pageRows.rows;
      total = pageRows.total;
    }

    const companyIdsForRows = Array.from(
      new Set(rows.map((row) => row.company_id).filter(Boolean)),
    );
    const siteIdsForRows = Array.from(
      new Set(rows.map((row) => row.site_id).filter(Boolean)),
    );
    const workOrderIds = rows.map((row) => row.id);
    const includeDocuments = String(searchParams.get("include_documents") || "page");
    const companySitePromise = Promise.all([
      companyIdsForRows.length
        ? admin
            .from("companies")
            .select("id, company_name, company_code, organization_id")
            .in("id", companyIdsForRows)
        : Promise.resolve({ data: [], error: null }),
      siteIdsForRows.length
        ? admin
            .from("sites")
            .select("id, site_name, site_code, organization_id")
            .in("id", siteIdsForRows)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const documentPromise =
      includeDocuments === "page"
        ? loadDocumentsForPage(admin, workOrderIds).then((documentsMap) => ({
            documentsMap,
            documentCountMap: new Map<string, number>(),
          }))
        : includeDocuments === "count"
        ? loadDocumentCountsForPage(admin, workOrderIds).then((documentCountMap) => ({
            documentsMap: new Map<string, any[]>(),
            documentCountMap,
          }))
        : Promise.resolve({
            documentsMap: new Map<string, any[]>(),
            documentCountMap: new Map<string, number>(),
          });

    const [[companiesResult, sitesResult], vendorMap, documentResult] = await Promise.all([
      companySitePromise,
      loadVendorsForWorkOrders(admin, workOrderIds),
      documentPromise,
    ]);

    if (companiesResult.error) throw companiesResult.error;
    if (sitesResult.error) throw sitesResult.error;

    const companyMap = new Map((companiesResult.data || []).map((row) => [row.id, row]));
    const siteMap = new Map((sitesResult.data || []).map((row) => [row.id, row]));
    const responseBody = {
      rows: enrichRows(
        rows,
        companyMap,
        siteMap,
        vendorMap,
        documentResult.documentsMap,
        documentResult.documentCountMap,
      ),
      total,
      page,
      page_size: pageSize,
      filters: metadata.filters,
      last_updated: new Date().toISOString(),
    };

    return NextResponse.json(responseBody);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load Work Orders register." },
      { status: 500 },
    );
  }
}
