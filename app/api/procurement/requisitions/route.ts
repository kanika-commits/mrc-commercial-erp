import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/auditEvent";
import { adminClient, actorFields, applyCompanySiteAccess, applyOrganizationAccess, createActorFields, jsonError, REQUISITION_MODULE, requireProcurementPermission, text, validateCompanySiteAccess } from "@/lib/serverProcurementAccess";

function dateText(value: unknown) { return text(value); }
function validPriority(value: unknown) { const next = text(value) || "Normal"; return ["Normal", "Urgent", "Critical"].includes(next) ? next : "Normal"; }
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

function lineApprovalSummary(items: any[]) {
  const counts = { approved: 0, pending: 0, sent_back: 0, rejected: 0, superseded: 0, unknown: 0 };
  const pendingByLayer = new Map<number, { count: number; stageName: string; approver: string }>();
  for (const item of items || []) {
    const state = item.line_approval_state;
    if (!state) { counts.unknown += 1; continue; }
    const status = text(state.approval_status);
    if (status === "approved" || state.final_approved_at) { counts.approved += 1; continue; }
    if (status === "pending") {
      counts.pending += 1;
      const layer = Number(state.current_approval_layer || item.current_line_approval_step?.layer_number || 0);
      if (layer > 0) {
        const current = pendingByLayer.get(layer) || { count: 0, stageName: "", approver: "" };
        current.count += 1;
        current.stageName = current.stageName || text(item.current_line_approval_step?.stage_name);
        current.approver = current.approver || text(item.current_line_approval_step?.approver_name_snapshot || item.current_line_approval_step?.approver_email_snapshot);
        pendingByLayer.set(layer, current);
      }
      continue;
    }
    if (status === "sent_back") { counts.sent_back += 1; continue; }
    if (status === "rejected") { counts.rejected += 1; continue; }
    if (status === "superseded") { counts.superseded += 1; continue; }
    counts.unknown += 1;
  }
  const total = items.length;
  if (!total) return null;
  if (counts.approved === total) return { status: "Approved", detail: "All material lines approved." };
  const parts = [
    counts.approved ? `${counts.approved} Approved` : "",
    counts.pending ? `${counts.pending} Pending` : "",
    counts.sent_back ? `${counts.sent_back} Sent Back` : "",
    counts.rejected ? `${counts.rejected} Rejected` : "",
    counts.superseded ? `${counts.superseded} Superseded` : "",
  ].filter(Boolean);
  const layerParts = Array.from(pendingByLayer.entries()).sort(([a], [b]) => a - b).map(([layer, value]) => `${value.count} ${value.count === 1 ? "line" : "lines"} waiting for Level ${layer}`);
  const stageParts = Array.from(pendingByLayer.entries()).sort(([a], [b]) => a - b).map(([layer, value]) => {
    const stage = value.stageName || `Level ${layer}`;
    return value.approver ? `${stage} — ${value.approver}` : stage;
  });
  return {
    status: parts.length ? parts.join(" · ") : "Pending Approval",
    detail: [...layerParts, ...stageParts].filter(Boolean).join(" · "),
  };
}

function lineApprovalDetails(items: any[], parent: any) {
  return (items || []).map((item: any) => {
    const state = item.line_approval_state;
    const step = item.current_line_approval_step;
    const status = text(state?.approval_status);
    const layer = Number(state?.current_approval_layer || step?.layer_number || 0);
    const approved = status === "approved" || state?.final_approved_at;
    const label = approved ? "Approved" : status === "pending" && layer > 0 ? (parent.procurement_flow === "billing_engineer" ? "Pending Requisition Approval" : `Pending Level ${layer}`) : status === "sent_back" ? "Sent Back" : status === "rejected" ? "Rejected" : status === "superseded" ? "Superseded" : state ? labelizeLineStatus(status) : parent.procurement_flow === "billing_engineer" ? (parent.status === "sent_back" ? "Sent Back" : parent.status === "rejected" ? "Rejected" : parent.status === "approved" ? "Approved" : "Draft") : parent.status === "pending_approval" ? `Pending Level ${Number(parent.current_approval_layer || 1)}` : parent.status === "sent_back" ? "Sent Back" : parent.status === "rejected" ? "Rejected" : parent.status === "approved" ? "Approved" : "Draft";
    const stage = status === "pending" ? text(step?.stage_name) : "";
    const approver = status === "pending" ? text(step?.approver_name_snapshot || step?.approver_email_snapshot) : "";
    return {
      line_key: item.line_key,
      item_name: item.item_name_snapshot,
      item_code: item.item_code_snapshot,
      status: label,
      detail: [stage, approver].filter(Boolean).join(" — "),
    };
  });
}

