export function actionableLineApprovers(states, steps, { requisitionId, actorId, organizationId, companyId, siteId, activeIds = new Set(), permittedIds = new Set() } = {}) {
  const valid = (states || []).filter((s) => s.requisition_id === requisitionId && s.approval_status === "pending");
  const rows = (steps || []).filter((step) => valid.some((s) => s.requisition_item_line_key === step.requisition_item_line_key && s.workflow_version === step.workflow_version && s.submission_cycle === step.submission_cycle && Number(s.current_approval_layer) === Number(step.layer_number)) && step.status === "pending");
  const ids = new Set();
  for (const row of rows) if (row.approver_user_id !== actorId && (!activeIds.size || activeIds.has(row.approver_user_id)) && (!permittedIds.size || permittedIds.has(row.approver_user_id)) && (!organizationId || row.organization_id === organizationId) && (!companyId || !row.company_id || row.company_id === companyId) && (!siteId || !row.site_id || row.site_id === siteId)) ids.add(row.approver_user_id);
  return { recipientIds: [...ids], rows };
}

export function groupedLineCycle(rows) {
  return [...new Set(rows.map((r) => `${r.workflow_version}:${r.submission_cycle}:${r.layer_number}`))].sort().join("|");
}

export function extractApprovalLevel(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.approval_layers)) return null;
  const levels = snapshot.approval_layers.map((l) => l.level ?? l.layer_number ?? l.approval_level).map(Number).filter(Number.isFinite);
  return levels.length ? Math.min(...levels) : null;
}

export function eventIdentity({ eventType, entityType, entityId, cycleId, stage }) {
  return [eventType, entityType, entityId, `${cycleId}:${stage || "default"}`].join(":");
}
