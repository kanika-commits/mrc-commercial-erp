import { NextResponse } from "next/server";
import { adminClient, applyCompanySiteAccess, applyOrganizationAccess, jsonError, requireProcurementAny, requireProcurementPermission, actorName, text } from "@/lib/serverProcurementAccess";

const MODULE = "procurement_goods_receipts";
function actor(user: any) { return { id: user.id, name: actorName(user), email: user.email || null }; }
function receiptStatus(items: any[], draftCount: number) { const receivedAll = items.length > 0 && items.every((item: any) => Number(item.remaining_quantity || 0) <= 0); const hasAccepted = items.some((item: any) => Number(item.previously_accepted_quantity || 0) > 0); return receivedAll ? "fully_received" : hasAccepted ? "partially_received" : draftCount > 0 ? "receipt_in_progress" : "not_received"; }

export async function GET(request: Request) {
  try {
    const access = await requireProcurementAny(request, [{ moduleCode: MODULE, actionCode: "view" }, { moduleCode: MODULE, actionCode: "add" }, { moduleCode: MODULE, actionCode: "approve" }]);
    if ("response" in access) return access.response;
    const admin = adminClient();
    let query: any = applyOrganizationAccess(admin.from("procurement_goods_receipts").select("*, company:companies(id,company_name), site:sites(id,site_name), purchase_order:procurement_purchase_orders(id,po_number,vendor_name_snapshot,status)").order("created_at", { ascending: false }), access);
    query = query && applyCompanySiteAccess(query, access);
    const { data: grns, error } = query ? await query : { data: [], error: null };
    if (error) throw error;
    let poQuery: any = applyOrganizationAccess(admin.from("procurement_purchase_orders").select("id,po_number,po_date,organization_id,company_id,site_id,total_amount,vendor_name_snapshot,company:companies!procurement_purchase_orders_company_id_fkey(id,company_name),site:sites(id,site_name),items:procurement_purchase_order_items(*)").in("status", ["approved", "issued"]).order("po_date", { ascending: false }), access);
    poQuery = poQuery && applyCompanySiteAccess(poQuery, access);
    const { data: purchaseOrders, error: poError } = poQuery ? await poQuery : { data: [], error: null };
    if (poError) throw poError;
    const enrichedOrders = await Promise.all((purchaseOrders || []).map(async (order: any) => {
      const orderGrns = (grns || []).filter((grn: any) => grn.purchase_order_id === order.id);
      const draftCount = orderGrns.filter((grn: any) => grn.status === "draft").length;
      const { data: finalized, error: finalizedError } = await admin.from("procurement_goods_receipts").select("id").eq("purchase_order_id", order.id).eq("status", "finalized");
      if (finalizedError) throw finalizedError;
      const totalsByItem = new Map<string, { received: number; accepted: number; rejected: number; hold: number }>();
      const receiptIds = (finalized || []).map((receipt: any) => receipt.id);
      if (receiptIds.length) {
        const { data: acceptedRows, error: acceptedError } = await admin.from("procurement_goods_receipt_items").select("purchase_order_item_id,received_quantity,accepted_quantity,rejected_quantity,hold_quantity").in("grn_id", receiptIds);
        if (acceptedError) throw acceptedError;
        for (const row of acceptedRows || []) {
          const current = totalsByItem.get(row.purchase_order_item_id) || { received: 0, accepted: 0, rejected: 0, hold: 0 };
          totalsByItem.set(row.purchase_order_item_id, { received: current.received + Number(row.received_quantity || 0), accepted: current.accepted + Number(row.accepted_quantity || 0), rejected: current.rejected + Number(row.rejected_quantity || 0), hold: current.hold + Number(row.hold_quantity || 0) });
        }
      }
      const items = (order.items || []).map((item: any) => { const totals = totalsByItem.get(item.id) || { received: 0, accepted: 0, rejected: 0, hold: 0 }; return { ...item, previously_accepted_quantity: totals.accepted, finalized_received_quantity: totals.received, finalized_accepted_quantity: totals.accepted, finalized_rejected_quantity: totals.rejected, finalized_hold_quantity: totals.hold, remaining_quantity: Math.max(0, Number(item.quantity || 0) - totals.accepted), received_quantity: 0, accepted_quantity: 0, rejected_quantity: 0, hold_quantity: 0, rejection_reason: "", remarks: "" }; });
      const totals = items.reduce((sum: any, item: any) => ({ po_quantity: sum.po_quantity + Number(item.quantity || 0), received: sum.received + Number(item.finalized_received_quantity || 0), accepted: sum.accepted + Number(item.finalized_accepted_quantity || 0), rejected: sum.rejected + Number(item.finalized_rejected_quantity || 0), hold: sum.hold + Number(item.finalized_hold_quantity || 0), remaining: sum.remaining + Number(item.remaining_quantity || 0) }), { po_quantity: 0, received: 0, accepted: 0, rejected: 0, hold: 0, remaining: 0 });
      return { ...order, items, receipt_count: orderGrns.length, finalized_receipt_count: receiptIds.length, draft_receipt_count: draftCount, totals, receipt_status: receiptStatus(items, draftCount), draft_exists: draftCount > 0, grns: orderGrns };
    }));
    const receipt_register = enrichedOrders;
    return NextResponse.json({ grns: grns || [], purchase_orders: enrichedOrders, receipt_register });
  } catch (error: any) { return jsonError(error.message || "Failed to load Purchase Order Tracking.", 500); }
}

