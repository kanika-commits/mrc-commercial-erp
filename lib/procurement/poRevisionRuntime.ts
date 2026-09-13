import { latestEffectiveByFamily, type RevisionPo } from "@/lib/procurement/poRevisionEffective";

export type RevisionItem = { id: string; purchase_order_id: string; revision_line_key?: string | null; quantity?: number | null; [key: string]: unknown };
export type ReceiptItem = { purchase_order_item_id: string; accepted_quantity?: number | null; received_quantity?: number | null };

export function effectiveItems(orders: RevisionPo[], items: RevisionItem[]) {
  const effectiveIds = new Set(latestEffectiveByFamily(orders).filter(Boolean).map((order) => order!.id));
  return items.filter((item) => effectiveIds.has(item.purchase_order_id));
}

export function receivedByLineage(orders: RevisionPo[], items: RevisionItem[], receipts: ReceiptItem[]) {
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const totals = new Map<string, number>();
  for (const receipt of receipts) {
    const item = itemById.get(receipt.purchase_order_item_id);
    const order = item ? orderById.get(item.purchase_order_id) : null;
    if (!item?.revision_line_key || !order) continue;
    const family = order.revision_family_id || order.id;
    const key = `${family}:${item.revision_line_key}`;
    totals.set(key, (totals.get(key) || 0) + Number(receipt.accepted_quantity || 0));
  }
  return totals;
}

export function remainingQuantity(orders: RevisionPo[], item: RevisionItem, received: Map<string, number>) {
  const order = orders.find((candidate) => candidate.id === item.purchase_order_id);
  if (!order) return 0;
  const key = `${order.revision_family_id || order.id}:${item.revision_line_key || item.id}`;
  return Math.max(Number(item.quantity || 0) - Number(received.get(key) || 0), 0);
}

export async function loadFamilyReceiptTotals(admin: any, po: RevisionPo & { organization_id: string }) {
  const familyQuery = admin.from("procurement_purchase_orders").select("id,revision_family_id,revision_no,status,superseded_by_revision_id,created_at,organization_id").eq("organization_id", po.organization_id);
  const familyResult = po.revision_family_id ? await familyQuery.eq("revision_family_id", po.revision_family_id) : await familyQuery.eq("id", po.id);
  if (familyResult.error) throw familyResult.error;
  const familyOrders = familyResult.data || [];
  const familyIds = familyOrders.map((row: any) => row.id);
  if (!familyIds.length) return { orders: familyOrders, items: [], received: new Map<string, number>() };
  const itemsResult = await admin.from("procurement_purchase_order_items").select("*").in("purchase_order_id", familyIds);
  if (itemsResult.error) throw itemsResult.error;
  const itemIds = (itemsResult.data || []).map((row: any) => row.id);
  if (!itemIds.length) return { orders: familyOrders, items: itemsResult.data || [], received: new Map<string, number>() };
  const receiptResult = await admin.from("procurement_goods_receipt_items").select("grn_id,purchase_order_item_id,accepted_quantity").in("purchase_order_item_id", itemIds).not("grn_id", "is", null);
  if (receiptResult.error) throw receiptResult.error;
  const grnIds = [...new Set((receiptResult.data || []).map((row: any) => row.grn_id).filter(Boolean))];
  const validResult = grnIds.length ? await admin.from("procurement_goods_receipts").select("id").in("id", grnIds).eq("status", "finalized") : { data: [], error: null };
  if (validResult.error) throw validResult.error;
  const validIds = validResult.data || [];
  const valid = new Set(validIds.map((row: any) => row.id));
  const received = receivedByLineage(familyOrders, itemsResult.data || [], (receiptResult.data || []).filter((row: any) => valid.has(row.grn_id)));
  return { orders: familyOrders, items: itemsResult.data || [], received };
}
