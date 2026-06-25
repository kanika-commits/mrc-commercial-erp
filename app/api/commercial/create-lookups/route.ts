import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAnyPermission } from "@/lib/serverPermissions";
import {
  isInOrganizationScope,
  loadActorOrganizationScope,
} from "@/lib/serverOrganizationScope";

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
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

function isRecordInActorScope(
  record: any,
  organizationScope: string[] | null,
  assignments: { companyIds: string[]; siteIds: string[] },
) {
  if (!isInOrganizationScope(organizationScope, record?.organization_id)) {
    return false;
  }

  if (assignments.siteIds.length > 0) {
    return assignments.siteIds.includes(record.site_id);
  }

  if (assignments.companyIds.length > 0) {
    return assignments.companyIds.includes(record.company_id);
  }

  return true;
}

function applyScopeToQuery(query: any, organizationScope: string[] | null) {
  if (organizationScope === null) return query;
  if (organizationScope.length === 0) return null;
  return query.in("organization_id", organizationScope);
}

async function loadScopedWorkOrders(
  admin: ReturnType<typeof adminClient>,
  organizationScope: string[] | null,
  assignments: { companyIds: string[]; siteIds: string[] },
) {
  let query = admin
    .from("work_orders")
    .select(
      `
        id,
        wo_number,
        wo_date,
        wo_value,
        company_id,
        site_id,
        organization_id,
        companies (
          id,
          company_name,
          company_code
        ),
        sites (
          id,
          site_name,
          site_code
        )
      `,
    )
    .in("approval_status", ["Pending", "pending", "Approved", "approved"])
    .eq("status", "active")
    .order("wo_number");

  query = applyScopeToQuery(query, organizationScope);
  if (!query) return [];

  if (assignments.siteIds.length > 0) {
    query = query.in("site_id", assignments.siteIds);
  } else if (assignments.companyIds.length > 0) {
    query = query.in("company_id", assignments.companyIds);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadScopedSites(
  admin: ReturnType<typeof adminClient>,
  organizationScope: string[] | null,
  assignments: { companyIds: string[]; siteIds: string[] },
) {
  let query = admin
    .from("sites")
    .select("id, site_name, site_code, company_id, organization_id")
    .eq("status", "active")
    .order("site_name");

  query = applyScopeToQuery(query, organizationScope);
  if (!query) return [];

  if (assignments.siteIds.length > 0) {
    query = query.in("id", assignments.siteIds);
  } else if (assignments.companyIds.length > 0) {
    query = query.in("company_id", assignments.companyIds);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadScopedCompanies(
  admin: ReturnType<typeof adminClient>,
  organizationScope: string[] | null,
  assignments: { companyIds: string[]; siteIds: string[] },
  scopedSites: any[],
) {
  let query = admin
    .from("companies")
    .select("id, company_name, company_code, organization_id")
    .eq("status", "active")
    .order("company_name");

  query = applyScopeToQuery(query, organizationScope);
  if (!query) return [];

  if (assignments.siteIds.length > 0) {
    const companyIds = Array.from(
      new Set(scopedSites.map((site) => site.company_id).filter(Boolean)),
    );
    if (companyIds.length === 0) return [];
    query = query.in("id", companyIds);
  } else if (assignments.companyIds.length > 0) {
    query = query.in("id", assignments.companyIds);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function assertWorkOrderAccess(
  admin: ReturnType<typeof adminClient>,
  workOrderId: string,
  organizationScope: string[] | null,
  assignments: { companyIds: string[]; siteIds: string[] },
) {
  const { data: workOrder, error } = await admin
    .from("work_orders")
    .select("id, organization_id, company_id, site_id")
    .eq("id", workOrderId)
    .maybeSingle();

  if (error) throw error;
  if (!workOrder) {
    return { error: "Work Order was not found.", status: 404 } as const;
  }

  if (!isRecordInActorScope(workOrder, organizationScope, assignments)) {
    return { error: "You do not have access to this Work Order.", status: 403 } as const;
  }

  return { workOrder } as const;
}

export async function GET(request: Request) {
  try {
    const auth = await requireAnyPermission(request, [
      { moduleCode: "ra_bills", actionCode: "add" },
      { moduleCode: "invoices", actionCode: "add" },
      { moduleCode: "payments", actionCode: "add" },
      { moduleCode: "debit_notes", actionCode: "add" },
      { moduleCode: "work_orders", actionCode: "view" },
    ]);

    if ("response" in auth) return auth.response;

    const { searchParams } = new URL(request.url);
    const resource = searchParams.get("resource") || "initial";
    const workOrderId = searchParams.get("work_order_id")?.trim() || "";

    const admin = adminClient();
    const [organizationScope, assignments] = await Promise.all([
      loadActorOrganizationScope(admin, auth),
      loadActorAssignments(admin, auth.user.id),
    ]);

    if (resource === "ra_history") {
      if (!workOrderId) {
        return NextResponse.json({ error: "work_order_id is required." }, { status: 400 });
      }

      const access = await assertWorkOrderAccess(
        admin,
        workOrderId,
        organizationScope,
        assignments,
      );

      if ("error" in access) {
        return NextResponse.json({ error: access.error }, { status: access.status });
      }

      const { data, error } = await admin
        .from("ra_bills")
        .select(
          `
            id,
            ra_number,
            ra_date,
            gross_amount,
            recovery_amount,
            gst_amount,
            net_amount,
            status,
            approval_status,
            rejection_reason,
            created_at
          `,
        )
        .eq("work_order_id", workOrderId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return NextResponse.json({ ra_bills: data || [] });
    }

    if (resource === "invoice_history") {
      if (!workOrderId) {
        return NextResponse.json({ error: "work_order_id is required." }, { status: 400 });
      }

      const access = await assertWorkOrderAccess(
        admin,
        workOrderId,
        organizationScope,
        assignments,
      );

      if ("error" in access) {
        return NextResponse.json({ error: access.error }, { status: access.status });
      }

      const { data, error } = await admin
        .from("invoices")
        .select(
          `
            id,
            invoice_number,
            invoice_date,
            taxable_amount,
            gst_amount,
            invoice_amount,
            itc_status,
            created_at
          `,
        )
        .eq("work_order_id", workOrderId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return NextResponse.json({ invoices: data || [] });
    }

    const sites = await loadScopedSites(admin, organizationScope, assignments);
    const [companies, workOrders] = await Promise.all([
      loadScopedCompanies(admin, organizationScope, assignments, sites),
      loadScopedWorkOrders(admin, organizationScope, assignments),
    ]);

    const workOrderIds = workOrders.map((workOrder) => workOrder.id).filter(Boolean);

    const { data: invoices, error: invoicesError } = workOrderIds.length
      ? await admin
          .from("invoices")
          .select("id, invoice_number, work_order_id, vendor_id, invoice_amount, itc_status")
          .in("work_order_id", workOrderIds)
          .ilike("itc_status", "claimed")
          .order("invoice_number")
      : { data: [], error: null };

    if (invoicesError) throw invoicesError;

    const invoiceVendorIds = Array.from(
      new Set((invoices || []).map((invoice) => invoice.vendor_id).filter(Boolean)),
    );

    const { data: invoiceVendors, error: invoiceVendorsError } = invoiceVendorIds.length
      ? await admin.from("vendors").select("id, vendor_name").in("id", invoiceVendorIds)
      : { data: [], error: null };

    if (invoiceVendorsError) throw invoiceVendorsError;

    let vendorQuery = admin
      .from("vendors")
      .select("id, vendor_name, organization_id")
      .eq("status", "active")
      .order("vendor_name");

    vendorQuery = applyScopeToQuery(vendorQuery, organizationScope);
    const { data: purchaseOrderVendors, error: purchaseOrderVendorError } = vendorQuery
      ? await vendorQuery
      : { data: [], error: null };

    if (purchaseOrderVendorError) throw purchaseOrderVendorError;

    return NextResponse.json({
      companies,
      sites,
      work_orders: workOrders,
      invoices: invoices || [],
      vendors: invoiceVendors || [],
      purchase_order_vendors: purchaseOrderVendors || [],
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load commercial form lookups." },
      { status: 500 },
    );
  }
}
