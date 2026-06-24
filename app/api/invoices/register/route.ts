import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";
import {
  applyOrganizationScope,
  isGlobalScope,
  loadActorOrganizationScope,
  type OrganizationScope,
} from "@/lib/serverOrganizationScope";

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 100;
const REJECTED_PREVIEW_LIMIT = 50;

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

function parseOptionalId(value: string | null) {
  const trimmed = String(value || "").trim();
  return trimmed || null;
}

async function loadActorAssignments(admin: ReturnType<typeof adminClient>, userId: string) {
  const { data, error } = await admin
    .from("user_access_assignments")
    .select("company_id, site_id")
    .eq("user_id", userId);

  if (error) throw error;

  return {
    companyIds: Array.from(
      new Set((data || []).map((row) => row.company_id).filter(Boolean)),
    ) as string[],
    siteIds: Array.from(
      new Set((data || []).map((row) => row.site_id).filter(Boolean)),
    ) as string[],
  };
}

function applyWorkOrderBaseScope(
  query: any,
  organizationScope: OrganizationScope,
  assignments: { companyIds: string[]; siteIds: string[] },
) {
  let scopedQuery = applyOrganizationScope(query, organizationScope);
  if (!scopedQuery) return null;

  if (assignments.siteIds.length > 0) {
    scopedQuery = scopedQuery.in("site_id", assignments.siteIds);
  } else if (assignments.companyIds.length > 0) {
    scopedQuery = scopedQuery.in("company_id", assignments.companyIds);
  }

  return scopedQuery;
}

async function loadWorkOrderIdsForScope(
  admin: ReturnType<typeof adminClient>,
  organizationScope: OrganizationScope,
  assignments: { companyIds: string[]; siteIds: string[] },
  filters: {
    companyId?: string | null;
    siteId?: string | null;
    workOrderId?: string | null;
  },
) {
  let query = admin.from("work_orders").select("id");

  query = applyWorkOrderBaseScope(query, organizationScope, assignments);
  if (!query) return [];

  if (filters.companyId) query = query.eq("company_id", filters.companyId);
  if (filters.siteId) query = query.eq("site_id", filters.siteId);
  if (filters.workOrderId) query = query.eq("id", filters.workOrderId);

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((row) => row.id).filter(Boolean) as string[];
}

async function loadSearchMatches(
  admin: ReturnType<typeof adminClient>,
  organizationScope: OrganizationScope,
  assignments: { companyIds: string[]; siteIds: string[] },
  search: string,
) {
  if (!search) {
    return { workOrderIds: null as string[] | null, vendorIds: null as string[] | null };
  }

  const searchPattern = `%${search}%`;
  const matchingWorkOrderIds = new Set<string>();

  const workOrderSearchQuery = applyWorkOrderBaseScope(
    admin.from("work_orders").select("id").ilike("wo_number", searchPattern),
    organizationScope,
    assignments,
  );

  const companySearchQuery = applyOrganizationScope(
    admin
      .from("companies")
      .select("id")
      .or(`company_name.ilike.${searchPattern},company_code.ilike.${searchPattern}`),
    organizationScope,
  );

  const siteSearchQuery = applyOrganizationScope(
    admin
      .from("sites")
      .select("id")
      .or(`site_name.ilike.${searchPattern},site_code.ilike.${searchPattern}`),
    organizationScope,
  );

  const vendorSearchQuery = applyOrganizationScope(
    admin.from("vendors").select("id").ilike("vendor_name", searchPattern),
    organizationScope,
  );

  const [workOrderSearch, companySearch, siteSearch, vendorSearch] = await Promise.all([
    workOrderSearchQuery ? workOrderSearchQuery : Promise.resolve({ data: [], error: null }),
    companySearchQuery ? companySearchQuery : Promise.resolve({ data: [], error: null }),
    siteSearchQuery ? siteSearchQuery : Promise.resolve({ data: [], error: null }),
    vendorSearchQuery ? vendorSearchQuery : Promise.resolve({ data: [], error: null }),
  ]);

  for (const result of [workOrderSearch, companySearch, siteSearch, vendorSearch]) {
    if (result.error) throw result.error;
  }

  (workOrderSearch.data || []).forEach((row: any) => {
    if (row.id) matchingWorkOrderIds.add(row.id);
  });

  const companyIds = (companySearch.data || []).map((row: any) => row.id).filter(Boolean);
  const siteIds = (siteSearch.data || []).map((row: any) => row.id).filter(Boolean);

  if (companyIds.length > 0 || siteIds.length > 0) {
    let scopedRelatedWorkOrders = applyWorkOrderBaseScope(
      admin.from("work_orders").select("id, company_id, site_id"),
      organizationScope,
      assignments,
    );

    if (scopedRelatedWorkOrders) {
      const clauses: string[] = [];
      if (companyIds.length > 0) clauses.push(`company_id.in.(${companyIds.join(",")})`);
      if (siteIds.length > 0) clauses.push(`site_id.in.(${siteIds.join(",")})`);
      scopedRelatedWorkOrders = scopedRelatedWorkOrders.or(clauses.join(","));
      const { data, error } = await scopedRelatedWorkOrders;
      if (error) throw error;
      (data || []).forEach((row: any) => {
        if (row.id) matchingWorkOrderIds.add(row.id);
      });
    }
  }

  return {
    workOrderIds: Array.from(matchingWorkOrderIds),
    vendorIds: (vendorSearch.data || []).map((row: any) => row.id).filter(Boolean),
  };
}

