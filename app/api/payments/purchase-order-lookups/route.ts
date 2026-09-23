import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";
import { isInOrganizationScope, loadActorOrganizationScope } from "@/lib/serverOrganizationScope";
import { selectEffectivePayablePurchaseOrders } from "@/lib/payments/purchaseOrderPayment";

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(supabaseUrl, serviceRoleKey);
}

async function loadActorAssignments(admin: ReturnType<typeof adminClient>, userId: string) {
  const { data, error } = await admin
    .from("user_access_assignments")
    .select("company_id,site_id")
    .eq("user_id", userId);
  if (error) throw error;
  return {
    companyIds: [...new Set((data || []).map((row: any) => row.company_id).filter(Boolean))] as string[],
    siteIds: [...new Set((data || []).map((row: any) => row.site_id).filter(Boolean))] as string[],
  };
}

export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, "payments", "add");
    if ("response" in auth) return auth.response;

    const admin = adminClient();
    const [organizationScope, assignments] = await Promise.all([
      loadActorOrganizationScope(admin, auth),
      loadActorAssignments(admin, auth.user.id),
    ]);

    let companiesQuery: any = admin
      .from("companies")
      .select("id,organization_id,company_name,company_code")
      .eq("status", "active")
      .order("company_name");
    if (organizationScope !== null) {
      if (organizationScope.length === 0) return NextResponse.json({ companies: [], sites: [], purchase_orders: [] });
      companiesQuery = companiesQuery.in("organization_id", organizationScope);
    }
    if (assignments.companyIds.length) companiesQuery = companiesQuery.in("id", assignments.companyIds);

    // Sites are an organization-wide dimension: site assignments may narrow this list,
    // but company_id on sites is deliberately not used as an ownership/filter rule.
    let sitesQuery: any = admin
      .from("sites")
      .select("id,organization_id,site_name,site_code,status")
      .eq("status", "active")
      .order("site_name");
    if (organizationScope !== null) sitesQuery = sitesQuery.in("organization_id", organizationScope);
    if (assignments.siteIds.length) sitesQuery = sitesQuery.in("id", assignments.siteIds);

    const [companiesResult, sitesResult] = await Promise.all([companiesQuery, sitesQuery]);
    if (companiesResult.error) throw companiesResult.error;
    if (sitesResult.error) throw sitesResult.error;
    const companies = companiesResult.data || [];
    const sites = sitesResult.data || [];

    const companyIds = new Set(companies.map((row: any) => row.id));
    const siteIds = new Set(sites.map((row: any) => row.id));
    const allowedOrganizationIds = new Set(companies.map((row: any) => row.organization_id));
    let purchaseOrders: any[] = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      let query: any = admin
        .from("procurement_purchase_orders")
        .select("id,organization_id,company_id,site_id,vendor_id,po_number,vendor_name_snapshot,status,revision_family_id,revision_no,superseded_by_revision_id,created_at")
        .in("status", ["approved", "issued"])
        .is("superseded_by_revision_id", null)
        .order("revision_no", { ascending: false })
        .order("created_at", { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (organizationScope !== null) query = query.in("organization_id", organizationScope);
      const { data, error } = await query;
      if (error) throw error;
      purchaseOrders.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }

    const effective = selectEffectivePayablePurchaseOrders(purchaseOrders).filter((po) =>
      isInOrganizationScope(organizationScope, po.organization_id) &&
      companyIds.has(po.company_id) &&
      siteIds.has(po.site_id) &&
      allowedOrganizationIds.has(po.organization_id)
    );

    const vendorIds = [...new Set(effective.map((po) => po.vendor_id).filter(Boolean))] as string[];
    const effectiveSiteIds = [...new Set(effective.map((po) => po.site_id).filter(Boolean))] as string[];
    const [vendorsResult, poSitesResult] = await Promise.all([
      vendorIds.length
        ? admin.from("vendors").select("id,organization_id,vendor_name").in("id", vendorIds)
        : Promise.resolve({ data: [], error: null }),
      effectiveSiteIds.length
        ? admin.from("sites").select("id,organization_id,site_name,site_code,status").in("id", effectiveSiteIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (vendorsResult.error) throw vendorsResult.error;
    if (poSitesResult.error) throw poSitesResult.error;
    const vendorMap = new Map((vendorsResult.data || []).map((row: any) => [row.id, row]));
    const siteMap = new Map((poSitesResult.data || []).map((row: any) => [row.id, row]));
    const companyMap = new Map(companies.map((row: any) => [row.id, row]));

    const selectablePurchaseOrders = effective.flatMap((po) => {
      const vendor: any = vendorMap.get(po.vendor_id);
      const site: any = siteMap.get(po.site_id);
      const company: any = companyMap.get(po.company_id);
      if (!vendor || vendor.organization_id !== po.organization_id || !site || site.organization_id !== po.organization_id || !company) return [];
      return [{
        id: po.id,
        organization_id: po.organization_id,
        company_id: po.company_id,
        site_id: po.site_id,
        vendor_id: po.vendor_id,
        po_number: po.po_number,
        vendor_name: vendor.vendor_name || po.vendor_name_snapshot || "",
        site_name: site.site_name || "",
        site_code: site.site_code || "",
        company_name: company.company_name || "",
        status: po.status,
        revision_family_id: po.revision_family_id || po.id,
        revision_no: po.revision_no || 0,
      }];
    });

    return NextResponse.json({ companies, sites, purchase_orders: selectablePurchaseOrders });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load Purchase Order payment lookups." }, { status: 500 });
  }
}
