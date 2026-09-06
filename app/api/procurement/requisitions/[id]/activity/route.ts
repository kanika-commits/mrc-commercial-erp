import { NextResponse } from "next/server";
import { adminClient, applyCompanySiteAccess, applyOrganizationAccess, jsonError, REQUISITION_MODULE, requireProcurementPermission, text } from "@/lib/serverProcurementAccess";

function actor(row: any) {
  return { name: text(row.actor_name || row.acted_by_name || row.approver_name_snapshot) || null, email: text(row.actor_email || row.acted_by_email || row.approver_email_snapshot) || null };
}

function human(value: any): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.map(human).filter((item) => item !== "—").join(", ") || "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return text(value.name || value.item_name || value.code || value.uom || value.file_name || value.original_file_name) || "—";
  return String(value);
}

function fieldLabel(field: string) {
  const labels: Record<string, string> = {
    item: "Material",
    item_name_snapshot: "Material",
    specification: "Specification",
    purpose: "Purpose / Requirement",
    quantity: "Quantity",
    uom: "UOM",
    uom_snapshot: "UOM",
    requested_by: "Requested By",
    requested_by_name_snapshot: "Requested By",
    required_by_date: "Required By",
    approved_makes: "Approved Makes",
    make_brand: "Approved Makes",
    remarks: "Remarks",
    file_name: "File",
    original_file_name: "File",
  };
  return labels[field] || field.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function materialName(entry: any, lineNames: Map<string, string>) {
  return text(entry.item_name) || (entry.line_key ? lineNames.get(entry.line_key) : "") || "";
}

function documentName(value: any, documentNames: Map<string, string>) {
  const direct = text(value?.original_file_name || value?.file_name || value?.name);
  if (direct) return direct;
  const id = text(value?.document_id || value?.id || value);
  return documentNames.get(id) || "Attachment";
}

function changeLines(changes: any, documentNames: Map<string, string>) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return [];
  const lines: { label: string; before?: string; after?: string; text?: string }[] = [];
  for (const [field, value] of Object.entries(changes)) {
    if (["id", "line_key", "item_id", "item_id_snapshot", "requisition_id", "workflow_version", "approval_cycle"].includes(field)) continue;
    if (field === "items" || field === "lines") continue;
    if (field === "approved_makes" && value && typeof value === "object") {
      const added = Array.isArray((value as any).added) ? (value as any).added.map(human).filter(Boolean) : [];
      const removed = Array.isArray((value as any).removed) ? (value as any).removed.map(human).filter(Boolean) : [];
      if (added.length) lines.push({ label: "Approved Makes", text: `Added: ${added.join(", ")}` });
      if (removed.length) lines.push({ label: "Approved Makes", text: `Removed: ${removed.join(", ")}` });
      continue;
    }
    if ((field.includes("document") || field.includes("attachment")) && value) {
      lines.push({ label: "File", text: documentName(value, documentNames) });
      continue;
    }
    if (value && typeof value === "object" && ("old" in (value as any) || "new" in (value as any))) {
      const before = human((value as any).old);
      const after = human((value as any).new);
      if (before !== after) lines.push({ label: fieldLabel(field), before, after });
      continue;
    }
    const next = human(value);
    if (next !== "—") lines.push({ label: fieldLabel(field), text: next });
  }
  return lines;
}

function lineCount(changes: any) {
  const candidates = [changes?.items, changes?.lines, changes?.newValues?.items, changes?.new_values?.items];
  const found = candidates.find(Array.isArray);
  return found ? found.length : null;
}

function titleFor(entry: any, name: string) {
  const item = name ? ` ${name}` : "";
  const titles: Record<string, string> = {
    requisition_created: "Indent Created",
    created: "Indent Created",
    requisition_submitted: "Indent Submitted for Approval",
    submitted: "Indent Submitted for Approval",
    requisition_resubmitted: "Indent Resubmitted for Approval",
    resubmitted: "Indent Resubmitted for Approval",
    requisition_deleted: "Indent Deleted",
    deleted: "Indent Deleted",
    line_added: `Added${item || " Material"}`,
    line_removed: `Removed${item || " Material"}`,
    line_edited: `Edited${item || " Material"}`,
    approval_line_edited: `Edited${item || " Material"}`,
    attachment_uploaded: "Added Attachment",
    attachment_removed: "Removed Attachment",
    line_approved: `Approved${item || " Material"}`,
    line_sent_back: `Sent Back${item || " Material"}`,
    line_rejected: `Rejected${item || " Material"}`,
  };
  return titles[entry.action_type] || fieldLabel(entry.action_type || "Activity");
}

function descriptionFor(entry: any, requisitionNumber: string, changes: any, documentNames: Map<string, string>) {
  const count = lineCount(changes);
  if (["requisition_created", "created"].includes(entry.action_type)) return count ? `Created ${requisitionNumber} with ${count} material line${count === 1 ? "" : "s"}.` : `Created ${requisitionNumber}.`;
  if (["requisition_submitted", "submitted"].includes(entry.action_type)) return "Submitted for approval.";
  if (["requisition_resubmitted", "resubmitted"].includes(entry.action_type)) return "Resubmitted for approval.";
  if (["attachment_uploaded", "attachment_removed"].includes(entry.action_type)) return documentName(changes?.document || changes?.document_id || changes?.attachment || changes?.attachment_id, documentNames);
  return "";
}

