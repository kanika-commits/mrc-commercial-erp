import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/auditEvent";
import { adminClient, actorFields, applyOrganizationAccess, createActorFields, ITEM_MODULE, jsonError, requireProcurementPermission, text } from "@/lib/serverProcurementAccess";

async function validateSiteItem(admin: any, auth: any, siteId: string, itemId: string) {
  const [siteResult, itemResult] = await Promise.all([
    admin.from("sites").select("id, organization_id, site_name, status").eq("id", siteId).maybeSingle(),
    admin.from("procurement_items").select("id, organization_id, item_code, item_name, status").eq("id", itemId).maybeSingle(),
  ]);
  if (siteResult.error) throw siteResult.error;
  if (itemResult.error) throw itemResult.error;
  const site = siteResult.data;
  const item = itemResult.data;
  if (!site || site.status === "deleted") return { error: "Selected Site was not found.", status: 404 } as const;
  if (!item || item.status === "deleted") return { error: "Selected Item was not found.", status: 404 } as const;
  if (site.organization_id !== item.organization_id) return { error: "Site and Item must belong to the same organization.", status: 400 } as const;
  if (!auth.isGlobalAccess && !(auth.roleCodes || []).includes("platform_owner")) {
    if (!(auth.organizations || []).includes(site.organization_id)) return { error: "Selected Site is outside your organization access.", status: 403 } as const;
    if ((auth.sites || []).length > 0 && !(auth.sites || []).includes(siteId)) return { error: "Selected Site is outside your access.", status: 403 } as const;
  }
  return { site, item, organizationId: site.organization_id } as const;
}

export async function GET(request: Request) {
  try {
    const auth = await requireProcurementPermission(request, ITEM_MODULE, "view");
    if ("response" in auth) return auth.response;
    const { searchParams } = new URL(request.url);
    const admin = adminClient();
    let query = applyOrganizationAccess(admin.from("procurement_site_item_approved_makes").select("*, site:sites(id, site_name, site_code), item:procurement_items(id, item_code, item_name)").neq("status", "deleted").order("sort_order").order("make_name"), auth);
    if (!query) return NextResponse.json({ approved_makes: [] });
    const siteId = text(searchParams.get("site_id"));
    const itemId = text(searchParams.get("item_id"));
    const status = text(searchParams.get("status"));
    const search = text(searchParams.get("search")).toLowerCase();
    if (siteId && siteId !== "all") query = query.eq("site_id", siteId);
    if (itemId && itemId !== "all") query = query.eq("item_id", itemId);
    if (status && status !== "all") query = query.eq("status", status);
    const { data, error } = await query;
    if (error) throw error;
    const scoped = (data || []).filter((row: any) => auth.isGlobalAccess || (auth.roleCodes || []).includes("platform_owner") || (auth.sites || []).length === 0 || (auth.sites || []).includes(row.site_id));
    const rows = scoped.filter((row: any) => !search || [row.make_name, row.site?.site_name, row.item?.item_code, row.item?.item_name].join(" ").toLowerCase().includes(search));
    return NextResponse.json({ approved_makes: rows });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load approved makes." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireProcurementPermission(request, ITEM_MODULE, "edit");
    if ("response" in auth) return auth.response;
    const payload = await request.json().catch(() => ({}));
    const siteId = text(payload.site_id);
    const itemId = text(payload.item_id);
    const makeName = text(payload.make_name);
    if (!siteId) return jsonError("Site is required.", 400);
    if (!itemId) return jsonError("Item is required.", 400);
    if (!makeName) return jsonError("Make name is required.", 400);
    const admin = adminClient();
    const scope = await validateSiteItem(admin, auth, siteId, itemId);
    if ("error" in scope) return jsonError(scope.error || "Invalid Site/Item.", scope.status || 400);
    const insertPayload = { organization_id: scope.organizationId, site_id: siteId, item_id: itemId, make_name: makeName, status: text(payload.status) || "active", sort_order: Number(payload.sort_order) || 0, remarks: text(payload.remarks) || null, ...createActorFields(auth.user) };
    const { data, error } = await admin.from("procurement_site_item_approved_makes").insert(insertPayload).select("id, make_name").single();
    if (error) {
      if (String(error.message || "").toLowerCase().includes("duplicate")) return jsonError("This make already exists for the selected Site and Item.", 409);
      throw error;
    }
    try { await recordAuditEvent(admin, auth.user, { organizationId: scope.organizationId, siteId, moduleCode: ITEM_MODULE, entityType: "procurement_site_item_approved_make", recordId: data.id, recordNumber: makeName, action: "create", actionCategory: "create", activityLabel: "Added Site Approved Make", description: `Added approved make ${makeName} for ${scope.item.item_code}.`, newValues: insertPayload }, request); } catch (auditError) { console.error("[Procurement Audit] Approved make create audit failed", auditError); }
    return NextResponse.json({ approved_make: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to save approved make." }, { status: 500 });
  }
}