function labelizeLineStatus(value: string) {
  return value ? value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Pending Approval";
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
    rows.push({ line_key: text(line.line_key) || crypto.randomUUID(), item_id: item.id, item_code_snapshot: item.item_code, item_name_snapshot: item.item_name, specification: text(line.specification) || null, purpose: text(line.purpose) || null, make_brand: text(line.make_brand) || null, uom_id: uom.id, uom_snapshot: uom.uom_code, quantity, requested_by_employee_id: text(line.requested_by_employee_id) || null, requested_by_name_snapshot: text(line.requested_by_name_snapshot) || null, required_by_date: dateText(line.required_by_date) || null, remarks: text(line.remarks) || null, sort_order: index + 1 });
    snapshots.push(selectedMakes);
  }
  return { rows, snapshots };
}

export async function GET(request: Request) {
  try {
    const auth = await requireProcurementPermission(request, REQUISITION_MODULE, "view");
    if ("response" in auth) return auth.response;
    const { searchParams } = new URL(request.url);
    const admin = adminClient();
    const isApprovalAdmin = auth.isGlobalAccess === true || (auth.roleCodes || []).includes("super_admin") || (auth.roleCodes || []).includes("platform_owner");
    let query = isApprovalAdmin ? admin.from("purchase_requisitions").select("*, company:companies(id, company_name, company_code), site:sites(id, site_name, site_code), items:purchase_requisition_items(*, approved_makes:purchase_requisition_item_approved_makes(*))").neq("status", "deleted").order("created_at", { ascending: false }) : applyOrganizationAccess(admin.from("purchase_requisitions").select("*, company:companies(id, company_name, company_code), site:sites(id, site_name, site_code), items:purchase_requisition_items(*, approved_makes:purchase_requisition_item_approved_makes(*))").neq("status", "deleted").order("created_at", { ascending: false }), auth);
    if (!query) return NextResponse.json({ requisitions: [], total_all: 0 });
    query = applyCompanySiteAccess(query, auth);
    if (!query) return NextResponse.json({ requisitions: [], total_all: 0 });
    const companyId = text(searchParams.get("company_id"));
    const siteId = text(searchParams.get("site_id"));
    const status = text(searchParams.get("status"));
    const approvalStatus = text(searchParams.get("approval_status"));
    const priority = text(searchParams.get("priority"));
    const queue = text(searchParams.get("queue"));
    const currentApproverQueue = status === "pending_approval" && queue === "my_current" && !isApprovalAdmin;
    if (companyId) query = query.eq("company_id", companyId);
    if (siteId) query = query.eq("site_id", siteId);
    if (status && status !== "all") query = query.eq("status", status);
    if (approvalStatus && approvalStatus !== "all") query = query.eq("approval_status", approvalStatus);
    if (priority && priority !== "all") query = query.eq("priority", priority);
    const { data, error } = await query;
    if (error) throw error;
    let rows = data || [];
    if (rows.length) {
      const { data: lineStates, error: lineStateError } = await admin.from("purchase_requisition_line_approval_state").select("requisition_id, requisition_item_line_key, workflow_version, submission_cycle, current_approval_layer, approval_status, final_approved_at").in("requisition_id", rows.map((row: any) => row.id));
      if (lineStateError) throw lineStateError;
      const { data: lineSteps, error: lineStepError } = await admin.from("purchase_requisition_line_approval_steps").select("requisition_id, requisition_item_line_key, workflow_version, submission_cycle, layer_number, stage_name, approver_user_id, approver_name_snapshot, approver_email_snapshot, status").in("requisition_id", rows.map((row: any) => row.id));
      if (lineStepError) throw lineStepError;
      const lineStateByRequisition = new Map<string, any[]>();
      for (const state of lineStates || []) lineStateByRequisition.set(state.requisition_id, [...(lineStateByRequisition.get(state.requisition_id) || []), state]);
      const lineStepsByKey = new Map<string, any[]>();
      for (const step of lineSteps || []) { const key = `${step.requisition_id}:${step.requisition_item_line_key}`; lineStepsByKey.set(key, [...(lineStepsByKey.get(key) || []), step]); }
      const documentsByLineKey = new Map<string, any[]>();
      if (currentApproverQueue) {
        const { data: documents, error: documentError } = await admin.from("purchase_requisition_documents").select("id, requisition_id, requisition_item_line_key, original_file_name, mime_type, size_bytes, uploaded_at, status").in("requisition_id", rows.map((row: any) => row.id)).eq("status", "active").not("requisition_item_line_key", "is", null).order("uploaded_at", { ascending: false });
        if (documentError) throw documentError;
        for (const document of documents || []) {
          const key = `${document.requisition_id}:${document.requisition_item_line_key}`;
          documentsByLineKey.set(key, [...(documentsByLineKey.get(key) || []), document]);
        }
      }
      rows = rows.map((row: any) => {
        const states = lineStateByRequisition.get(row.id) || [];
        const mappedItems = (row.items || []).map((item: any) => {
          const state = states.find((candidate: any) => candidate.requisition_item_line_key === item.line_key);
          const steps = lineStepsByKey.get(`${row.id}:${item.line_key}`) || [];
          const currentStep = state ? steps.find((step: any) => step.workflow_version === state.workflow_version && step.submission_cycle === state.submission_cycle && step.layer_number === state.current_approval_layer) : null;
          return { ...item, line_approval_state: state || null, current_line_approval_step: currentStep || null, line_has_next_layer: Boolean(state && steps.some((step: any) => step.workflow_version === state.workflow_version && step.submission_cycle === state.submission_cycle && Number(step.layer_number) > Number(state.current_approval_layer))), line_actionable: Boolean(state?.approval_status === "pending" && currentStep?.status === "pending" && (currentStep?.approver_user_id === auth.user.id || isApprovalAdmin)), line_attachments: currentApproverQueue ? (documentsByLineKey.get(`${row.id}:${item.line_key}`) || []) : undefined };
        });
        const actionableItems = mappedItems.filter((item: any) => item.line_actionable);
        return { ...row, items: currentApproverQueue && states.length > 0 ? actionableItems : mappedItems, total_item_count: mappedItems.length, line_workflow_initialized: states.length > 0, actionable_line_count: actionableItems.length, workflow_line_details: lineApprovalDetails(mappedItems, row) };
      });
      const { data: workflowSteps, error: workflowError } = await admin
        .from("purchase_requisition_approval_steps")
        .select("requisition_id, workflow_version, submission_cycle, layer_number, stage_name, approver_name_snapshot, approver_email_snapshot, status")
        .in("requisition_id", rows.map((row: any) => row.id));
      if (workflowError) throw workflowError;
      const stepsByRequisition = new Map<string, any[]>();
      for (const step of workflowSteps || []) {
        const steps = stepsByRequisition.get(step.requisition_id) || [];
        steps.push(step);
        stepsByRequisition.set(step.requisition_id, steps);
      }
      rows = rows.map((row: any) => {
        if (row.procurement_flow === "billing_engineer" && row.status === "approved" && row.purchase_pending_at && !row.purchase_taken_up_at) {
          return { ...row, workflow_display_status: "Purchase Pending", workflow_display_detail: `Billing Engineer approved ${row.approved_by_name || "the requirement"} — awaiting Purchase take-up.` };
        }
        if (row.status === "approved" || row.status === "sent_back" || row.status === "rejected" || row.status === "draft") {
          return { ...row, workflow_display_status: row.status === "approved" ? "Approved" : row.status === "sent_back" ? "Sent Back" : row.status === "rejected" ? "Rejected" : "Draft" };
        }
        if (row.status === "pending_approval" && row.line_workflow_initialized) {
          const summary = lineApprovalSummary(row.items || []);
          if (summary) return { ...row, workflow_display_status: summary.status, workflow_display_detail: summary.detail };
        }
        const snapshotSteps = (stepsByRequisition.get(row.id) || []).filter((step: any) => step.workflow_version === row.approval_workflow_version);
        const latestCycle = Math.max(0, ...snapshotSteps.map((step: any) => Number(step.submission_cycle || 0)));
        const currentSteps = snapshotSteps.filter((step: any) => Number(step.submission_cycle) === latestCycle);
        const currentStep = currentSteps.find((step: any) => step.layer_number === row.current_approval_layer && step.status === "pending");
        if (row.status !== "pending_approval" || !row.approval_workflow_version || !currentStep) return { ...row, workflow_display_status: "Pending Approval" };
        const layer = Number(currentStep.layer_number);
        const approver = currentStep.approver_name_snapshot || currentStep.approver_email_snapshot || "Assigned approver";
        return {
          ...row,
          workflow_display_status: layer > 1 ? `Level ${layer - 1} Approved • Waiting for Level ${layer}` : "Waiting for Level 1",
          workflow_display_detail: `${currentStep.stage_name} — ${approver}`,
        };
      });
    }
    if (status === "pending_approval" && rows.length) {
      const lineRows = rows.filter((row: any) => row.line_workflow_initialized);
      const legacyRows = rows.filter((row: any) => !row.line_workflow_initialized);
      rows = currentApproverQueue ? lineRows.filter((row: any) => row.actionable_line_count > 0) : lineRows;
      let legacyQueueRows: any[] = [];
      if (legacyRows.length) {
      const { data: steps, error: stepsError } = await admin.from("purchase_requisition_approval_steps").select("*").in("requisition_id", legacyRows.map((row: any) => row.id)).eq("status", "pending");
      if (stepsError) throw stepsError;
      const currentSteps = new Map<string, any>();
      for (const step of steps || []) {
        const row = legacyRows.find((candidate: any) => candidate.id === step.requisition_id);
        if (!row || step.submission_cycle !== Math.max(...(steps || []).filter((x: any) => x.requisition_id === row.id).map((x: any) => x.submission_cycle))) continue;
        if (step.layer_number === row.current_approval_layer) { const pendingLayers = (steps || []).filter((candidate: any) => candidate.requisition_id === row.id && candidate.submission_cycle === step.submission_cycle); currentSteps.set(row.id, { ...step, is_final: pendingLayers.every((candidate: any) => Number(candidate.layer_number) <= Number(step.layer_number)) }); }
      }
      legacyQueueRows = legacyRows.filter((row: any) => currentSteps.has(row.id) && (!currentApproverQueue || currentSteps.get(row.id).approver_user_id === auth.user.id)).map((row: any) => ({ ...row, current_approval_step: currentSteps.get(row.id), can_act: currentSteps.get(row.id).approver_user_id === auth.user.id }));
      }
      rows = [...rows, ...legacyQueueRows];
    }
    const search = text(searchParams.get("search")).toLowerCase();
    rows = rows.filter((row: any) => !search || [row.requisition_number, row.purpose, row.requested_by_name, row.company?.company_name, row.site?.site_name].join(" ").toLowerCase().includes(search));
    return NextResponse.json({ requisitions: rows, total_all: (data || []).length, can_view_all: auth.isGlobalAccess === true || (auth.roleCodes || []).includes("platform_owner") });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load requisitions." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireProcurementPermission(request, REQUISITION_MODULE, "add");
    if ("response" in auth) return auth.response;
    const payload = await request.json().catch(() => ({}));
    const admin = adminClient();
    const companyId = text(payload.company_id);
    const siteId = text(payload.site_id);
    if (!companyId) return jsonError("Company is required.", 400);
    if (!siteId) return jsonError("Site is required.", 400);
    const scope = await validateCompanySiteAccess(admin, auth, companyId, siteId);
    if ("error" in scope) return jsonError(scope.error || "Selected company/site is invalid.", scope.status || 400);
    const requisitionDate = dateText(payload.requisition_date) || new Date().toISOString().slice(0, 10);
    const { rows: lines, snapshots } = await buildLineItems(admin, scope.organizationId, siteId, payload.items || []);
    const purpose = text(payload.purpose) || null;
    const header = { organization_id: scope.organizationId, requisition_date: requisitionDate, company_id: companyId, site_id: siteId, purpose, requested_by_user_id: auth.user.id, requested_by_name: text(auth.user.user_metadata?.full_name || auth.user.email), requested_by_email: auth.user.email || null, ...createActorFields(auth.user) };
    const event = { event_type: "created", event_note: "Draft created.", from_status: null, to_status: "draft", created_by: auth.user.id, created_by_name: header.created_by_name, created_by_email: header.created_by_email };
    const { data: result, error } = await admin.rpc("create_purchase_requisition_atomic", { p_header: header, p_items: lines, p_snapshots: snapshots, p_event: event });
    if (error) throw error;
    const requisitionId = result?.id;
    const requisitionNumber = result?.requisition_number;
    const { error: flowError } = await admin.from("purchase_requisitions").update({ procurement_flow: "billing_engineer" }).eq("id", requisitionId).eq("status", "draft");
    if (flowError) throw flowError;
    try { await recordAuditEvent(admin, auth.user, { organizationId: scope.organizationId, companyId, siteId, moduleCode: REQUISITION_MODULE, entityType: "purchase_requisition", recordId: requisitionId, recordNumber: requisitionNumber, action: "create", actionCategory: "create", activityLabel: "Created Purchase Requisition", description: `Created purchase requisition ${requisitionNumber}.`, newValues: { header, items: lines, approved_makes: snapshots } }, request); } catch (auditError) { console.error("[Procurement Audit] Requisition create audit failed", auditError); }
    return NextResponse.json({ requisition_id: requisitionId, requisition_number: requisitionNumber });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to save requisition." }, { status: 500 });
  }
}
