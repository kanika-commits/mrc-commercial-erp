export type PurchaseOrderSendBackRow = {
  id: string;
  status: string;
  [key: string]: unknown;
};

export type PurchaseOrderSendBackEvent = {
  id?: string | null;
  purchase_order_id: string;
  event_type: string;
  event_note?: string | null;
  created_at?: string | null;
};

/** Attaches only the latest Send Back reason belonging to each currently sent-back PO row. */
export function attachCurrentSendBackComments<T extends PurchaseOrderSendBackRow>(
  currentRows: readonly T[],
  events: readonly PurchaseOrderSendBackEvent[],
) {
  const currentSentBackIds = new Set(currentRows.filter((row) => row.status === "sent_back").map((row) => row.id));
  const latestByPurchaseOrder = new Map<string, string>();
  const latestEvents = [...events]
    .filter((event) => event.event_type === "send_back"
      && currentSentBackIds.has(event.purchase_order_id)
      && Boolean(String(event.event_note || "").trim()))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))
      || String(b.id || "").localeCompare(String(a.id || "")));

  for (const event of latestEvents) {
    if (latestByPurchaseOrder.has(event.purchase_order_id)) continue;
    latestByPurchaseOrder.set(event.purchase_order_id, String(event.event_note).trim());
  }

  return currentRows.map((row) => ({
    ...row,
    latest_send_back_comment: row.status === "sent_back" ? latestByPurchaseOrder.get(row.id) || null : null,
  }));
}
