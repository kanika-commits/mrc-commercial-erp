import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  hasServerPermission,
  loadPermissionContext,
} from "@/lib/serverPermissions";
import {
  applyOrganizationScope,
  isGlobalScope,
  loadActorOrganizationScope,
} from "@/lib/serverOrganizationScope";
import {
  WORK_ORDER_CHART_GROUP_LIMIT,
  WORK_ORDER_DATASET_CODE,
  WORK_ORDER_FIELDS,
  WORK_ORDER_FILTERS,
  WORK_ORDER_GROUPS,
  WORK_ORDER_MEASURES,
  WORK_ORDER_TABLE_PAGE_SIZE_DEFAULT,
  WORK_ORDER_TABLE_PAGE_SIZE_MAX,
  WORK_ORDER_TABLE_SORT_FIELDS,
  WORK_ORDER_VISUALIZATIONS,
  type ReportVisualization,
  type WorkOrderFieldCode,
  type WorkOrderFilterCode,
  type WorkOrderGroupCode,
  type WorkOrderMeasureCode,
} from "@/lib/reports/workOrderDataset";

const WORK_ORDER_COLUMNS = `
  id,
  wo_number,
  wo_date,
  wo_type,
  status,
  wo_value,
  gst_percent,
  approval_status,
  company_id,
  site_id,
  organization_id,
  created_at
`;

const fieldCodes = new Set(WORK_ORDER_FIELDS.map((field) => field.code));
const filterCodes = new Set(WORK_ORDER_FILTERS.map((filter) => filter.code));
const groupCodes = new Set(WORK_ORDER_GROUPS.map((group) => group.code));
const measureCodes = new Set(WORK_ORDER_MEASURES.map((measure) => measure.code));
const visualizationCodes = new Set<ReportVisualization>(["table", "kpi", "pie", "bar"]);

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function text(value: unknown) {
  return String(value || "").trim();
}

function money(value: unknown) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function gstAmount(row: any) {
  return money(row.wo_value) * (money(row.gst_percent) / 100);
}

function totalAmount(row: any) {
  return money(row.wo_value) + gstAmount(row);
}

function formatDate(value: unknown) {
  const next = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(next) ? next : null;
}

function title(value: unknown) {
  const next = text(value);
  if (!next) return "-";
  return next
    .replace(/_/g, " ")
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

async function loadActorAssignments(admin: ReturnType<typeof adminClient>, userId: string) {
  const { data, error } = await admin
    .from("user_access_assignments")
    .select("company_id, site_id")
    .eq("user_id", userId);

  if (error) throw error;

  return {
    companyIds: Array.from(new Set((data || []).map((row) => row.company_id).filter(Boolean))) as string[],
    siteIds: Array.from(new Set((data || []).map((row) => row.site_id).filter(Boolean))) as string[],
  };
}

function applyAccessScope(query: any, organizationScope: string[] | null, assignments: { companyIds: string[]; siteIds: string[] }) {
  let next = applyOrganizationScope(query, organizationScope);
  if (!next) return null;

  if (assignments.siteIds.length > 0) {
    next = next.in("site_id", assignments.siteIds);
  } else if (assignments.companyIds.length > 0) {
    next = next.in("company_id", assignments.companyIds);
  }

  return next;
}

function normalizeStringList(value: unknown) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const next = text(value);
  return next ? [next] : [];
}

function normalizeFilters(value: unknown) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const filters: Partial<Record<WorkOrderFilterCode, string | string[]>> = {};

  for (const [key, rawValue] of Object.entries(source)) {
    if (!filterCodes.has(key as WorkOrderFilterCode)) {
      return { error: `Unsupported filter: ${key}` } as const;
    }

    if (key === "date_from" || key === "date_to") {
      const date = formatDate(rawValue);
      if (text(rawValue) && !date) return { error: `${key} must use YYYY-MM-DD.` } as const;
      if (date) filters[key as WorkOrderFilterCode] = date;
      continue;
    }

    const values = normalizeStringList(rawValue);
    if (values.length > 0) filters[key as WorkOrderFilterCode] = values;
  }

  return { filters } as const;
}

