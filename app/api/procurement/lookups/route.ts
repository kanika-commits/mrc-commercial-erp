import { NextResponse } from "next/server";
import { adminClient, applyOrganizationAccess, APPROVAL_MODULE, ITEM_MODULE, REQUISITION_MODULE, requireProcurementAny } from "@/lib/serverProcurementAccess";

export async function GET(request: Request) {
  try {
    const auth = await requireProcurementAny(request, [
      { moduleCode: ITEM_MODULE, actionCode: "view" },
      { moduleCode: REQUISITION_MODULE, actionCode: "view" },
      { moduleCode: REQUISITION_MODULE, actionCode: "add" },
      { moduleCode: APPROVAL_MODULE, actionCode: "view" },
    ]);
    if ("response" in auth) return auth.response;
    const admin = adminClient();
    let companiesQuery = applyOrganizationAccess(admin.from("companies").select("id, organization_id, company_name, company_code, status").neq("status", "deleted").order("company_name"), auth);
    let sitesQuery = applyOrganizationAccess(admin.from("sites").select("id, organization_id, company_id, site_name, site_code, status").neq("status", "deleted").order("site_name"), auth);
    const itemsQuery = applyOrganizationAccess(admin.from("procurement_items").select("id, organization_id, item_code, item_name, item_type_id, item_group_id, item_category, default_uom_id, description, hsn_sac, status, item_type:procurement_item_types(id, type_code, type_name), item_group:procurement_item_groups(id, group_code, group_name)").neq("status", "deleted").order("item_name"), auth);
    const uomsQuery = applyOrganizationAccess(admin.from("procurement_uoms").select("id, organization_id, uom_code, uom_name, status, sort_order").neq("status", "deleted").order("sort_order"), auth);
    const typesQuery = applyOrganizationAccess(admin.from("procurement_item_types").select("id, organization_id, type_code, type_name, status, sort_order").neq("status", "deleted").order("sort_order"), auth);
    const groupsQuery = applyOrganizationAccess(admin.from("procurement_item_groups").select("id, organization_id, item_type_id, group_code, group_name, status, sort_order").neq("status", "deleted").order("sort_order"), auth);
    if (!companiesQuery || !sitesQuery || !itemsQuery || !uomsQuery || !typesQuery || !groupsQuery) return NextResponse.json({ companies: [], sites: [], items: [], uoms: [], item_types: [], item_groups: [] });
    if (!auth.isGlobalAccess && !(auth.roleCodes || []).includes("platform_owner")) {
      if ((auth.companies || []).length > 0) companiesQuery = companiesQuery.in("id", auth.companies);
      if ((auth.sites || []).length > 0) sitesQuery = sitesQuery.in("id", auth.sites);
    }
    const [companies, sites, items, uoms, itemTypes, itemGroups] = await Promise.all([companiesQuery, sitesQuery, itemsQuery, uomsQuery, typesQuery, groupsQuery]);
    for (const result of [companies, sites, items, uoms, itemTypes, itemGroups]) if (result.error) throw result.error;
    return NextResponse.json({ companies: companies.data || [], sites: sites.data || [], items: items.data || [], uoms: uoms.data || [], item_types: itemTypes.data || [], item_groups: itemGroups.data || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load procurement lookups." }, { status: 500 });
  }
}
