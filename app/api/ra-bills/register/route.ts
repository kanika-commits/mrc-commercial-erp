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
      new Set((data || []).map((row) => row.company_id).filter(Boolean))
    ) as string[],
    siteIds: Array.from(
      new Set((data || []).map((row) => row.site_id).filter(Boolean))
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
  let query = admin
    .from("work_orders")
    .select("id")
    .order("created_at", { ascending: false });

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
    admin
      .from("work_orders")
      .select("id")
      .ilike("wo_number", searchPattern),
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

  const [workOrderSearch, companySearch, siteSearch, vendorSearch] =
    await Promise.all([
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
      if (companyIds.length > 0) {
        clauses.push(`company_id.in.(${companyIds.join(",")})`);
      }
      if (siteIds.length > 0) {
        clauses.push(`site_id.in.(${siteIds.join(",")})`);
      }
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

function applyRaBillSearch(
  query: any,
  search: string,
  workOrderIds: string[] | null,
  vendorIds: string[] | null,
) {
  if (!search) return query;

  const clauses = [`ra_number.ilike.%${search}%`];
  if (workOrderIds && workOrderIds.length > 0) {
    clauses.push(`work_order_id.in.(${workOrderIds.join(",")})`);
  }
  if (vendorIds && vendorIds.length > 0) {
    clauses.push(`vendor_id.in.(${vendorIds.join(",")})`);
  }

  return query.or(clauses.join(","));
}

async function enrichRows(admin: ReturnType<typeof adminClient>, bills: any[]) {
  const workOrderIds = Array.from(
    new Set(bills.map((bill) => bill.work_order_id).filter(Boolean)),
  );
  const vendorIds = Array.from(
    new Set(bills.map((bill) => bill.vendor_id).filter(Boolean)),
  );

  const [{ data: workOrders, error: workOrderError }, { data: vendors, error: vendorError }] =
    await Promise.all([
      workOrderIds.length
        ? admin
            .from("work_orders")
            .select("id, wo_number, site_id, company_id")
            .in("id", workOrderIds)
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
        ? admin
            .from("companies")
            .select("id, company_name, company_code")
            .in("id", companyIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (siteError) throw siteError;
  if (companyError) throw companyError;

  const workOrderMap = new Map((workOrders || []).map((row: any) => [row.id, row]));
  const vendorMap = new Map((vendors || []).map((row: any) => [row.id, row]));
  const siteMap = new Map((sites || []).map((row: any) => [row.id, row]));
  const companyMap = new Map((companies || []).map((row: any) => [row.id, row]));

  return bills.map((bill) => {
    const workOrder: any = bill.work_order_id ? workOrderMap.get(bill.work_order_id) : null;
    const site: any = workOrder?.site_id ? siteMap.get(workOrder.site_id) : null;
    const company: any = workOrder?.company_id ? companyMap.get(workOrder.company_id) : null;
    const vendor: any = bill.vendor_id ? vendorMap.get(bill.vendor_id) : null;

    return {
      ...bill,
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

export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, "ra_bills", "view");

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
      });
    }

    const searchMatches = await loadSearchMatches(
      admin,
      organizationScope,
      assignments,
      search,
    );

    let query = applyOrganizationScope(
      admin
        .from("ra_bills")
        .select(
          `
            id,
            organization_id,
            work_order_id,
            vendor_id,
            ra_number,
            ra_date,
            gross_amount,
            recovery_amount,
            retention_amount,
            gst_amount,
            net_amount,
            status,
            approval_status,
            created_by_name,
            created_by_email,
            approved_by_name,
            approved_by_email,
            approved_at,
            created_at
          `,
          { count: "exact" },
        )
        .ilike("approval_status", "approved"),
      organizationScope,
    );

    if (!query) {
      return NextResponse.json({
        rows: [],
        total: 0,
        page,
        page_size: pageSize,
      });
    }

    if (scopedWorkOrderIds) query = query.in("work_order_id", scopedWorkOrderIds);
    if (vendorId) query = query.eq("vendor_id", vendorId);
    query = applyRaBillSearch(query, search, searchMatches.workOrderIds, searchMatches.vendorIds);
    query = query.order("created_at", { ascending: false }).range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;

    const rows = await enrichRows(admin, data || []);

    return NextResponse.json({
      rows,
      total: count || 0,
      page,
      page_size: pageSize,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load RA Bills register." },
      { status: 500 },
    );
  }
}
