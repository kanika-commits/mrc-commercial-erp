import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/auditEvent";
import { adminClient, actorFields, applyCompanySiteAccess, applyOrganizationAccess, jsonError, REQUISITION_MODULE, requireProcurementPermission, text, validateCompanySiteAccess } from "@/lib/serverProcurementAccess";

function canEditStatus(status: string) { return ["draft", "sent_back"].includes(status); }
function uniqueMakes(values: unknown[]) {
  const seen = new Set<string>();
  const makes: string[] = [];
  for (const value of values) {
    const makeName = text(value);
    const key = makeName.toLowerCase();
    if (!makeName || seen.has(key)) continue;
    seen.add(key);
    makes.push(makeName);
  }
  return makes;
}

async function ensureSiteItemMakes(admin: any, organizationId: string, siteId: string, itemId: string, makeNames: string[]) {
  // PR-entered makes are local snapshots only. Material Approval owns source data.
  return [];
  if (makeNames.length === 0) return [];
  const { data: existingRows, error } = await admin.from("procurement_site_item_approved_makes").select("id, make_name, status").eq("organization_id", organizationId).eq("site_id", siteId).eq("item_id", itemId).neq("status", "deleted");
  if (error) throw error;
  const existingByName = new Map<string, any>((existingRows || []).map((row: any) => [text(row.make_name).toLowerCase(), row]));
  const learned: any[] = [];
  for (const makeName of makeNames) {
    const existing = existingByName.get(makeName.toLowerCase());
    if (existing) {
      if (existing.status !== "active") {
        const { error: updateError } = await admin.from("procurement_site_item_approved_makes").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", existing.id);
        if (updateError) throw updateError;
      }
      learned.push({ id: existing.id, make_name: existing.make_name, reused: true });
      continue;
    }
    const { data, error: insertError } = await admin.from("procurement_site_item_approved_makes").insert({ organization_id: organizationId, site_id: siteId, item_id: itemId, make_name: makeName, status: "active", sort_order: 0 }).select("id, make_name").single();
    if (insertError) {
      if (!String(insertError.message || "").toLowerCase().includes("duplicate")) throw insertError;
      continue;
    }
    learned.push({ id: data.id, make_name: data.make_name, reused: false });
  }
  return learned;
}