function applyInvoiceSearch(
  query: any,
  search: string,
  workOrderIds: string[] | null,
  vendorIds: string[] | null,
) {
  if (!search) return query;

  const clauses = [`invoice_number.ilike.%${search}%`];
  if (workOrderIds && workOrderIds.length > 0) {
    clauses.push(`work_order_id.in.(${workOrderIds.join(",")})`);
  }
  if (vendorIds && vendorIds.length > 0) {
    clauses.push(`vendor_id.in.(${vendorIds.join(",")})`);
  }

  return query.or(clauses.join(","));
}

function applyBaseInvoiceFilters(
  query: any,
  filters: {
    scopedWorkOrderIds: string[] | null;
    vendorId: string | null;
    itcStatus: string | null;
    search: string;
    searchWorkOrderIds: string[] | null;
    searchVendorIds: string[] | null;
  },
) {
  let next = query;

  if (filters.scopedWorkOrderIds) {
    next = next.in("work_order_id", filters.scopedWorkOrderIds);
  }
  if (filters.vendorId) {
    next = next.eq("vendor_id", filters.vendorId);
  }
  if (filters.itcStatus) {
    next = next.ilike("itc_status", filters.itcStatus);
  }

  return applyInvoiceSearch(
    next,
    filters.search,
    filters.searchWorkOrderIds,
    filters.searchVendorIds,
  );
}

function applyActiveApprovalFilter(query: any) {
  return query.or("approval_status.not.ilike.rejected,approval_status.is.null");
}

function applyPendingItcFilter(query: any) {
  return query.or("itc_status.ilike.pending,itc_status.is.null");
}

