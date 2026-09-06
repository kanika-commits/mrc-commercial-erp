import { NextResponse } from "next/server";
import { adminClient, applyCompanySiteAccess, applyOrganizationAccess, jsonError, requireProcurementPermission, actorName, text } from "@/lib/serverProcurementAccess";
const MODULE = "procurement_goods_receipts";
function actor(user: any) { return { user_id: user.id, name: actorName(user), email: user.email || null }; }
function numberOrNull(value: unknown) { if (value === undefined || value === null || String(value).trim() === "") return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function poFreightRule(po: any) {
  const status = text(po?.commercial_snapshot?.freight_transportation_status);
  if (status === "included") return "included";
  if (status === "extra") return "extra";
  if (numberOrNull(po?.total_freight_amount) !== null && Number(po.total_freight_amount) > 0) return "extra";
  return "unspecified";
}
function receiptFreight(body: any, po: any) {
  const rule = poFreightRule(po);
  if (rule === "included") return { freight_paid_by: null, freight_amount: null };
  const freightAmount = numberOrNull(body.freight_amount);
  if (freightAmount !== null && freightAmount < 0) throw new Error("Freight Amount must be a non-negative number.");
  if (rule === "extra") return { freight_paid_by: "bank", freight_amount: freightAmount };
  const paidBy = text(body.freight_paid_by) || "cash";
  if (!["vendor", "cash", "bank"].includes(paidBy)) throw new Error("Freight Paid By must be Vendor, Cash or Bank.");
  return { freight_paid_by: paidBy, freight_amount: freightAmount };
}
async function ensureDraftItems(admin: any, grn: any, allowInitialize: boolean) {
  if (!allowInitialize || grn.status !== "draft" || !grn.purchase_order_id) return grn;
  const { data: poItems, error: poError } = await admin.from("procurement_purchase_order_items").select("*").eq("purchase_order_id", grn.purchase_order_id);
  if (poError) throw poError;
  const existing = new Set((grn.items || []).map((item: any) => item.purchase_order_item_id));
  const missing = (poItems || []).filter((item: any) => !existing.has(item.id));
  if (!missing.length) return grn;
  const { data: finalizedReceipts, error: receiptError } = await admin.from("procurement_goods_receipts").select("id").eq("purchase_order_id", grn.purchase_order_id).eq("status", "finalized");
  if (receiptError) throw receiptError;
  const acceptedByItem = new Map<string, number>();
  const receiptIds = (finalizedReceipts || []).map((receipt: any) => receipt.id);
  if (receiptIds.length) {
    const { data: acceptedRows, error: acceptedError } = await admin.from("procurement_goods_receipt_items").select("purchase_order_item_id,accepted_quantity").in("grn_id", receiptIds);
    if (acceptedError) throw acceptedError;
    for (const row of acceptedRows || []) acceptedByItem.set(row.purchase_order_item_id, (acceptedByItem.get(row.purchase_order_item_id) || 0) + Number(row.accepted_quantity || 0));
  }
  const rows = missing.map((item: any) => {
    const previouslyAccepted = acceptedByItem.get(item.id) || 0;
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
      received_quantity: 0,
      accepted_quantity: 0,
      rejected_quantity: 0,
      hold_quantity: 0,
    };
  });
  const { error } = await admin.from("procurement_goods_receipt_items").insert(rows);
  if (error) throw error;
  const { data, error: reloadError } = await admin.from("procurement_goods_receipts").select("*, company:companies(id,company_name), site:sites(id,site_name), purchase_order:procurement_purchase_orders(id,po_number,po_date,vendor_name_snapshot,status,source_type,total_freight_amount,commercial_snapshot), items:procurement_goods_receipt_items(*), events:procurement_goods_receipt_events(*)").eq("id", grn.id).maybeSingle();
  if (reloadError) throw reloadError;
  return data || grn;
}
async function withVerifiedNet(admin: any, grn: any) {
  const { data, error } = await admin.from("procurement_goods_receipt_verified_values").select("field_name,final_value,verified_at").eq("grn_id", grn.id).in("field_name", ["gross_weight", "tare_weight"]).order("verified_at", { ascending: false });
  if (error) throw error;
  const gross = numberOrNull((data || []).find((value: any) => value.field_name === "gross_weight")?.final_value);
  const tare = numberOrNull((data || []).find((value: any) => value.field_name === "tare_weight")?.final_value);
  if (gross !== null && tare !== null && gross > tare && grn.weighbridge_net_kg == null) return { ...grn, weighbridge_net_kg: Number((gross - tare).toFixed(3)) };
  return grn;
}
async function load(request: Request, id: string, action: string) {
  const access = await requireProcurementPermission(request, MODULE, action === "finalize" ? "approve" : action);
  if ("response" in access) return { response: access.response } as const;
  const admin = adminClient(); let query: any = applyOrganizationAccess(admin.from("procurement_goods_receipts").select("*, company:companies(id,company_name), site:sites(id,site_name), purchase_order:procurement_purchase_orders(id,po_number,po_date,vendor_name_snapshot,status,source_type,total_freight_amount,commercial_snapshot), items:procurement_goods_receipt_items(*), events:procurement_goods_receipt_events(*)").eq("id", id).maybeSingle(), access); query = query && applyCompanySiteAccess(query, access); if (!query) return { response: jsonError("Goods Receipt Note was not found.", 404) } as const; const { data, error } = await query; if (error) throw error; if (!data) return { response: jsonError("Goods Receipt Note was not found.", 404) } as const; return { access, admin, row: data } as const;
}
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { try { const { id } = await context.params; const result = await load(request, id, "view"); if ("response" in result) return result.response; const editAccess = await requireProcurementPermission(request, MODULE, "edit"); const withItems = await ensureDraftItems(result.admin, result.row, !("response" in editAccess)); const grn = await withVerifiedNet(result.admin, withItems); return NextResponse.json({ grn }); } catch (error: any) { return jsonError(error.message || "Failed to load Goods Receipt Note.", 500); } }
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) { try { const { id } = await context.params; const result = await load(request, id, "edit"); if ("response" in result) return result.response; if (result.row.status !== "draft") return jsonError("Finalized Goods Receipt Notes are read-only.", 403); const body = await request.json(); const a = actor(result.access.user); const freight = receiptFreight(body, result.row.purchase_order); const { error } = await result.admin.from("procurement_goods_receipts").update({ supplier_challan_number: body.supplier_challan_number || null, supplier_challan_date: body.supplier_challan_date || null, received_date: body.received_date, received_by: body.received_by, vehicle_number: body.vehicle_number || null, freight_paid_by: freight.freight_paid_by, freight_amount: freight.freight_amount, remarks: body.remarks || null, weight_reconciliation_remarks: body.weight_reconciliation_remarks || null, updated_by: a.user_id, updated_by_name: a.name, updated_by_email: a.email, updated_at: new Date().toISOString() }).eq("id", id); if (error) throw error; for (const item of body.items || []) { const { error: itemError } = await result.admin.from("procurement_goods_receipt_items").update({ received_quantity: Number(item.received_quantity || 0), accepted_quantity: Number(item.accepted_quantity || 0), rejected_quantity: Number(item.rejected_quantity || 0), hold_quantity: Number(item.hold_quantity || 0), rejection_reason: item.rejection_reason || null, remarks: item.remarks || null }).eq("id", item.id).eq("grn_id", id); if (itemError) throw itemError; } await result.admin.from("procurement_goods_receipt_events").insert({ grn_id: id, event_type: "updated", actor_id: a.user_id, actor_name: a.name, actor_email: a.email }); return NextResponse.json({ saved: true }); } catch (error: any) { return jsonError(error.message || "Failed to save Goods Receipt Note.", 500); } }
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { try { const { id } = await context.params; const result = await load(request, id, "finalize"); if ("response" in result) return result.response; const rpc = await result.admin.rpc("finalize_procurement_goods_receipt_atomic", { p_grn_id: id, p_actor: actor(result.access.user) }); if (rpc.error) throw rpc.error; return NextResponse.json({ result: rpc.data }); } catch (error: any) { return jsonError(error.message || "Failed to finalize Goods Receipt Note.", 500); } }
