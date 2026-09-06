import { NextResponse } from "next/server";
import { applyCompanySiteAccess, applyOrganizationAccess, adminClient, requireProcurementAny } from "@/lib/serverProcurementAccess";

const QUEUE = "procurement_purchase_queue";

function lineStage(quantities: any) {
  return { stage: quantities.available > 0 ? "Purchase Pending" : "Fully Reserved / Ordered", detail: `Approved ${quantities.approved} · Reserved ${quantities.reserved} · Ordered ${quantities.ordered} · Available ${quantities.available}`, completed: quantities.available <= 0, ...quantities };
}

function relationOne(value: any) {
  return Array.isArray(value) ? value[0] : value;
}

export async function GET(request: Request) {
  try {
    const auth = await requireProcurementAny(request, [{ moduleCode: QUEUE, actionCode: "view" }]);
    if ("response" in auth) return auth.response;
    const admin = adminClient();
    let query: any = applyOrganizationAccess(admin.from("purchase_requisitions").select("id,requisition_number,requisition_date,organization_id,company_id,site_id,requested_by_name,priority,purchase_pending_at,purchase_taken_up_at,company:companies(company_name),site:sites(site_name),items:purchase_requisition_items(line_key,item_code_snapshot,item_name_snapshot,quantity,sort_order)" ).eq("procurement_flow", "billing_engineer").neq("status", "deleted").order("created_at", { ascending: true }), auth);
    query = query && applyCompanySiteAccess(query, auth);
    if (!query) return NextResponse.json({ requisitions: [] });
    const { data, error } = await query;
    if (error) throw error;
    const rows = data || [];
    if (!rows.length) return NextResponse.json({ requisitions: [] });
    const requisitionIds = rows.map((row: any) => row.id);
    const [lineStateResult, orderedResult] = await Promise.all([
      admin.from("purchase_requisition_line_approval_state").select("requisition_id,requisition_item_line_key,approval_status,current_approval_layer").in("requisition_id", requisitionIds),
      admin.from("procurement_purchase_order_items").select("source_requisition_id,source_requisition_line_key,quantity,purchase_order:procurement_purchase_orders!inner(status)").in("source_requisition_id", requisitionIds),
    ]);
    for (const result of [lineStateResult, orderedResult]) if (result.error) throw result.error;
    const quantitiesByLine = new Map<string, any>();
    for (const row of orderedResult.data || []) {
      const key = `${row.source_requisition_id}:${row.source_requisition_line_key}`;
      const quantity = Number(row.quantity || 0);
      const status = relationOne(row.purchase_order)?.status;
      const current = quantitiesByLine.get(key) || { reserved: 0, ordered: 0 };
      if (["draft", "pending_approval", "sent_back"].includes(status)) current.reserved += quantity;
      else if (["approved", "issued"].includes(status)) current.ordered += quantity;
      quantitiesByLine.set(key, current);
    }
    const approvedLineKeys = new Map<string, Set<string>>();
    for (const state of lineStateResult.data || []) {
      if (state.approval_status === "approved" && state.current_approval_layer === null) {
        if (!approvedLineKeys.has(state.requisition_id)) approvedLineKeys.set(state.requisition_id, new Set());
        approvedLineKeys.get(state.requisition_id)!.add(state.requisition_item_line_key);
      }
    }
    const requisitions = rows.map((row: any) => {
      const approvedKeys = approvedLineKeys.get(row.id) || new Set<string>();
      const lineStatuses = (row.items || [])
        .filter((line: any) => approvedKeys.has(line.line_key))
        .map((line: any) => { const current = quantitiesByLine.get(`${row.id}:${line.line_key}`) || { reserved: 0, ordered: 0 }; const quantities = { approved: Number(line.quantity || 0), reserved: current.reserved, ordered: current.ordered, available: Math.max(0, Number(line.quantity || 0) - current.reserved - current.ordered) }; return { ...line, ...lineStage(quantities) }; });
      const incomplete = lineStatuses.filter((line: any) => !line.completed);
      const availableLineKeys = lineStatuses.filter((line: any) => line.stage === "Purchase Pending").map((line: any) => line.line_key);
      const stages = Array.from(new Set(incomplete.map((line: any) => line.stage)));
      const currentStage = stages.length === 1 ? stages[0] : "Procurement In Progress";
      return { ...row, items: lineStatuses, available_line_keys: availableLineKeys, current_stage: currentStage, current_stage_detail: lineStatuses.map((line: any) => `${line.item_name_snapshot}: ${line.stage}`).join("; ") };
    }).filter((row: any) => row.items.some((line: any) => !line.completed));
    return NextResponse.json({ requisitions });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load Purchase Queue." }, { status: 500 });
  }
}
