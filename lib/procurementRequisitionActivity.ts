import { text } from "@/lib/serverProcurementAccess";

type ActivityInput = {
  organizationId: string;
  companyId: string;
  siteId: string;
  requisitionId: string;
  requisitionNumber: string;
  actionType: string;
  actor?: { user_id?: string | null; name?: string | null; email?: string | null };
  line?: any;
  changes?: Record<string, unknown> | null;
  workflowVersion?: number | string | null;
  approvalCycle?: number | string | null;
  approvalLayer?: number | string | null;
  approvalStageName?: string | null;
  note?: string | null;
};

export function lineSnapshot(line: any) {
  if (!line) return null;
  return {
    line_key: text(line.line_key),
    item_id_snapshot: text(line.item_id) || null,
    item_code_snapshot: text(line.item_code_snapshot || line.item_code) || null,
    item_name_snapshot: text(line.item_name_snapshot || line.item_name) || null,
  };
}

export function usefulLineSnapshot(line: any, makes: string[] = []) {
  return {
    item: {
      id: text(line.item_id) || null,
      code: text(line.item_code_snapshot || line.item_code) || null,
      name: text(line.item_name_snapshot || line.item_name) || null,
    },
    specification: text(line.specification) || null,
    purpose: text(line.purpose) || null,
    quantity: line.quantity ?? null,
    uom: {
      id: text(line.uom_id) || null,
      name: text(line.uom_snapshot || line.uom_code) || null,
    },
    requested_by: {
      id: text(line.requested_by_employee_id) || null,
      name: text(line.requested_by_name_snapshot) || null,
    },
    required_by_date: text(line.required_by_date) || null,
    approved_makes: makes,
    remarks: text(line.remarks) || null,
  };
}

function comparable(value: unknown) {
  if (value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return value;
}

function changed(oldValue: unknown, newValue: unknown) {
  return JSON.stringify(comparable(oldValue)) !== JSON.stringify(comparable(newValue));
}

export function diffLineChanges(before: any, after: any, beforeMakes: string[] = [], afterMakes: string[] = []) {
  const changes: Record<string, unknown> = {};
  const fields = [
    ["item", { id: text(before?.item_id) || null, code: text(before?.item_code_snapshot) || null, name: text(before?.item_name_snapshot) || null }, { id: text(after?.item_id) || null, code: text(after?.item_code_snapshot || after?.item_code) || null, name: text(after?.item_name_snapshot || after?.item_name) || null }],
    ["specification", text(before?.specification) || null, text(after?.specification) || null],
    ["purpose", text(before?.purpose) || null, text(after?.purpose) || null],
    ["quantity", before?.quantity ?? null, after?.quantity ?? null],
    ["uom", { id: text(before?.uom_id) || null, name: text(before?.uom_snapshot) || null }, { id: text(after?.uom_id) || null, name: text(after?.uom_snapshot || after?.uom_code) || null }],
    ["requested_by", { id: text(before?.requested_by_employee_id) || null, name: text(before?.requested_by_name_snapshot) || null }, { id: text(after?.requested_by_employee_id) || null, name: text(after?.requested_by_name_snapshot) || null }],
    ["required_by_date", text(before?.required_by_date) || null, text(after?.required_by_date) || null],
    ["remarks", text(before?.remarks) || null, text(after?.remarks) || null],
  ] as const;
  for (const [field, oldValue, newValue] of fields) if (changed(oldValue, newValue)) changes[field] = { old: oldValue, new: newValue };
  const beforeSet = new Set(beforeMakes.map((make) => make.toLowerCase()));
  const afterSet = new Set(afterMakes.map((make) => make.toLowerCase()));
  const added = afterMakes.filter((make) => !beforeSet.has(make.toLowerCase()));
  const removed = beforeMakes.filter((make) => !afterSet.has(make.toLowerCase()));
  if (added.length || removed.length) changes.approved_makes = { added, removed };
  return changes;
}

export function hasChanges(changes: Record<string, unknown> | null | undefined) {
  return Boolean(changes && Object.keys(changes).length);
}

export function makeNames(line: any) {
  return (line?.approved_makes || [])
    .slice()
    .sort((a: any, b: any) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((make: any) => text(make.make_name_snapshot || make))
    .filter(Boolean);
}

export async function insertRequisitionActivity(admin: any, input: ActivityInput) {
  const snapshot = lineSnapshot(input.line);
  const actor = input.actor || {};
  const { error } = await admin.from("purchase_requisition_activity_events").insert({
    organization_id: input.organizationId,
    company_id: input.companyId,
    site_id: input.siteId,
    requisition_id: input.requisitionId,
    requisition_number_snapshot: input.requisitionNumber,
    line_key: snapshot?.line_key || null,
    item_id_snapshot: snapshot?.item_id_snapshot || null,
    item_code_snapshot: snapshot?.item_code_snapshot || null,
    item_name_snapshot: snapshot?.item_name_snapshot || null,
    action_type: input.actionType,
    changes: input.changes || null,
    actor_user_id: text(actor.user_id) || null,
    actor_name: text(actor.name) || null,
    actor_email: text(actor.email) || null,
    workflow_version: input.workflowVersion ? Number(input.workflowVersion) : null,
    approval_cycle: input.approvalCycle ? Number(input.approvalCycle) : null,
    approval_layer: input.approvalLayer ? Number(input.approvalLayer) : null,
    approval_stage_name: text(input.approvalStageName) || null,
    note: text(input.note) || null,
  });
  if (error) throw error;
}