export async function POST(request: Request) {
  try {
    const access = await requireProcurementPermission(request, MODULE, "add");
    if ("response" in access) return access.response;
    const body = await request.json().catch(() => ({}));
    const admin = adminClient();
    let poQuery: any = applyOrganizationAccess(admin.from("procurement_purchase_orders").select("*, items:procurement_purchase_order_items(*)").eq("id", text(body.purchase_order_id)).in("status", ["approved", "issued"]).maybeSingle(), access);
    poQuery = poQuery && applyCompanySiteAccess(poQuery, access);
    if (!poQuery) return jsonError("Purchase Order is outside your access scope.", 403);
    const { data: po, error: poError } = await poQuery;
    if (poError) throw poError;
    if (!po) return jsonError("Only an approved Purchase Order can create a GRN.", 400);
    const existingDraft = await admin.from("procurement_goods_receipts").select("id").eq("purchase_order_id", po.id).eq("organization_id", po.organization_id).eq("company_id", po.company_id).eq("site_id", po.site_id).eq("status", "draft").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existingDraft.error) throw existingDraft.error;
    if (existingDraft.data?.id) return NextResponse.json({ id: existingDraft.data.id, reused: true });
    const submittedItems = new Map<string, any>((Array.isArray(body.items) ? body.items : []).map((item: any) => [String(item.purchase_order_item_id || item.id || ""), item]));
    for (const submitted of submittedItems.values()) {
      const quantities = ["received_quantity", "accepted_quantity", "rejected_quantity", "hold_quantity"].map((key) => Number(submitted[key] ?? 0));
      if (quantities.some((value) => !Number.isFinite(value) || value < 0)) return jsonError("Receipt quantities must be non-negative numbers.", 400);
    }
    const number = await admin.rpc("next_procurement_goods_receipt_number", { p_organization_id: po.organization_id, p_grn_date: body.grn_date || new Date().toISOString().slice(0, 10) });
    if (number.error) throw number.error;
    const a = actor(access.user);
    const { data: grn, error } = await admin.from("procurement_goods_receipts").insert({ organization_id: po.organization_id, company_id: po.company_id, site_id: po.site_id, purchase_order_id: po.id, grn_number: number.data, grn_date: body.grn_date || new Date().toISOString().slice(0, 10), supplier_challan_number: body.supplier_challan_number || null, supplier_challan_date: body.supplier_challan_date || null, received_date: body.received_date || body.grn_date || new Date().toISOString().slice(0, 10), received_by: body.received_by || a.name, vehicle_number: body.vehicle_number || null, remarks: body.remarks || null, po_snapshot: { po_number: po.po_number, po_date: po.po_date, company_id: po.company_id, site_id: po.site_id, vendor_name: po.vendor_name_snapshot, total_amount: po.total_amount, status: po.status }, created_by: a.id, created_by_name: a.name, created_by_email: a.email, updated_by: a.id, updated_by_name: a.name, updated_by_email: a.email }).select("id").single();
    if (error) throw error;
    const { data: finalizedReceipts, error: receiptError } = await admin.from("procurement_goods_receipts").select("id").eq("purchase_order_id", po.id).eq("status", "finalized");
    if (receiptError) throw receiptError;
    const acceptedByItem = new Map<string, number>();
    const receiptIds = (finalizedReceipts || []).map((receipt: any) => receipt.id);
    if (receiptIds.length) {
      const { data: acceptedRows, error: acceptedError } = await admin.from("procurement_goods_receipt_items").select("purchase_order_item_id,accepted_quantity").in("grn_id", receiptIds);
      if (acceptedError) throw acceptedError;
      for (const row of acceptedRows || []) acceptedByItem.set(row.purchase_order_item_id, (acceptedByItem.get(row.purchase_order_item_id) || 0) + Number(row.accepted_quantity || 0));
    }
    const items = (po.items || []).map((item: any) => {
      const previouslyAccepted = acceptedByItem.get(item.id) || 0;
      const submitted = submittedItems.get(String(item.id)) || {};
      const quantities = ["received_quantity", "accepted_quantity", "rejected_quantity", "hold_quantity"].map((key) => Number(submitted[key] ?? 0));
      return {
        grn_id: grn.id,
        purchase_order_item_id: item.id,
        material_item_id: item.item_id || null,
        item_code_snapshot: item.item_code_snapshot,
        item_name_snapshot: item.item_name_snapshot,
        specification_snapshot: item.specification_snapshot,
        make_snapshot: item.make_snapshot,
        uom_snapshot: item.uom_snapshot,
        ordered_quantity_snapshot: item.quantity,
        previously_accepted_quantity: previouslyAccepted,
        remaining_quantity_snapshot: Math.max(0, Number(item.quantity || 0) - previouslyAccepted),
        received_quantity: quantities[0],
        accepted_quantity: quantities[1],
        rejected_quantity: quantities[2],
        hold_quantity: quantities[3],
        rejection_reason: submitted.rejection_reason ? String(submitted.rejection_reason) : null,
        remarks: submitted.remarks ? String(submitted.remarks) : null,
      };
    });
    const { error: itemError } = await admin.from("procurement_goods_receipt_items").insert(items);
    if (itemError) { await admin.from("procurement_goods_receipts").delete().eq("id", grn.id); throw itemError; }
    await admin.from("procurement_goods_receipt_events").insert({ grn_id: grn.id, event_type: "created", actor_id: a.id, actor_name: a.name, actor_email: a.email });
    return NextResponse.json({ id: grn.id }, { status: 201 });
  } catch (error: any) { return jsonError(error.message || "Failed to create Goods Receipt Note.", 500); }
}