function validatePayload(payload: any): any {
  if (payload?.dataset !== WORK_ORDER_DATASET_CODE) {
    return { error: "Unsupported dataset." } as const;
  }

  const visualization = text(payload.visualization || "table") as ReportVisualization;
  if (!visualizationCodes.has(visualization)) return { error: "Unsupported visualization." } as const;

  const selectedFields = Array.isArray(payload.fields)
    ? payload.fields.map(text).filter(Boolean) as WorkOrderFieldCode[]
    : [];
  for (const field of selectedFields) {
    if (!fieldCodes.has(field)) return { error: `Unsupported field: ${field}` } as const;
  }

  const groupBy = text(payload.groupBy) as WorkOrderGroupCode | "";
  if (groupBy && !groupCodes.has(groupBy)) return { error: "Unsupported grouping." } as const;

  const measure = text(payload.measure || "record_count") as WorkOrderMeasureCode;
  if (!measureCodes.has(measure)) return { error: "Unsupported measure." } as const;

  const filtersResult = normalizeFilters(payload.filters);
  if ("error" in filtersResult) return filtersResult;

  if (visualization === "table" && selectedFields.length === 0) {
    return { error: "Select at least one field for a table report." } as const;
  }
  if (visualization === "kpi" && groupBy) {
    return { error: "KPI reports cannot use grouping." } as const;
  }
  if ((visualization === "pie" || visualization === "bar") && !groupBy) {
    return { error: "Chart reports require one grouping." } as const;
  }

  const sortField = text(payload.sort?.field || "wo_number") as WorkOrderFieldCode;
  if (!WORK_ORDER_TABLE_SORT_FIELDS.has(sortField)) return { error: "Unsupported sort field." } as const;
  const sortDirection = text(payload.sort?.direction).toLowerCase() === "desc" ? "desc" : "asc";
  const page = Math.max(1, Number(payload.page || 1) || 1);
  const pageSize = Math.min(
    WORK_ORDER_TABLE_PAGE_SIZE_MAX,
    Math.max(1, Number(payload.pageSize || WORK_ORDER_TABLE_PAGE_SIZE_DEFAULT) || WORK_ORDER_TABLE_PAGE_SIZE_DEFAULT),
  );

  return {
    definition: {
      visualization,
      selectedFields,
      filters: filtersResult.filters,
      groupBy: groupBy || null,
      measure,
      sortField,
      sortDirection,
      page,
      pageSize,
    },
  } as const;
}

function applyFilters(query: any, filters: Partial<Record<WorkOrderFilterCode, string | string[]>>) {
  let next = query;
  if (filters.date_from) next = next.gte("wo_date", filters.date_from);
  if (filters.date_to) next = next.lte("wo_date", filters.date_to);
  if (filters.company_id) next = next.in("company_id", filters.company_id as string[]);
  if (filters.site_id) next = next.in("site_id", filters.site_id as string[]);
  if (filters.wo_type) next = next.in("wo_type", filters.wo_type as string[]);
  if (filters.status) next = next.in("status", filters.status as string[]);
  if (filters.approval_status) next = next.in("approval_status", filters.approval_status as string[]);
  return next;
}

function applySort(query: any, field: WorkOrderFieldCode, direction: "asc" | "desc") {
  const ascending = direction === "asc";
  if (field === "basic_value") return query.order("wo_value", { ascending });
  if (field === "wo_date") return query.order("wo_date", { ascending }).order("created_at", { ascending });
  if (field === "status") return query.order("status", { ascending });
  if (field === "approval_status") return query.order("approval_status", { ascending });
  return query.order("wo_number", { ascending });
}

async function loadVendorsForWorkOrders(admin: ReturnType<typeof adminClient>, workOrderIds: string[]) {
  if (!workOrderIds.length) return new Map<string, any>();
  const { data, error } = await admin
    .from("work_order_vendors")
    .select("work_order_id, vendor_id, vendor_role, is_primary, vendors(id, vendor_name)")
    .in("work_order_id", workOrderIds);
  if (error) throw error;

  const map = new Map<string, any>();
  for (const link of data || []) {
    if (!map.has(link.work_order_id) || link.is_primary) map.set(link.work_order_id, link);
  }
  return map;
}

async function loadLookupMaps(admin: ReturnType<typeof adminClient>, rows: any[]) {
  const companyIds = Array.from(new Set(rows.map((row) => row.company_id).filter(Boolean)));
  const siteIds = Array.from(new Set(rows.map((row) => row.site_id).filter(Boolean)));
  const workOrderIds = rows.map((row) => row.id).filter(Boolean);

  const [companies, sites, vendors] = await Promise.all([
    companyIds.length
      ? admin.from("companies").select("id, company_name, company_code").in("id", companyIds)
      : Promise.resolve({ data: [], error: null }),
    siteIds.length
      ? admin.from("sites").select("id, site_name, site_code").in("id", siteIds)
      : Promise.resolve({ data: [], error: null }),
    loadVendorsForWorkOrders(admin, workOrderIds),
  ]);
  if (companies.error) throw companies.error;
  if (sites.error) throw sites.error;

  return {
    companyMap: new Map((companies.data || []).map((row: any) => [row.id, row])),
    siteMap: new Map((sites.data || []).map((row: any) => [row.id, row])),
    vendorMap: vendors,
  };
}