function normalize(entry: any, requisitionNumber: string, lineNames: Map<string, string>, documentNames: Map<string, string>) {
  const name = materialName(entry, lineNames);
  const changes = entry.changes || null;
  const context = entry.approval_layer ? `Level ${entry.approval_layer}${entry.approval_stage_name ? ` · ${entry.approval_stage_name}` : ""}` : entry.approval_stage_name || "";
  const lines = changeLines(changes, documentNames);
  const description = descriptionFor(entry, requisitionNumber, changes, documentNames);
  const note = text(entry.note);
  return {
    id: entry.id,
    source: entry.source,
    created_at: entry.created_at,
    action_type: entry.action_type,
    title: titleFor(entry, name),
    description,
    actor: entry.actor,
    material_name: name,
    item_code: entry.item_code || null,
    context,
    note: note && !note.includes("{") && !note.includes("[") ? note : "",
    changes: lines,
  };
}

function dedupe(entries: any[]) {
  const hasLineSteps = entries.some((entry) => entry.source === "line_approval_step");
  return entries.filter((entry) => {
    if (!hasLineSteps || entry.source !== "parent_approval_step") return true;
    return !["requisition_layer_approved", "requisition_sent_back", "requisition_rejected", "requisition_step_superseded"].includes(entry.action_type);
  });
}

export async function GET(request: Request, context: { params: Promise<any> }) {
  try {
    const auth = await requireProcurementPermission(request, REQUISITION_MODULE, "view");
    if ("response" in auth) return auth.response;
    const { id } = await context.params;
    const admin = adminClient();
    let query = applyOrganizationAccess(admin.from("purchase_requisitions").select("id, organization_id, company_id, site_id, requisition_number").eq("id", id).neq("status", "deleted").maybeSingle(), auth);
    if (!query) return jsonError("Requisition was not found.", 404);
    query = applyCompanySiteAccess(query, auth);
    if (!query) return jsonError("Requisition was not found.", 404);
    const { data: row, error: rowError } = await query;
    if (rowError) throw rowError;
    if (!row) return jsonError("Requisition was not found.", 404);

    const [activityResult, lineStepsResult, parentStepsResult, eventResult, itemResult, documentResult] = await Promise.all([
      admin.from("purchase_requisition_activity_events").select("*").eq("requisition_id", id),
      admin.from("purchase_requisition_line_approval_steps").select("*").eq("requisition_id", id).neq("status", "pending"),
      admin.from("purchase_requisition_approval_steps").select("*").eq("requisition_id", id).neq("status", "pending"),
      admin.from("purchase_requisition_events").select("*").eq("requisition_id", id),
      admin.from("purchase_requisition_items").select("line_key, item_name_snapshot, item_code_snapshot").eq("requisition_id", id),
      admin.from("purchase_requisition_documents").select("id, requisition_item_line_key, original_file_name, status").eq("requisition_id", id),
    ]);
    for (const result of [activityResult, lineStepsResult, parentStepsResult, eventResult, itemResult, documentResult]) if (result.error) throw result.error;

    const lineNames = new Map<string, string>();
    const lineCodes = new Map<string, string>();
    for (const item of itemResult.data || []) {
      if (item.line_key) lineNames.set(item.line_key, text(item.item_name_snapshot));
      if (item.line_key) lineCodes.set(item.line_key, text(item.item_code_snapshot));
    }
    const documentNames = new Map<string, string>();
    for (const document of documentResult.data || []) documentNames.set(document.id, text(document.original_file_name) || "Attachment");

    const structured = (activityResult.data || []).map((item: any) => ({ id: item.id, source: "activity", created_at: item.created_at, action_type: item.action_type, actor: actor(item), line_key: item.line_key, item_code: item.item_code_snapshot || (item.line_key ? lineCodes.get(item.line_key) : null), item_name: item.item_name_snapshot || (item.line_key ? lineNames.get(item.line_key) : null), changes: item.changes, approval_layer: item.approval_layer, approval_stage_name: item.approval_stage_name, note: item.note }));
    const lineSteps = (lineStepsResult.data || []).map((step: any) => ({ id: step.id, source: "line_approval_step", created_at: step.acted_at || step.updated_at || step.created_at, action_type: step.status === "approved" ? "line_approved" : step.status === "sent_back" ? "line_sent_back" : step.status === "rejected" ? "line_rejected" : "line_step_superseded", actor: actor(step), line_key: step.requisition_item_line_key, item_code: step.requisition_item_line_key ? lineCodes.get(step.requisition_item_line_key) : null, item_name: step.requisition_item_line_key ? lineNames.get(step.requisition_item_line_key) : null, changes: null, approval_layer: step.layer_number, approval_stage_name: step.stage_name, note: step.action_note }));
    const parentSteps = (parentStepsResult.data || []).map((step: any) => ({ id: step.id, source: "parent_approval_step", created_at: step.acted_at || step.updated_at || step.created_at, action_type: step.status === "approved" ? "requisition_layer_approved" : step.status === "sent_back" ? "requisition_sent_back" : step.status === "rejected" ? "requisition_rejected" : "requisition_step_superseded", actor: actor(step), line_key: null, item_code: null, item_name: null, changes: null, approval_layer: step.layer_number, approval_stage_name: step.stage_name, note: step.action_note }));
    const legacyEvents = (eventResult.data || []).filter((event: any) => !structured.some((item: any) => String(item.note || "") === String(event.event_note || "") && String(item.action_type || "").includes(String(event.event_type || "")))).map((event: any) => ({ id: event.id, source: "legacy_event", created_at: event.created_at, action_type: event.event_type, actor: { name: event.created_by_name || null, email: event.created_by_email || null }, line_key: null, item_code: null, item_name: null, changes: null, approval_layer: null, approval_stage_name: null, note: event.event_note }));

    const activities = dedupe([...structured, ...lineSteps, ...parentSteps, ...legacyEvents])
      .map((entry) => normalize(entry, row.requisition_number, lineNames, documentNames))
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    return NextResponse.json({ activities });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load requisition activity." }, { status: 500 });
  }
}
