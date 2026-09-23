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
const LOOKUP_BATCH_SIZE = 50;
const FILTER_OPTIONS_PAGE_SIZE = 500;

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

function applyPaymentAccessScope(
  query: any,
  companyIds: string[],
  siteIds: string[],
  scopedWorkOrderIds: string[] | null,
) {
  let next = query;

  if (scopedWorkOrderIds) {
    const clauses: string[] = [];
    if (companyIds.length) clauses.push(`company_id.in.(${companyIds.join(",")})`);
    if (siteIds.length) clauses.push(`site_id.in.(${siteIds.join(",")})`);
    if (scopedWorkOrderIds.length) clauses.push(`work_order_id.in.(${scopedWorkOrderIds.join(",")})`);
    if (!clauses.length) return null;
    next = next.or(clauses.join(","));
  } else if (companyIds.length > 0) {
    next = next.in("company_id", companyIds);
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

async function loadAllFilterRows(
  admin: ReturnType<typeof adminClient>,
  organizationScope: OrganizationScope,
  companyIds: string[],
  siteIds: string[],
  scopedWorkOrderIds: string[] | null,
) {
  const rows: any[] = [];

  for (let offset = 0; ; offset += FILTER_OPTIONS_PAGE_SIZE) {
    let query = applyOrganizationScope(
      admin
        .from("payments")
        .select("company_id, payment_type, vendor_id, company_bank_account_id, payment_number, created_by_name, created_by_email")
        .order("payment_date", { ascending: false })
        .range(offset, offset + FILTER_OPTIONS_PAGE_SIZE - 1),
      organizationScope,
    );
    query = query && applyPaymentAccessScope(query, companyIds, siteIds, scopedWorkOrderIds);
    if (!query) return rows;

    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < FILTER_OPTIONS_PAGE_SIZE) return rows;
  }
}

async function loadRowsByIds(
  admin: ReturnType<typeof adminClient>,
  table: string,
  columns: string,
  ids: string[],
  organizationScope: OrganizationScope,
) {
  const rows: any[] = [];
  for (let index = 0; index < ids.length; index += LOOKUP_BATCH_SIZE) {
    let query = admin.from(table).select(columns).in("id", ids.slice(index, index + LOOKUP_BATCH_SIZE));
    query = applyOrganizationScope(query, organizationScope);
    if (!query) return [];
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}

function uniqueStrings(values: unknown[]) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function normalizedEmail(value: unknown) {
  return String(value || "").trim().toLocaleLowerCase();
}

async function loadCreatorProfiles(admin: ReturnType<typeof adminClient>, payments: any[]) {
  const emails = uniqueStrings(payments.map((payment) => payment.created_by_email));
  const profiles: any[] = [];
  for (let index = 0; index < emails.length; index += LOOKUP_BATCH_SIZE) {
    const { data, error } = await admin
      .from("profiles")
      .select("email, full_name")
      .in("email", emails.slice(index, index + LOOKUP_BATCH_SIZE));
    if (error) throw error;
    profiles.push(...(data || []));
  }
  return new Map(profiles.map((profile) => [normalizedEmail(profile.email), profile.full_name]));
}

async function buildFilterOptions(
  admin: ReturnType<typeof adminClient>,
  organizationScope: OrganizationScope,
  companyIds: string[],
  siteIds: string[],
  scopedWorkOrderIds: string[] | null,
) {
  const paymentRows = await loadAllFilterRows(admin, organizationScope, companyIds, siteIds, scopedWorkOrderIds);
  const [companies, vendors, accounts, creatorProfiles] = await Promise.all([
    loadRowsByIds(admin, "companies", "id, company_name", uniqueStrings(paymentRows.map((row) => row.company_id)), organizationScope),
    loadRowsByIds(admin, "vendors", "id, vendor_name", uniqueStrings(paymentRows.map((row) => row.vendor_id)), organizationScope),
    loadRowsByIds(admin, "company_bank_accounts", "id, bank_name, account_number", uniqueStrings(paymentRows.map((row) => row.company_bank_account_id)), organizationScope),
    loadCreatorProfiles(admin, paymentRows),
  ]);
  const companyNames = new Map(companies.map((row) => [row.id, row.company_name]));
  const vendorNames = new Map(vendors.map((row) => [row.id, row.vendor_name]));
  const accountsByLookupId = new Map(accounts.map((row) => [row.id, row]));
  const companiesById = new Map<string, string>();
  const partiesByValue = new Map<string, string>();
  const accountsById = new Map<string, string>();
  const creatorsByValue = new Map<string, string>();

  for (const row of paymentRows) {
    if (row.company_id) {
      companiesById.set(row.company_id, companyNames.get(row.company_id) || `Company · ${row.company_id.slice(0, 8)}`);
    }
    if (["Bank Transfer", "Internal Transfer"].includes(row.payment_type)) {
      partiesByValue.set("bank_transfer", "Bank Transfer");
    } else if (row.vendor_id && vendorNames.has(row.vendor_id)) {
      const name = vendorNames.get(row.vendor_id)!;
      partiesByValue.set(`vendor:${encodeURIComponent(name)}`, name);
    }
    if (row.company_bank_account_id) {
      accountsById.set(
        row.company_bank_account_id,
        accountLabel(accountsByLookupId.get(row.company_bank_account_id), row.payment_number),
      );
    }
    const email = String(row.created_by_email || "").trim();
    const storedName = String(row.created_by_name || "").trim();
    const profileName = email ? creatorProfiles.get(normalizedEmail(email)) : null;
    const value = email ? `email:${email}` : storedName ? `name:${storedName}` : "";
    const label = profileName || storedName || email;
    if (value && label) creatorsByValue.set(value, label);
  }

  const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
  return {
    companies: Array.from(companiesById, ([value, label]) => ({ value, label })).sort(byLabel),
    paymentTypes: uniqueStrings(paymentRows.map((row) => row.payment_type)).sort((a, b) => a.localeCompare(b)),
    parties: Array.from(partiesByValue, ([value, label]) => ({ value, label })).sort(byLabel),
    accounts: Array.from(accountsById, ([value, label]) => ({ value, label })).sort(byLabel),
    creators: Array.from(creatorsByValue, ([value, label]) => ({ value, label })).sort(byLabel),
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
          site_id,
          purchase_order_id,
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
    siteIds: string[];
    scopedWorkOrderIds: string[] | null;
    search: string;
    searchWorkOrderIds: string[] | null;
    searchInvoiceIds: string[] | null;
    searchVendorIds: string[] | null;
    searchAccountIds: string[] | null;
    companyId: string;
    paymentType: string;
    vendorIds: string[] | null;
    bankTransfer: boolean;
    accountId: string;
    dateFrom: string;
    dateTo: string;
    createdBy: string;
  },
) {
  let next = applyPaymentAccessScope(query, filters.companyIds, filters.siteIds, filters.scopedWorkOrderIds);
  if (!next) return null;

  if (filters.companyId) next = next.eq("company_id", filters.companyId);
  if (filters.paymentType) next = next.eq("payment_type", filters.paymentType);
  if (filters.bankTransfer) next = next.in("payment_type", ["Bank Transfer", "Internal Transfer"]);
  if (filters.vendorIds) {
    if (filters.vendorIds.length === 0) return null;
    next = next.in("vendor_id", filters.vendorIds);
  }
  if (filters.accountId) next = next.eq("company_bank_account_id", filters.accountId);
  if (filters.dateFrom) next = next.gte("payment_date", filters.dateFrom);
  if (filters.dateTo) next = next.lte("payment_date", filters.dateTo);
  if (filters.createdBy.startsWith("email:")) {
    next = next.eq("created_by_email", filters.createdBy.slice("email:".length));
  } else if (filters.createdBy.startsWith("name:")) {
    next = next.eq("created_by_name", filters.createdBy.slice("name:".length));
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

function accountLabel(account: any, paymentNumber?: string | null) {
  if (!account) {
    return String(paymentNumber || "").startsWith("HIST-PAY-")
      ? "Historical account not available"
      : "Account not recorded";
  }
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
  const siteIds = Array.from(
    new Set(payments.map((payment) => payment.site_id).filter(Boolean)),
  );
  const purchaseOrderIds = Array.from(
    new Set(payments.map((payment) => payment.purchase_order_id).filter(Boolean)),
  );
  const accountIds = Array.from(
    new Set(payments.map((payment) => payment.company_bank_account_id).filter(Boolean)),
  );

  const [workOrders, invoices, vendors, sites, purchaseOrders, accounts, creatorProfiles] = await Promise.all([
    workOrderIds.length
      ? admin.from("work_orders").select("id, wo_number, company_id, site_id").in("id", workOrderIds)
      : Promise.resolve({ data: [], error: null }),
    invoiceIds.length
      ? admin.from("invoices").select("id, invoice_number").in("id", invoiceIds)
      : Promise.resolve({ data: [], error: null }),
    vendorIds.length
      ? admin.from("vendors").select("id, vendor_name").in("id", vendorIds)
      : Promise.resolve({ data: [], error: null }),
    siteIds.length
      ? admin.from("sites").select("id,site_name,site_code").in("id", siteIds)
      : Promise.resolve({ data: [], error: null }),
    purchaseOrderIds.length
      ? admin.from("procurement_purchase_orders").select("id,po_number").in("id", purchaseOrderIds)
      : Promise.resolve({ data: [], error: null }),
    accountIds.length
      ? admin
          .from("company_bank_accounts")
          .select("id, bank_name, account_number")
          .in("id", accountIds)
      : Promise.resolve({ data: [], error: null }),
    loadCreatorProfiles(admin, payments),
  ]);

  for (const result of [workOrders, invoices, vendors, sites, purchaseOrders, accounts]) {
    if (result.error) throw result.error;
  }

  const workOrderMap = new Map((workOrders.data || []).map((row: any) => [row.id, row]));
  const invoiceMap = new Map((invoices.data || []).map((row: any) => [row.id, row]));
  const vendorMap = new Map((vendors.data || []).map((row: any) => [row.id, row.vendor_name]));
  const siteMap = new Map((sites.data || []).map((row: any) => [row.id, row]));
  const purchaseOrderMap = new Map((purchaseOrders.data || []).map((row: any) => [row.id, row]));
  const accountMap = new Map((accounts.data || []).map((row: any) => [row.id, row]));

  return payments.map((payment) => {
    const workOrder: any = payment.work_order_id ? workOrderMap.get(payment.work_order_id) : null;
    const invoice: any = payment.invoice_id ? invoiceMap.get(payment.invoice_id) : null;
    const vendorName = payment.vendor_id ? vendorMap.get(payment.vendor_id) : "-";
    const account = payment.company_bank_account_id
      ? accountMap.get(payment.company_bank_account_id)
      : null;
    const site: any = payment.site_id ? siteMap.get(payment.site_id) : null;
    const purchaseOrder: any = payment.purchase_order_id ? purchaseOrderMap.get(payment.purchase_order_id) : null;

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
      site_name: site?.site_name || null,
      site_code: site?.site_code || null,
      purchase_order_number: purchaseOrder?.po_number || null,
      purchase_order_source: payment.payment_type === "Purchase Order"
        ? payment.purchase_order_id ? "SiteQube PO" : "Manual / Old PO"
        : null,
      account_name: accountLabel(account, payment.payment_number),
      reference,
      party,
      created_by_display:
        creatorProfiles.get(normalizedEmail(payment.created_by_email)) ||
        String(payment.created_by_name || "").trim() ||
        String(payment.created_by_email || "").trim() ||
        "-",
      created_by_filter_value: payment.created_by_email
        ? `email:${String(payment.created_by_email).trim()}`
        : payment.created_by_name
          ? `name:${String(payment.created_by_name).trim()}`
          : "",
    };
  });
}

async function loadVendorIdsForParty(
  admin: ReturnType<typeof adminClient>,
  partyValue: string,
  organizationScope: OrganizationScope,
) {
  if (!partyValue.startsWith("vendor:")) return null;
  let vendorName = "";
  try {
    vendorName = decodeURIComponent(partyValue.slice("vendor:".length));
  } catch {
    return [];
  }
  const query = applyOrganizationScope(
    admin.from("vendors").select("id").eq("vendor_name", vendorName),
    organizationScope,
  );
  if (!query) return [];
  const { data, error } = await query;
  if (error) throw error;
  return uniqueStrings((data || []).map((row: any) => row.id));
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
    const companyId = String(searchParams.get("company_id") || "").trim();
    const paymentType = String(searchParams.get("payment_type") || "").trim();
    const party = String(searchParams.get("party") || "").trim();
    const accountId = String(searchParams.get("from_account") || "").trim();
    const dateFrom = String(searchParams.get("date_from") || "").trim();
    const dateTo = String(searchParams.get("date_to") || "").trim();
    const createdBy = String(searchParams.get("created_by") || "").trim();
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
    const filterOptions = await buildFilterOptions(
      admin,
      organizationScope,
      assignments.companyIds,
      assignments.siteIds,
      scopedWorkOrderIds,
    );
    const vendorIds = await loadVendorIdsForParty(admin, party, organizationScope);

    let query = selectPaymentRows(admin, organizationScope);

    if (!query) {
      return NextResponse.json({ rows: [], total: 0, page, page_size: pageSize, filter_options: filterOptions });
    }

    query = applyPaymentFilters(query, {
      companyIds: assignments.companyIds,
      siteIds: assignments.siteIds,
      scopedWorkOrderIds,
      search,
      searchWorkOrderIds: searchMatches.workOrderIds,
      searchInvoiceIds: searchMatches.invoiceIds,
      searchVendorIds: searchMatches.vendorIds,
      searchAccountIds: searchMatches.accountIds,
      companyId,
      paymentType,
      vendorIds,
      bankTransfer: party === "bank_transfer",
      accountId,
      dateFrom,
      dateTo,
      createdBy,
    });

    if (!query) {
      return NextResponse.json({ rows: [], total: 0, page, page_size: pageSize, filter_options: filterOptions });
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
      filter_options: filterOptions,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load payment register." },
      { status: 500 },
    );
  }
}