function rowValue(row: any, field: WorkOrderFieldCode, maps: Awaited<ReturnType<typeof loadLookupMaps>>) {
  const company: any = row.company_id ? maps.companyMap.get(row.company_id) : null;
  const site: any = row.site_id ? maps.siteMap.get(row.site_id) : null;
  const vendorLink: any = maps.vendorMap.get(row.id);
  const vendor: any = Array.isArray(vendorLink?.vendors) ? vendorLink.vendors[0] : vendorLink?.vendors;

  switch (field) {
    case "wo_number": return row.wo_number || "-";
    case "wo_date": return row.wo_date || "-";
    case "company": return company?.company_name || company?.company_code || "-";
    case "site": return site?.site_name || site?.site_code || "-";
    case "vendor": return vendor?.vendor_name || "-";
    case "wo_type": return row.wo_type || "-";
    case "status": return title(row.status);
    case "approval_status": return title(row.approval_status);
    case "basic_value": return money(row.wo_value);
    case "gst_amount": return gstAmount(row);
    case "total_value": return totalAmount(row);
  }
}

function measureValue(row: any, measure: WorkOrderMeasureCode) {
  switch (measure) {
    case "sum_basic_value": return money(row.wo_value);
    case "sum_gst_amount": return gstAmount(row);
    case "sum_total_value": return totalAmount(row);
    case "record_count":
    default:
      return 1;
  }
}

function fieldMeta(fields: WorkOrderFieldCode[]) {
  return fields.map((field) => WORK_ORDER_FIELDS.find((item) => item.code === field)!);
}

async function baseQuery(admin: ReturnType<typeof adminClient>, auth: any, filters: Partial<Record<WorkOrderFilterCode, string | string[]>>) {
  const organizationScope = await loadActorOrganizationScope(admin, auth);
  const assignments = isGlobalScope(organizationScope)
    ? { companyIds: [], siteIds: [] }
    : await loadActorAssignments(admin, auth.user.id);
  let query = applyAccessScope(
    admin.from("work_orders").select(WORK_ORDER_COLUMNS, { count: "exact" }),
    organizationScope,
    assignments,
  );
  if (!query) return null;
  query = query.or(
    "and(approval_status.ilike.approved,status.eq.active),status.ilike.suspended,status.ilike.cancelled,approval_status.ilike.suspended,approval_status.ilike.cancelled",
  );
  return applyFilters(query, filters);
}

async function applyVendorFilter(admin: ReturnType<typeof adminClient>, query: any, vendorIds: string[] | undefined) {
  if (!vendorIds?.length) return query;
  const { data, error } = await admin
    .from("work_order_vendors")
    .select("work_order_id")
    .in("vendor_id", vendorIds);
  if (error) throw error;
  const workOrderIds = Array.from(new Set((data || []).map((row: any) => row.work_order_id).filter(Boolean)));
  if (!workOrderIds.length) return null;
  return query.in("id", workOrderIds);
}

async function runTableReport(admin: ReturnType<typeof adminClient>, auth: any, definition: any) {
  let query = await baseQuery(admin, auth, definition.filters);
  if (!query) return { columns: fieldMeta(definition.selectedFields), rows: [], total: 0, page: definition.page, page_size: definition.pageSize };
  query = await applyVendorFilter(admin, query, definition.filters.vendor_id);
  if (!query) return { columns: fieldMeta(definition.selectedFields), rows: [], total: 0, page: definition.page, page_size: definition.pageSize };

  const from = (definition.page - 1) * definition.pageSize;
  const to = from + definition.pageSize - 1;
  const { data, error, count } = await applySort(query, definition.sortField, definition.sortDirection).range(from, to);
  if (error) throw error;
  const rows = data || [];
  const maps = await loadLookupMaps(admin, rows);
  return {
    columns: fieldMeta(definition.selectedFields),
    rows: rows.map((row: any) =>
      Object.fromEntries(definition.selectedFields.map((field: WorkOrderFieldCode) => [field, rowValue(row, field, maps)])),
    ),
    total: count || 0,
    page: definition.page,
    page_size: definition.pageSize,
  };
}

