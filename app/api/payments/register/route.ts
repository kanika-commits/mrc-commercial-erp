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

function applyWorkOrderScope(
  query: any,
  organizationScope: OrganizationScope,
  assignments: { companyIds: string[]; siteIds: string[] },
) {
  let next = applyOrganizationScope(query, organizationScope);
  if (!next) return null;

  if (assignments.siteIds.length > 0) {
    next = next.in("site_id", assignments.siteIds);
  } else if (assignments.companyIds.length > 0) {
    next = next.in("company_id", assignments.companyIds);
  }

  return next;
}

async function loadScopedWorkOrderIds(
  admin: ReturnType<typeof adminClient>,
  organizationScope: OrganizationScope,
  assignments: { companyIds: string[]; siteIds: string[] },
) {
  if (isGlobalScope(organizationScope) && assignments.companyIds.length === 0 && assignments.siteIds.length === 0) {
    return null;
  }

  const query = applyWorkOrderScope(
    admin.from("work_orders").select("id"),
    organizationScope,
    assignments,
  );

  if (!query) return [];

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((row: any) => row.id).filter(Boolean) as string[];
}

async function loadSearchMatches(
  admin: ReturnType<typeof adminClient>,
  organizationScope: OrganizationScope,
  assignments: { companyIds: string[]; siteIds: string[] },
  search: string,
) {
  if (!search) {
    return {
      workOrderIds: null as string[] | null,
      invoiceIds: null as string[] | null,
      vendorIds: null as string[] | null,
      accountIds: null as string[] | null,
    };
  }

  const searchPattern = `%${search}%`;

  const workOrderQuery = applyWorkOrderScope(
    admin.from("work_orders").select("id").ilike("wo_number", searchPattern),
    organizationScope,
    assignments,
  );
  const invoiceQuery = applyOrganizationScope(
    admin.from("invoices").select("id").ilike("invoice_number", searchPattern),
    organizationScope,
  );
  const vendorQuery = applyOrganizationScope(
    admin.from("vendors").select("id").ilike("vendor_name", searchPattern),
    organizationScope,
  );
  const accountQuery = applyOrganizationScope(
    admin
      .from("company_bank_accounts")
      .select("id")
      .or(`bank_name.ilike.${searchPattern},account_number.ilike.${searchPattern}`),
    organizationScope,
  );

  const [workOrders, invoices, vendors, accounts] = await Promise.all([
    workOrderQuery ? workOrderQuery : Promise.resolve({ data: [], error: null }),
    invoiceQuery ? invoiceQuery : Promise.resolve({ data: [], error: null }),
    vendorQuery ? vendorQuery : Promise.resolve({ data: [], error: null }),
    accountQuery ? accountQuery : Promise.resolve({ data: [], error: null }),
  ]);

  for (const result of [workOrders, invoices, vendors, accounts]) {
    if (result.error) throw result.error;
  }

  return {
    workOrderIds: (workOrders.data || []).map((row: any) => row.id).filter(Boolean),
    invoiceIds: (invoices.data || []).map((row: any) => row.id).filter(Boolean),
    vendorIds: (vendors.data || []).map((row: any) => row.id).filter(Boolean),
    accountIds: (accounts.data || []).map((row: any) => row.id).filter(Boolean),
  };
}

function selectPaymentRows(admin: ReturnType<typeof adminClient>, organizationScope: OrganizationScope) {
  return applyOrganizationScope(
    admin
      .from("payments")
      .select(
        `
          id,
          organization_id,
          company_id,
          work_order_id,
          invoice_id,
          vendor_id,
          company_bank_account_id,
          payment_number,
          payment_date,
          payment_type,
          reference_number,
          total_payment,
          tds_amount,
          transferred_amount,
          payment_amount,
          payment_mode,
          utr_number,
          status,
          remarks,
          created_by_name,
          created_by_email,
          created_at_user,
          created_at
        `,
        { count: "exact" },
      ),
    organizationScope,
  );
}

function applyPaymentFilters(
  query: any,
  filters: {
    companyIds: string[];
    scopedWorkOrderIds: string[] | null;
    search: string;
    searchWorkOrderIds: string[] | null;
    searchInvoiceIds: string[] | null;
    searchVendorIds: string[] | null;
    searchAccountIds: string[] | null;
  },
) {
  let next = query;

  if (filters.scopedWorkOrderIds) {
    if (filters.scopedWorkOrderIds.length === 0) {
      return null;
    }

    if (filters.companyIds.length > 0) {
      next = next.or(
        `company_id.in.(${filters.companyIds.join(",")}),work_order_id.in.(${filters.scopedWorkOrderIds.join(",")})`,
      );
    } else {
      next = next.in("work_order_id", filters.scopedWorkOrderIds);
    }
  } else if (filters.companyIds.length > 0) {
    next = next.in("company_id", filters.companyIds);
  }

  if (filters.search) {
    const clauses = [
      `payment_number.ilike.%${filters.search}%`,
      `reference_number.ilike.%${filters.search}%`,
      `utr_number.ilike.%${filters.search}%`,
    ];

    if (filters.searchWorkOrderIds?.length) {
      clauses.push(`work_order_id.in.(${filters.searchWorkOrderIds.join(",")})`);
    }
    if (filters.searchInvoiceIds?.length) {
      clauses.push(`invoice_id.in.(${filters.searchInvoiceIds.join(",")})`);
    }
    if (filters.searchVendorIds?.length) {
      clauses.push(`vendor_id.in.(${filters.searchVendorIds.join(",")})`);
    }
    if (filters.searchAccountIds?.length) {
      clauses.push(`company_bank_account_id.in.(${filters.searchAccountIds.join(",")})`);
    }

    next = next.or(clauses.join(","));
  }

  return next;
}

