import { NextResponse } from "next/server";
import { adminClient, applyCompanySiteAccess, applyOrganizationAccess, jsonError, requireProcurementAny, requireProcurementPermission } from "@/lib/serverProcurementAccess";

const MODULE = "procurement_inventory";

export async function GET(request: Request) {
  try {
    const access = await requireProcurementAny(request, [{ moduleCode: MODULE, actionCode: "view" }, { moduleCode: MODULE, actionCode: "add" }]);
    if ("response" in access) return access.response;
    const url = new URL(request.url);
    const search = url.searchParams.get("search")?.trim() || "";
    const status = url.searchParams.get("status") || "all";
    const companyId = url.searchParams.get("company_id") || "all";
    const siteId = url.searchParams.get("site_id") || "all";
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get("page_size") || 25)));
    let query: any = applyOrganizationAccess(adminClient().from("procurement_inventory_balances").select("*", { count: "exact" }).order("item_name_snapshot").range((page - 1) * pageSize, page * pageSize - 1), access);
    query = query && applyCompanySiteAccess(query, access);
    if (!query) return NextResponse.json({ balances: [], total: 0, page, page_size: pageSize });
    if (status === "in_stock") query = query.gt("quantity_on_hand", 0);
    if (status === "empty") query = query.eq("quantity_on_hand", 0);
    if (companyId !== "all") query = query.eq("company_id", companyId);
    if (siteId !== "all") query = query.eq("site_id", siteId);
    if (search) query = query.or(`item_name_snapshot.ilike.%${search}%,item_code_snapshot.ilike.%${search}%,make_snapshot.ilike.%${search}%,specification_snapshot.ilike.%${search}%`);
    const { data, error, count } = await query;
    if (error) throw error;
    return NextResponse.json({ balances: data || [], total: count || 0, page, page_size: pageSize });
  } catch (error: any) { return jsonError(error.message || "Failed to load Inventory.", 500); }
}

export async function POST(request: Request) {
  try {
    const access = await requireProcurementPermission(request, MODULE, "add");
    if ("response" in access) return access.response;
    const body = await request.json();
    if (!body.company_id || !body.site_id || !body.issued_to || !body.purpose || !Array.isArray(body.items) || body.items.length === 0) return jsonError("Company, site, issue recipient, purpose and at least one item are required.", 400);
    const admin = adminClient();
    let scope: any = applyOrganizationAccess(admin.from("procurement_inventory_balances").select("*").in("id", body.items.map((item: any) => item.balance_id)), access);
    scope = scope && applyCompanySiteAccess(scope, access);
    const { data: balances, error: balanceError } = scope ? await scope : { data: [], error: null };
    if (balanceError) throw balanceError;
    const byId = new Map((balances || []).map((row: any) => [row.id, row]));
    if (byId.size !== body.items.length) return jsonError("One or more inventory items are outside your access scope.", 403);
    const first = balances![0];
    if (balances!.some((row: any) => row.company_id !== body.company_id || row.site_id !== body.site_id)) return jsonError("All issue items must belong to the selected company and site.", 400);
    const issueDate = body.issue_date || new Date().toISOString().slice(0, 10);
    const number = await admin.rpc("next_procurement_material_issue_number", { p_organization_id: first.organization_id, p_issue_date: issueDate });
    if (number.error) throw number.error;
    const actor = { id: access.user.id, name: access.user.user_metadata?.full_name || access.user.email, email: access.user.email || null };
    const { data: issue, error } = await admin.from("procurement_material_issues").insert({ organization_id: first.organization_id, company_id: body.company_id, site_id: body.site_id, issue_number: number.data, issue_date: issueDate, issued_to: String(body.issued_to).trim(), department: body.department || null, work_location: body.work_location || null, purpose: String(body.purpose).trim(), remarks: body.remarks || null, created_by: actor.id, created_by_name: actor.name, created_by_email: actor.email, updated_by: actor.id, updated_by_name: actor.name, updated_by_email: actor.email }).select("*").single();
    if (error) throw error;
    const items = body.items.map((input: any) => { const row: any = byId.get(input.balance_id); const quantity = Number(input.issue_quantity); if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Issue quantities must be positive numbers."); if (quantity > Number(row.quantity_on_hand)) throw new Error(`Insufficient stock for ${row.item_name_snapshot}.`); return { material_issue_id: issue.id, inventory_balance_id: row.id, stock_identity_key: row.stock_identity_key, material_item_id: row.material_item_id, source_purchase_order_item_id: row.source_purchase_order_item_id, item_code_snapshot: row.item_code_snapshot, item_name_snapshot: row.item_name_snapshot, specification_snapshot: row.specification_snapshot, make_snapshot: row.make_snapshot, uom_snapshot: row.uom_snapshot, available_quantity_snapshot: row.quantity_on_hand, issue_quantity: quantity, remarks: input.remarks || null }; });
    const itemResult = await admin.from("procurement_material_issue_items").insert(items);
    if (itemResult.error) { await admin.from("procurement_material_issues").delete().eq("id", issue.id); throw itemResult.error; }
    await admin.from("procurement_material_issue_events").insert({ material_issue_id: issue.id, event_type: "created", actor_id: actor.id, actor_name: actor.name, actor_email: actor.email });
    if (body.finalize === true) { const result = await admin.rpc("finalize_procurement_material_issue_atomic", { p_issue_id: issue.id, p_actor: { user_id: actor.id, name: actor.name, email: actor.email } }); if (result.error) throw result.error; }
    return NextResponse.json({ issue_id: issue.id }, { status: 201 });
  } catch (error: any) { return jsonError(error.message || "Failed to create Material Issue.", 400); }
}
