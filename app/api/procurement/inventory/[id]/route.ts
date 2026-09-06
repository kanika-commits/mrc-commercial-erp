import { NextResponse } from "next/server";
import { adminClient, applyCompanySiteAccess, applyOrganizationAccess, jsonError, requireProcurementAny } from "@/lib/serverProcurementAccess";
const MODULE = "procurement_inventory";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireProcurementAny(request, [{ moduleCode: MODULE, actionCode: "view" }, { moduleCode: MODULE, actionCode: "add" }]);
    if ("response" in access) return access.response;
    const { id } = await context.params; const admin = adminClient();
    let query: any = applyOrganizationAccess(admin.from("procurement_inventory_balances").select("*").eq("id", id).maybeSingle(), access); query = query && applyCompanySiteAccess(query, access);
    if (!query) return jsonError("Inventory balance was not found.", 404);
    const { data: balance, error } = await query; if (error) throw error; if (!balance) return jsonError("Inventory balance was not found.", 404);
    const url = new URL(request.url); const page = Math.max(1, Number(url.searchParams.get("page") || 1)); const size = Math.min(100, Math.max(10, Number(url.searchParams.get("page_size") || 25)));
    const from = (page - 1) * size;
    const { data: movements, error: movementError, count } = await admin.from("procurement_inventory_movements").select("*", { count: "exact" }).eq("inventory_balance_id", id).order("movement_date", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, from + size - 1);
    if (movementError) throw movementError;
    let running = Number(balance.quantity_on_hand) - Number(balance.total_received) + Number(balance.total_issued);
    if (from > 0) { const { data: prior, error: priorError } = await admin.from("procurement_inventory_movements").select("quantity_in,quantity_out").eq("inventory_balance_id", id).order("movement_date", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true }).range(0, from - 1); if (priorError) throw priorError; for (const row of prior || []) running += Number(row.quantity_in || 0) - Number(row.quantity_out || 0); }
    const receiptIds = (movements || []).filter((row: any) => row.source_type === "goods_receipt").map((row: any) => row.source_id);
    const issueIds = (movements || []).filter((row: any) => row.source_type === "material_issue").map((row: any) => row.source_id);
    const [receipts, issues] = await Promise.all([receiptIds.length ? admin.from("procurement_goods_receipts").select("id,grn_number,purchase_order_id").in("id", receiptIds) : { data: [], error: null }, issueIds.length ? admin.from("procurement_material_issues").select("id,issue_number").in("id", issueIds) : { data: [], error: null }]);
    if (receipts.error) throw receipts.error; if (issues.error) throw issues.error;
    const receiptLabels = new Map((receipts.data || []).map((row: any) => [row.id, row.grn_number])); const issueLabels = new Map((issues.data || []).map((row: any) => [row.id, row.issue_number]));
    const history = (movements || []).map((row: any) => { running += Number(row.quantity_in || 0) - Number(row.quantity_out || 0); return { ...row, reference_label: row.source_type === "goods_receipt" ? `GRN ${receiptLabels.get(row.source_id) || "Receipt"}` : `Material Issue ${issueLabels.get(row.source_id) || "Issue"}`, running_balance: running }; });
    return NextResponse.json({ balance, movements: history, total_movements: count || 0, page, page_size: size });
  } catch (error: any) { return jsonError(error.message || "Failed to load inventory detail.", 500); }
}