async function loadRequisition(admin: any, auth: any, id: string) {
  let query = applyOrganizationAccess(admin.from("purchase_requisitions").select("*, company:companies(id, company_name, company_code), site:sites(id, site_name, site_code), items:purchase_requisition_items(*, approved_makes:purchase_requisition_item_approved_makes(*)), events:purchase_requisition_events(*), approval_steps:purchase_requisition_approval_steps(*)").eq("id", id).neq("status", "deleted").maybeSingle(), auth);
  if (!query) return null;
  query = applyCompanySiteAccess(query, auth);
  if (!query) return null;
  const { data, error } = await query;
  if (error) throw error;
  if (data?.items) data.items = [...data.items].sort((a: any, b: any) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  if (data?.events) data.events = [...data.events].sort((a: any, b: any) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  if (data?.approval_steps) data.approval_steps = [...data.approval_steps].sort((a: any, b: any) => Number(a.submission_cycle) - Number(b.submission_cycle) || Number(a.layer_number) - Number(b.layer_number));
  const { data: lineStates, error: lineStateError } = await admin.from("purchase_requisition_line_approval_state").select("requisition_id, requisition_item_line_key, workflow_version, submission_cycle, current_approval_layer, approval_status, final_approved_at").eq("requisition_id", id);
  if (lineStateError) throw lineStateError;
  const { data: lineSteps, error: lineStepError } = await admin.from("purchase_requisition_line_approval_steps").select("requisition_id, requisition_item_line_key, workflow_version, submission_cycle, layer_number, stage_name, approver_user_id, approver_name_snapshot, approver_email_snapshot, status").eq("requisition_id", id);
  if (lineStepError) throw lineStepError;
  const states = lineStates || [];
  data.line_workflow_initialized = states.length > 0;
  data.line_approval_states = states;
  data.line_approval_steps = lineSteps || [];
  const { count: linkedRfqCount, error: linkedRfqError } = await admin
    .from("procurement_rfqs")
    .select("id", { count: "exact", head: true })
    .eq("source_requisition_id", id)
    .neq("status", "cancelled");
  if (linkedRfqError) throw linkedRfqError;
  data.workflow_display_status = linkedRfqCount && linkedRfqCount > 0
    ? "Procurement In Progress"
    : data.procurement_flow === "billing_engineer" && data.status === "pending_approval"
      ? "Pending Requisition Approval"
      : data.procurement_flow === "billing_engineer" && data.status === "approved" && data.purchase_pending_at && !data.purchase_taken_up_at
        ? "Purchase Pending"
        : data.status === "sent_back" ? "Sent Back"
          : data.status === "rejected" ? "Rejected"
            : data.status === "approved" ? "Approved" : "Draft";
  data.items = (data.items || []).map((item: any) => {
    const state = states.find((candidate: any) => candidate.requisition_item_line_key === item.line_key);
    const step = (lineSteps || []).find((candidate: any) => candidate.requisition_item_line_key === item.line_key && candidate.workflow_version === state?.workflow_version && candidate.submission_cycle === state?.submission_cycle && candidate.layer_number === state?.current_approval_layer);
    return { ...item, line_approval_state: state || null, current_line_approval_step: step || null, line_has_next_layer: Boolean(state && (lineSteps || []).some((candidate: any) => candidate.requisition_item_line_key === item.line_key && candidate.workflow_version === state.workflow_version && candidate.submission_cycle === state.submission_cycle && Number(candidate.layer_number) > Number(state.current_approval_layer))), line_actionable: Boolean(state?.approval_status === "pending" && step?.status === "pending" && step?.approver_user_id === auth.user.id) };
  });
  return data;
}
async function buildLineItems(admin: any, organizationId: string, siteId: string, rawItems: any[]) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new Error("At least one requisition item is required.");
  const rows = [];
  const snapshots: string[][] = [];
  for (let index = 0; index < rawItems.length; index += 1) {
    const line = rawItems[index] || {};
    const itemId = text(line.item_id);
    const requestedUomId = text(line.uom_id);
    const quantity = Number(line.quantity);
    if (!itemId) throw new Error(`Item is required on line ${index + 1}.`);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Quantity must be greater than 0 on line ${index + 1}.`);
    const { data: item, error: itemError } = await admin.from("procurement_items").select("id, organization_id, item_code, item_name, default_uom_id, status").eq("id", itemId).eq("organization_id", organizationId).maybeSingle();
    if (itemError) throw itemError;
    if (!item || item.status !== "active") throw new Error(`Active item was not found on line ${index + 1}.`);
    if (!item.default_uom_id) throw new Error(`The selected item has no default UOM on line ${index + 1}.`);
    if (requestedUomId && requestedUomId !== item.default_uom_id) throw new Error(`The selected UOM does not match the Item Master on line ${index + 1}.`);
    const { data: uom, error: uomError } = await admin.from("procurement_uoms").select("id, organization_id, uom_code, uom_name, status").eq("id", item.default_uom_id).eq("organization_id", organizationId).maybeSingle();
    if (uomError) throw uomError;
    if (!uom || uom.status !== "active") throw new Error(`Active UOM was not found on line ${index + 1}.`);
    const selectedMakes = Array.isArray(line.approved_makes) ? uniqueMakes(line.approved_makes) : [];
    await ensureSiteItemMakes(admin, organizationId, siteId, item.id, selectedMakes);
    rows.push({ line_key: text(line.line_key) || crypto.randomUUID(), item_id: item.id, specification: text(line.specification) || null, purpose: text(line.purpose) || null, make_brand: text(line.make_brand) || null, uom_id: uom.id, quantity, requested_by_employee_id: text(line.requested_by_employee_id) || null, required_by_date: text(line.required_by_date) || null, remarks: text(line.remarks) || null, sort_order: index + 1 });
    snapshots.push(selectedMakes);
  }
  return { rows, snapshots };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireProcurementPermission(request, REQUISITION_MODULE, "view");
    if ("response" in auth) return auth.response;
    const { id } = await context.params;
    const requisition = await loadRequisition(adminClient(), auth, id);
    if (!requisition) return jsonError("Requisition was not found.", 404);
    return NextResponse.json({ requisition });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Failed to load requisition." }, { status: 500 }); }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireProcurementPermission(request, REQUISITION_MODULE, "edit");
    if ("response" in auth) return auth.response;
    const { id } = await context.params;
    const admin = adminClient();
    const existing = await loadRequisition(admin, auth, id);
    if (!existing) return jsonError("Requisition was not found.", 404);
    if (!canEditStatus(existing.status)) return jsonError("Only Draft or Sent Back requisitions can be edited.", 409);
    const payload = await request.json().catch(() => ({}));
    const companyId = text(payload.company_id);
    const siteId = text(payload.site_id);
    const scope = await validateCompanySiteAccess(admin, auth, companyId, siteId);
    if ("error" in scope) return jsonError(scope.error || "Selected company/site is invalid.", scope.status || 400);
    const { rows: lines, snapshots } = await buildLineItems(admin, scope.organizationId, siteId, payload.items || []);
    const updatePayload = { company_id: companyId, site_id: siteId, requisition_date: text(payload.requisition_date) || existing.requisition_date, sent_back_reason: existing.status === "sent_back" ? existing.sent_back_reason : null, ...actorFields(auth.user), updated_at: new Date().toISOString() };
    const event = { event_type: "updated", event_note: "Draft details updated.", from_status: existing.status, to_status: existing.status, created_by: auth.user.id, created_by_name: updatePayload.updated_by_name, created_by_email: updatePayload.updated_by_email };
    const { error } = await admin.rpc("update_purchase_requisition_atomic", { p_requisition_id: id, p_organization_id: existing.organization_id, p_header: updatePayload, p_items: lines, p_snapshots: snapshots, p_event: event });
    if (error) throw error;
    try { await recordAuditEvent(admin, auth.user, { organizationId: existing.organization_id, companyId, siteId, moduleCode: REQUISITION_MODULE, entityType: "purchase_requisition", recordId: id, recordNumber: existing.requisition_number, action: "update", actionCategory: "update", activityLabel: "Updated Purchase Requisition", description: `Updated purchase requisition ${existing.requisition_number}.`, oldValues: existing, newValues: { updatePayload, items: lines, approved_makes: snapshots } }, request); } catch (auditError) { console.error("[Procurement Audit] Requisition update audit failed", auditError); }
    return NextResponse.json({ ok: true });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Failed to update requisition." }, { status: 500 }); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireProcurementPermission(request, REQUISITION_MODULE, "delete");
    if ("response" in auth) return auth.response;
    const { id } = await context.params;
    const admin = adminClient();
    const existing = await loadRequisition(admin, auth, id);
    if (!existing) return jsonError("Requisition was not found.", 404);
    const payload = await request.json().catch(() => ({}));
    const reason = text(payload.reason);
    if (reason.length < 10) return jsonError("Deletion reason must be at least 10 characters.", 400);
    const { count: rfqCount, error: rfqError } = await admin.from("procurement_rfqs").select("id", { count: "exact", head: true }).eq("source_requisition_id", id);
    if (rfqError) throw rfqError;
    const { count: rfqItemCount, error: rfqItemError } = await admin.from("procurement_rfq_items").select("id", { count: "exact", head: true }).eq("source_requisition_id", id);
    if (rfqItemError) throw rfqItemError;
    if ((rfqCount || 0) > 0 || (rfqItemCount || 0) > 0) return jsonError("This Indent cannot be deleted because procurement has already started.", 409);
    const actor = actorFields(auth.user);
    const { error: deleteError } = await admin.rpc("delete_purchase_requisition_atomic", { p_requisition_id: id, p_organization_id: existing.organization_id, p_actor: { user_id: auth.user.id, name: actor.updated_by_name, email: actor.updated_by_email }, p_reason: reason });
    if (deleteError) throw deleteError;
    const updatePayload = { status: "deleted", approval_status: "draft", ...actor, updated_at: new Date().toISOString() };
    try { await recordAuditEvent(admin, auth.user, { organizationId: existing.organization_id, companyId: existing.company_id, siteId: existing.site_id, moduleCode: REQUISITION_MODULE, entityType: "purchase_requisition", recordId: id, recordNumber: existing.requisition_number, action: "delete", actionCategory: "delete", activityLabel: "Deleted Purchase Requisition", description: `Deleted purchase requisition ${existing.requisition_number}.`, reason, oldValues: existing, newValues: updatePayload }, request); } catch (auditError) { console.error("[Procurement Audit] Requisition delete audit failed", auditError); }
    return NextResponse.json({ ok: true });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Failed to delete requisition." }, { status: 500 }); }
}