function accountLabel(account: any) {
  if (!account) return "-";
  const accountNumber = account.account_number ? String(account.account_number) : "";
  const last4 = accountNumber ? accountNumber.slice(-4) : "----";
  return `${account.bank_name || "Bank"} • ****${last4}`;
}

async function enrichRows(admin: ReturnType<typeof adminClient>, payments: any[]) {
  const workOrderIds = Array.from(
    new Set(payments.map((payment) => payment.work_order_id).filter(Boolean)),
  );
  const invoiceIds = Array.from(
    new Set(payments.map((payment) => payment.invoice_id).filter(Boolean)),
  );
  const vendorIds = Array.from(
    new Set(payments.map((payment) => payment.vendor_id).filter(Boolean)),
  );
  const accountIds = Array.from(
    new Set(payments.map((payment) => payment.company_bank_account_id).filter(Boolean)),
  );

  const [workOrders, invoices, vendors, accounts] = await Promise.all([
    workOrderIds.length
      ? admin.from("work_orders").select("id, wo_number, company_id, site_id").in("id", workOrderIds)
      : Promise.resolve({ data: [], error: null }),
    invoiceIds.length
      ? admin.from("invoices").select("id, invoice_number").in("id", invoiceIds)
      : Promise.resolve({ data: [], error: null }),
    vendorIds.length
      ? admin.from("vendors").select("id, vendor_name").in("id", vendorIds)
      : Promise.resolve({ data: [], error: null }),
    accountIds.length
      ? admin
          .from("company_bank_accounts")
          .select("id, bank_name, account_number")
          .in("id", accountIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  for (const result of [workOrders, invoices, vendors, accounts]) {
    if (result.error) throw result.error;
  }

  const workOrderMap = new Map((workOrders.data || []).map((row: any) => [row.id, row]));
  const invoiceMap = new Map((invoices.data || []).map((row: any) => [row.id, row]));
  const vendorMap = new Map((vendors.data || []).map((row: any) => [row.id, row.vendor_name]));
  const accountMap = new Map((accounts.data || []).map((row: any) => [row.id, row]));

  return payments.map((payment) => {
    const workOrder: any = payment.work_order_id ? workOrderMap.get(payment.work_order_id) : null;
    const invoice: any = payment.invoice_id ? invoiceMap.get(payment.invoice_id) : null;
    const vendorName = payment.vendor_id ? vendorMap.get(payment.vendor_id) : "-";
    const account = payment.company_bank_account_id
      ? accountMap.get(payment.company_bank_account_id)
      : null;

    const reference =
      payment.payment_type === "Work Order"
        ? workOrder?.wo_number || payment.reference_number || "-"
        : payment.payment_type === "Invoice"
          ? invoice?.invoice_number || payment.reference_number || "-"
          : payment.reference_number || "-";

    const party =
      payment.payment_type === "Bank Transfer" || payment.payment_type === "Internal Transfer"
        ? "Bank Transfer"
        : vendorName || "-";

    return {
      ...payment,
      wo_number: workOrder?.wo_number || null,
      invoice_number: invoice?.invoice_number || null,
      vendor_name: vendorName || null,
      account_name: accountLabel(account),
      reference,
      party,
    };
  });
}

export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, "payments", "view");

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
    const search = String(searchParams.get("search") || "").trim();
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const organizationScope = await loadActorOrganizationScope(admin, auth);
    const assignments = isGlobalScope(organizationScope)
      ? { companyIds: [], siteIds: [] }
      : await loadActorAssignments(admin, auth.user.id);
    const [scopedWorkOrderIds, searchMatches] = await Promise.all([
      loadScopedWorkOrderIds(admin, organizationScope, assignments),
      loadSearchMatches(admin, organizationScope, assignments, search),
    ]);

    let query = selectPaymentRows(admin, organizationScope);

    if (!query) {
      return NextResponse.json({ rows: [], total: 0, page, page_size: pageSize });
    }

    query = applyPaymentFilters(query, {
      companyIds: assignments.companyIds,
      scopedWorkOrderIds,
      search,
      searchWorkOrderIds: searchMatches.workOrderIds,
      searchInvoiceIds: searchMatches.invoiceIds,
      searchVendorIds: searchMatches.vendorIds,
      searchAccountIds: searchMatches.accountIds,
    });

    if (!query) {
      return NextResponse.json({ rows: [], total: 0, page, page_size: pageSize });
    }

    const { data, error, count } = await query
      .order("payment_date", { ascending: false })
      .range(from, to);

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
      { error: error.message || "Failed to load payment register." },
      { status: 500 },
    );
  }
}
