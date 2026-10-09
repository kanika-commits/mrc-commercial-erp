import crypto from "node:crypto";

export const PILOT_REVISION_NOTICE = "Upon issuance of this Revised Work Order, the previous Work Order and all prior versions are superseded and shall stand cancelled and replaced by this Revised Work Order.";

export function sha256(bytes: Uint8Array | Buffer) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function isPilotWorkOrder(order: { creation_request_id?: string | null }) {
  return Boolean(order.creation_request_id);
}

export function isRevisionSchemaUnavailable(error: any) {
  const message = String(error?.message || error || "").toLowerCase();
  return error?.code === "PGRST205" || error?.code === "42P01" || message.includes("work_order_pilot_revision") || message.includes("schema cache");
}

export function buildRevisionSnapshot(order: any, items: any[]) {
  return {
    fields: { wo_number: order.wo_number, wo_date: order.wo_date, wo_type: order.wo_type, description: order.description, company_id: order.company_id, site_id: order.site_id, delivery_snapshot: order.delivery_snapshot, work_order_key_terms: order.work_order_key_terms, standard_terms_snapshot: order.standard_terms_snapshot, letterhead_snapshot: order.letterhead_snapshot },
    totals: { wo_value: order.wo_value, gst_percent: order.gst_percent, total_basic_amount: order.total_basic_amount, total_gst_amount: order.total_gst_amount, total_amount: order.total_amount },
    items: items.map((item, index) => ({ ...item, sort_order: item.sort_order ?? index + 1 })),
  };
}

export function redlineValue(original: unknown, revised: unknown) {
  if (String(original ?? "") === String(revised ?? "")) return { kind: "unchanged", value: revised };
  if (revised === null || revised === undefined || String(revised) === "") return { kind: "deleted", value: original };
  return { kind: original === null || original === undefined || String(original) === "" ? "added" : "changed", value: revised, previous: original };
}
