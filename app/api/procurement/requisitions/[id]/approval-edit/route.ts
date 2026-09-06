import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/auditEvent";
import { actorFields, adminClient, applyCompanySiteAccess, applyOrganizationAccess, jsonError, APPROVAL_MODULE, requireProcurementPermission, text } from "@/lib/serverProcurementAccess";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireProcurementPermission(request, APPROVAL_MODULE, "approve");
    if ("response" in auth) return auth.response;
    const { id } = await context.params;
    const admin = adminClient();
    let query = applyOrganizationAccess(admin.from("purchase_requisitions").select("id, organization_id, company_id, site_id, requisition_number, status, current_approval_layer, approval_workflow_version, required_by_date, purpose, items:purchase_requisition_items(*, approved_makes:purchase_requisition_item_approved_makes(*))").eq("id", id).maybeSingle(), auth);
    if (!query) return jsonError("Requisition was not found.", 404);
    query = applyCompanySiteAccess(query, auth);
    if (!query) return jsonError("Requisition was not found.", 404);
    const { data: row, error: rowError } = await query;
    if (rowError) throw rowError;
    if (!row || row.status !== "pending_approval") return jsonError("Only Pending Approval requisitions can be edited.", 409);
    const { count: lineStateCount, error: lineStateError } = await admin.from("purchase_requisition_line_approval_state").select("id", { count: "exact", head: true }).eq("requisition_id", id);
    if (lineStateError) throw lineStateError;
    const payload = await request.json().catch(() => ({}));
    if ((lineStateCount || 0) > 0) {
      const items = Array.isArray(payload.items) ? payload.items : [];
      const lineKeys = Array.isArray(payload.line_keys) ? payload.line_keys : items.map((item: any) => item?.line_key).filter(Boolean);
      if (!lineKeys.length || !items.length) return jsonError("Select at least one material line to edit.", 400);
      const actor = actorFields(auth.user);
      const result = await admin.rpc("edit_purchase_requisition_lines_during_approval_atomic", { p_requisition_id: id, p_organization_id: row.organization_id, p_lines: items, p_actor: { user_id: auth.user.id, name: actor.updated_by_name, email: actor.updated_by_email }, p_event_note: `Edited ${lineKeys.length} material line${lineKeys.length === 1 ? "" : "s"} during approval.` });
      if (result.error) throw result.error;
      return NextResponse.json({ ok: true, ...result.data });
    }
    const { data: steps, error: stepError } = await admin.from("purchase_requisition_approval_steps").select("submission_cycle, layer_number, status, approver_user_id").eq("requisition_id", id).eq("workflow_version", row.approval_workflow_version).order("submission_cycle", { ascending: false });
    if (stepError) throw stepError;
    const latestCycle = Math.max(0, ...(steps || []).map((step: any) => Number(step.submission_cycle || 0)));
    const current = (steps || []).find((step: any) => Number(step.submission_cycle) === latestCycle && Number(step.layer_number) === row.current_approval_layer);
    if (!current || current.status !== "pending" || current.approver_user_id !== auth.user.id) return jsonError("Only the assigned current approver can edit this requisition.", 403);
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (items.length === 0) return jsonError("At least one item is required.", 400);
    const normalizedItems: any[] = [];
    const snapshots: string[][] = [];
    for (let index = 0; index < items.length; index += 1) {
      const input = items[index] || {};
      const itemId = text(input.item_id);
      const { data: item, error: itemError } = await admin.from("procurement_items").select("id, organization_id, item_code, item_name, default_uom_id, status").eq("id", itemId).eq("organization_id", row.organization_id).maybeSingle();
      if (itemError) throw itemError;
      if (!item || item.status !== "active") return jsonError(`Active item was not found on line ${index + 1}.`, 400);
      const { data: uom, error: uomError } = await admin.from("procurement_uoms").select("id, uom_code, status").eq("id", item.default_uom_id).eq("organization_id", row.organization_id).maybeSingle();
      if (uomError) throw uomError;
      if (!uom || uom.status !== "active" || (text(input.uom_id) && text(input.uom_id) !== uom.id)) return jsonError(`Selected UOM does not match the Item Master on line ${index + 1}.`, 400);
      if (!Number.isFinite(Number(input.quantity)) || Number(input.quantity) <= 0) return jsonError(`Quantity must be greater than 0 on line ${index + 1}.`, 400);
      const makes: string[] = Array.from(new Set((Array.isArray(input.approved_makes) ? input.approved_makes : []).map((make: unknown) => text(make)).filter((make: string) => Boolean(make))));
      normalizedItems.push({ line_key: text(input.line_key) || crypto.randomUUID(), item_id: item.id, specification: text(input.specification) || null, purpose: text(input.purpose) || null, make_brand: text(input.make_brand) || null, uom_id: uom.id, quantity: Number(input.quantity), requested_by_employee_id: text(input.requested_by_employee_id) || null, required_by_date: text(input.required_by_date) || null, remarks: text(input.remarks) || null, sort_order: index + 1 });
      snapshots.push(makes);
    }
    const actor = actorFields(auth.user);
    const event = { event_note: `Edited during Layer ${row.current_approval_layer}.` };
    const result = await admin.rpc("edit_purchase_requisition_during_approval_atomic", { p_requisition_id: id, p_organization_id: row.organization_id, p_header: { requisition_date: text(payload.requisition_date) }, p_items: normalizedItems, p_snapshots: snapshots, p_actor: { user_id: auth.user.id, name: actor.updated_by_name, email: actor.updated_by_email }, p_event: event });
    if (result.error) throw result.error;
    try { await recordAuditEvent(admin, auth.user, { organizationId: row.organization_id, companyId: row.company_id, siteId: row.site_id, moduleCode: APPROVAL_MODULE, entityType: "purchase_requisition", recordId: id, recordNumber: row.requisition_number, action: "update", actionCategory: "workflow", activityLabel: "Edited Indent During Approval", description: `Edited purchase requisition ${row.requisition_number} during approval.`, newValues: { layer: row.current_approval_layer, items: normalizedItems }, reason: event.event_note }, request); } catch (auditError) { console.error("[Procurement Audit] Approval edit audit failed", auditError); }
    return NextResponse.json({ ok: true, ...result.data });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Failed to edit requisition during approval." }, { status: 500 }); }
}
