import crypto from "node:crypto";
import type { ServerPermissionContext } from "@/lib/serverPermissions";
import { applyOrganizationScope, isGlobalScope, loadActorOrganizationScope } from "@/lib/serverOrganizationScope";

export const PILOT_REVISION_NOTICE = "Upon issuance of this Revised Work Order, the previous Work Order and all prior versions are superseded and shall stand cancelled and replaced by this Revised Work Order.";

export function sha256(bytes: Uint8Array | Buffer) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function isPilotWorkOrder(order: { creation_request_id?: string | null }) {
  return Boolean(order.creation_request_id);
}

export async function loadScopedPilotWorkOrder(
  admin: any,
  auth: Pick<ServerPermissionContext, "user" | "roleCodes" | "permissions">,
  id: string,
) {
  const [organizationScope, assignments] = await Promise.all([
    loadActorOrganizationScope(admin, auth),
    admin.from("user_access_assignments").select("company_id, site_id").eq("user_id", auth.user.id),
  ]);
  if (assignments.error) throw assignments.error;

  let query = admin.from("work_orders").select("*").eq("id", id);
  const organizationQuery = applyOrganizationScope(query, organizationScope);
  if (!organizationQuery) return null;
  query = organizationQuery;

  const companyIds = Array.from(new Set((assignments.data || []).map((row: any) => row.company_id).filter(Boolean))) as string[];
  const siteIds = Array.from(new Set((assignments.data || []).map((row: any) => row.site_id).filter(Boolean))) as string[];
  if (!isGlobalScope(organizationScope) && siteIds.length > 0) query = query.in("site_id", siteIds);
  else if (!isGlobalScope(organizationScope) && companyIds.length > 0) query = query.in("company_id", companyIds);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data || !isPilotWorkOrder(data)) return null;
  return { db: admin, data };
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