async function enrichRows(admin: ReturnType<typeof adminClient>, invoices: any[]) {
  const workOrderIds = Array.from(
    new Set(invoices.map((invoice) => invoice.work_order_id).filter(Boolean)),
  );
  const vendorIds = Array.from(
    new Set(invoices.map((invoice) => invoice.vendor_id).filter(Boolean)),
  );

  const [{ data: workOrders, error: workOrderError }, { data: vendors, error: vendorError }] =
    await Promise.all([
      workOrderIds.length
        ? admin.from("work_orders").select("id, wo_number, site_id, company_id").in("id", workOrderIds)
        : Promise.resolve({ data: [], error: null }),
      vendorIds.length
        ? admin.from("vendors").select("id, vendor_name").in("id", vendorIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (workOrderError) throw workOrderError;
  if (vendorError) throw vendorError;

  const siteIds = Array.from(
    new Set((workOrders || []).map((workOrder: any) => workOrder.site_id).filter(Boolean)),
  );
  const companyIds = Array.from(
    new Set((workOrders || []).map((workOrder: any) => workOrder.company_id).filter(Boolean)),
  );

  const [{ data: sites, error: siteError }, { data: companies, error: companyError }] =
    await Promise.all([
      siteIds.length
        ? admin.from("sites").select("id, site_name, site_code").in("id", siteIds)
        : Promise.resolve({ data: [], error: null }),
      companyIds.length
        ? admin.from("companies").select("id, company_name, company_code").in("id", companyIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (siteError) throw siteError;
  if (companyError) throw companyError;

  const workOrderMap = new Map((workOrders || []).map((row: any) => [row.id, row]));
  const vendorMap = new Map((vendors || []).map((row: any) => [row.id, row]));
  const siteMap = new Map((sites || []).map((row: any) => [row.id, row]));
  const companyMap = new Map((companies || []).map((row: any) => [row.id, row]));

  return invoices.map((invoice) => {
    const workOrder: any = invoice.work_order_id ? workOrderMap.get(invoice.work_order_id) : null;
    const site: any = workOrder?.site_id ? siteMap.get(workOrder.site_id) : null;
    const company: any = workOrder?.company_id ? companyMap.get(workOrder.company_id) : null;
    const vendor: any = invoice.vendor_id ? vendorMap.get(invoice.vendor_id) : null;

    return {
      ...invoice,
      wo_number: workOrder?.wo_number || null,
      site_id: workOrder?.site_id || null,
      site_name: site?.site_name || null,
      site_code: site?.site_code || null,
      company_id: workOrder?.company_id || null,
      company_name: company?.company_name || null,
      company_code: company?.company_code || null,
      vendor_name: vendor?.vendor_name || null,
    };
  });
}

async function countInvoices(query: any) {
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function sumPendingItcValue(query: any) {
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).reduce((sum: number, row: any) => sum + Number(row.gst_amount || 0), 0);
}

function selectInvoiceRows(admin: ReturnType<typeof adminClient>, organizationScope: OrganizationScope) {
  return applyOrganizationScope(
    admin.from("invoices").select(
      `
        id,
        organization_id,
        work_order_id,
        vendor_id,
        invoice_number,
        invoice_date,
        taxable_amount,
        gst_rate,
        gst_amount,
        invoice_amount,
        status,
        approval_status,
        remarks,
        itc_status,
        created_by_name,
        created_by_email,
        itc_claimed_by_name,
        itc_claimed_by_email,
        itc_claimed_at,
        itc_rejected_by_name,
        itc_rejected_by_email,
        itc_rejected_at,
        itc_rejection_reason,
        created_at
      `,
      { count: "exact" },
    ),
    organizationScope,
  );
}

function baseInvoiceQuery(
  admin: ReturnType<typeof adminClient>,
  organizationScope: OrganizationScope,
  columns = "id",
  options?: { count?: "exact" | "planned" | "estimated"; head?: boolean },
) {
  const query: any = admin.from("invoices").select(columns, options);

  if (organizationScope === null) return query;
  if (organizationScope.length === 0) return null;

  return query.in("organization_id", organizationScope);
}

export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, "invoices", "view");

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
    const search = String(searchParams.get("search") || "").trim();
    const companyId = parseOptionalId(searchParams.get("company_id"));
    const siteId = parseOptionalId(searchParams.get("site_id"));
    const vendorId = parseOptionalId(searchParams.get("vendor_id"));
    const workOrderId = parseOptionalId(searchParams.get("work_order_id"));
    const itcStatus = parseOptionalId(searchParams.get("itc_status"));
    const organizationScope = await loadActorOrganizationScope(admin, auth);
    const assignments = isGlobalScope(organizationScope)
      ? { companyIds: [], siteIds: [] }
      : await loadActorAssignments(admin, auth.user.id);

    const requiresWorkOrderScope =
      assignments.companyIds.length > 0 ||
      assignments.siteIds.length > 0 ||
      companyId ||
      siteId ||
      workOrderId;
    const scopedWorkOrderIds = requiresWorkOrderScope
      ? await loadWorkOrderIdsForScope(admin, organizationScope, assignments, {
          companyId,
          siteId,
          workOrderId,
        })
      : null;

    if (requiresWorkOrderScope && scopedWorkOrderIds?.length === 0) {
      return NextResponse.json({
        rows: [],
        total: 0,
        page,
        page_size: pageSize,
        rejected_rows: [],
        rejected_total: 0,
        summary: {
          active_invoice_count: 0,
          pending_itc_count: 0,
          claimed_itc_count: 0,
          pending_itc_value: 0,
          rejected_invoice_count: 0,
        },
      });
    }

    const searchMatches = await loadSearchMatches(admin, organizationScope, assignments, search);
    const commonFilters = {
      scopedWorkOrderIds,
      vendorId,
      itcStatus,
      search,
      searchWorkOrderIds: searchMatches.workOrderIds,
      searchVendorIds: searchMatches.vendorIds,
    };

    let rowsQuery = selectInvoiceRows(admin, organizationScope);
    if (!rowsQuery) {
      return NextResponse.json({
        rows: [],
        total: 0,
        page,
        page_size: pageSize,
        rejected_rows: [],
        rejected_total: 0,
        summary: {
          active_invoice_count: 0,
          pending_itc_count: 0,
          claimed_itc_count: 0,
          pending_itc_value: 0,
          rejected_invoice_count: 0,
        },
      });
    }

    rowsQuery = applyActiveApprovalFilter(applyBaseInvoiceFilters(rowsQuery, commonFilters))
      .order("created_at", { ascending: false })
      .range(from, to);

    const { data, error, count } = await rowsQuery;
    if (error) throw error;

    const [
      rows,
      activeInvoiceCount,
      pendingItcCount,
      claimedItcCount,
      pendingItcValue,
      rejectedInvoiceCount,
      rejectedResult,
    ] = await Promise.all([
      enrichRows(admin, data || []),
      countInvoices(
        applyActiveApprovalFilter(
          applyBaseInvoiceFilters(
            baseInvoiceQuery(admin, organizationScope, "id", { count: "exact", head: true }),
            commonFilters,
          ),
        ),
      ),
      countInvoices(
        applyPendingItcFilter(
          applyActiveApprovalFilter(
            applyBaseInvoiceFilters(
              baseInvoiceQuery(admin, organizationScope, "id", { count: "exact", head: true }),
              commonFilters,
            ),
          ),
        ),
      ),
      countInvoices(
        applyActiveApprovalFilter(
          applyBaseInvoiceFilters(
            baseInvoiceQuery(admin, organizationScope, "id", { count: "exact", head: true }),
            commonFilters,
          ),
        ).ilike("itc_status", "claimed"),
      ),
      sumPendingItcValue(
        applyPendingItcFilter(
          applyActiveApprovalFilter(
            applyBaseInvoiceFilters(
              baseInvoiceQuery(admin, organizationScope, "gst_amount"),
              commonFilters,
            ),
          ),
        ),
      ),
      countInvoices(
        applyBaseInvoiceFilters(
          baseInvoiceQuery(admin, organizationScope, "id", { count: "exact", head: true }),
          commonFilters,
        ).ilike("approval_status", "rejected"),
      ),
      applyBaseInvoiceFilters(selectInvoiceRows(admin, organizationScope), commonFilters)
        .ilike("approval_status", "rejected")
        .order("created_at", { ascending: false })
        .range(0, REJECTED_PREVIEW_LIMIT - 1),
    ]);

    if (rejectedResult.error) throw rejectedResult.error;

    const rejectedRows = await enrichRows(admin, rejectedResult.data || []);

    return NextResponse.json({
      rows,
      total: count || 0,
      page,
      page_size: pageSize,
      rejected_rows: rejectedRows,
      rejected_total: rejectedInvoiceCount,
      summary: {
        active_invoice_count: activeInvoiceCount,
        pending_itc_count: pendingItcCount,
        claimed_itc_count: claimedItcCount,
        pending_itc_value: pendingItcValue,
        rejected_invoice_count: rejectedInvoiceCount,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load invoice register." },
      { status: 500 },
    );
  }
}