async function runAggregateReport(admin: ReturnType<typeof adminClient>, auth: any, definition: any) {
  let query = await baseQuery(admin, auth, definition.filters);
  if (!query) return { rows: [], total: 0 };
  query = await applyVendorFilter(admin, query, definition.filters.vendor_id);
  if (!query) return { rows: [], total: 0 };

  const { data, error, count } = await query.limit(5000);
  if (error) throw error;
  const rows = data || [];
  const maps = await loadLookupMaps(admin, rows);

  if (definition.visualization === "kpi") {
    return {
      rows: [{
        label: WORK_ORDER_MEASURES.find((measure) => measure.code === definition.measure)?.label || definition.measure,
        value: rows.reduce((sum: number, row: any) => sum + measureValue(row, definition.measure), 0),
      }],
      total: count || rows.length,
    };
  }

  const groups = new Map<string, number>();
  for (const row of rows) {
    const label = String(rowValue(row, definition.groupBy, maps));
    groups.set(label, (groups.get(label) || 0) + measureValue(row, definition.measure));
  }
  const groupedRows = Array.from(groups.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  if (groupedRows.length > WORK_ORDER_CHART_GROUP_LIMIT) {
    return {
      error: `Too many groups for this chart. Refine filters to ${WORK_ORDER_CHART_GROUP_LIMIT} groups or fewer.`,
      status: 400,
    } as const;
  }

  return {
    rows: groupedRows,
    total: count || rows.length,
    group_limit: WORK_ORDER_CHART_GROUP_LIMIT,
  };
}

async function requireReportAccess(request: Request) {
  const auth = await loadPermissionContext(request);
  if ("response" in auth) return auth;
  if (!hasServerPermission(auth, "reports", "view")) {
    return { response: jsonError("You do not have permission to view reports.", 403) } as const;
  }
  if (!hasServerPermission(auth, "work_orders", "view")) {
    return { response: jsonError("You do not have permission to view Work Orders.", 403) } as const;
  }
  return auth;
}

function uniqueOption(rows: Array<{ value: string; label: string }>) {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.value && !map.has(row.value)) map.set(row.value, row.label || row.value);
  }
  return Array.from(map.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function loadMetadata(admin: ReturnType<typeof adminClient>, auth: any) {
  const query = await baseQuery(admin, auth, {});
  if (!query) {
    return {
      fields: WORK_ORDER_FIELDS,
      filters: WORK_ORDER_FILTERS,
      groups: WORK_ORDER_GROUPS,
      measures: WORK_ORDER_MEASURES,
      visualizations: WORK_ORDER_VISUALIZATIONS,
      filter_options: {},
    };
  }

  const { data, error } = await query.limit(5000);
  if (error) throw error;
  const rows = data || [];
  const maps = await loadLookupMaps(admin, rows);
  const vendorIds = Array.from(
    new Set(Array.from(maps.vendorMap.values()).map((link: any) => link.vendor_id).filter(Boolean)),
  );

  return {
    fields: WORK_ORDER_FIELDS,
    filters: WORK_ORDER_FILTERS,
    groups: WORK_ORDER_GROUPS,
    measures: WORK_ORDER_MEASURES,
    visualizations: WORK_ORDER_VISUALIZATIONS,
    filter_options: {
      company_id: uniqueOption(rows.map((row: any) => {
        const company: any = row.company_id ? maps.companyMap.get(row.company_id) : null;
        return { value: row.company_id, label: company?.company_name || company?.company_code || row.company_id };
      })),
      site_id: uniqueOption(rows.map((row: any) => {
        const site: any = row.site_id ? maps.siteMap.get(row.site_id) : null;
        return { value: row.site_id, label: site?.site_name || site?.site_code || row.site_id };
      })),
      vendor_id: uniqueOption(vendorIds.map((vendorId) => {
        const link: any = Array.from(maps.vendorMap.values()).find((item: any) => item.vendor_id === vendorId);
        const vendor: any = Array.isArray(link?.vendors) ? link.vendors[0] : link?.vendors;
        return { value: vendorId, label: vendor?.vendor_name || vendorId };
      })),
      wo_type: uniqueOption(rows.map((row: any) => ({ value: row.wo_type, label: row.wo_type }))),
      status: uniqueOption(rows.map((row: any) => ({ value: row.status, label: title(row.status) }))),
      approval_status: uniqueOption(rows.map((row: any) => ({ value: row.approval_status, label: title(row.approval_status) }))),
    },
  };
}

export async function GET(request: Request) {
  try {
    const access = await requireReportAccess(request);
    if ("response" in access) return access.response;
    const dataset = text(new URL(request.url).searchParams.get("dataset"));
    if (dataset !== WORK_ORDER_DATASET_CODE) return jsonError("Unsupported dataset.", 400);
    const admin = adminClient();
    return NextResponse.json({
      dataset: WORK_ORDER_DATASET_CODE,
      metadata: await loadMetadata(admin, access),
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load report metadata.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireReportAccess(request);
    if ("response" in auth) return auth.response;

    const payload = await request.json().catch(() => ({}));
    const validation = validatePayload(payload);
    if ("error" in validation) return jsonError(String(validation.error || "Invalid report definition."), 400);

    const admin = adminClient();
    const result = validation.definition.visualization === "table"
      ? await runTableReport(admin, auth, validation.definition)
      : await runAggregateReport(admin, auth, validation.definition);

    if ("error" in result) return jsonError(String(result.error || "Invalid report result."), Number(result.status || 400));

    return NextResponse.json({
      dataset: WORK_ORDER_DATASET_CODE,
      visualization: validation.definition.visualization,
      measure: validation.definition.measure,
      group_by: validation.definition.groupBy,
      result,
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to run report.", 500);
  }
}
