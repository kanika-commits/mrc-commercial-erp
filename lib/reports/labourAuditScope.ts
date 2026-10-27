export type LabourScopeAssignment = {
  company_id: string | null;
  site_id: string | null;
};

export type LabourAuditScope = {
  companyId: string | null;
  siteId: string | null;
};

/** Assignment overlap is evaluated without treating sites as company-owned. */
export function assignmentCoversScope(
  assignment: LabourScopeAssignment,
  scope: LabourAuditScope,
) {
  return (
    (!scope.companyId || assignment.company_id === null || assignment.company_id === scope.companyId) &&
    (!scope.siteId || assignment.site_id === null || assignment.site_id === scope.siteId)
  );
}

export function actorAssignmentsCoverScope(
  assignments: LabourScopeAssignment[],
  scope: LabourAuditScope,
) {
  return assignments.some((assignment) => assignmentCoversScope(assignment, scope));
}

export function auditRowMatchesScope(
  row: { company_id?: string | null; site_id?: string | null },
  scope: LabourAuditScope,
) {
  return (
    (!scope.companyId || row.company_id === scope.companyId) &&
    (!scope.siteId || row.site_id === scope.siteId)
  );
}

export function filterAuditRowsByScope<T extends { company_id?: string | null; site_id?: string | null }>(
  rows: T[],
  scope: LabourAuditScope,
) {
  return rows.filter((row) => auditRowMatchesScope(row, scope));
}
