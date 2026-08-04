import { loadLabourEditLockBlocker, type LabourAccess } from "@/app/api/labour/_shared";
import { monthStart } from "@/lib/labour/operations";

export async function loadScopedAttendanceImportBatch(access: LabourAccess, batchId: string) {
  const { data, error } = await access.admin
    .from("labour_attendance_import_batches")
    .select("*")
    .eq("id", batchId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (access.organizationScope !== null && !access.organizationScope.includes(data.organization_id)) return null;
  if (access.assignments.companyIds?.length && data.selected_company_id && !access.assignments.companyIds.includes(data.selected_company_id)) return null;
  if (access.assignments.siteIds?.length && data.selected_site_id && !access.assignments.siteIds.includes(data.selected_site_id)) return null;
  if (access.assignments.companyIds && !access.assignments.companyIds.length && access.assignments.siteIds && !access.assignments.siteIds.length) return null;
  return data;
}

export async function loadBatchRows(access: LabourAccess, batchId: string) {
  const { data, error } = await access.admin
    .from("labour_attendance_import_rows")
    .select("*")
    .eq("batch_id", batchId)
    .order("source_row_number")
    .order("source_column");
  if (error) throw error;
  return data || [];
}

export function isWithinAssignments(access: LabourAccess, companyId: string | null, siteId: string | null) {
  if (access.assignments.companyIds !== null && access.assignments.siteIds !== null && !access.assignments.companyIds.length && !access.assignments.siteIds.length) return false;
  if (access.assignments.companyIds?.length && companyId && !access.assignments.companyIds.includes(companyId)) return false;
  if (access.assignments.siteIds?.length && siteId && !access.assignments.siteIds.includes(siteId)) return false;
  return true;
}

export async function loadAttendanceImportEditBlockers(access: LabourAccess, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
  contractorProfileId?: string | null;
  attendanceDate: string;
  period?: any | null;
}) {
  const errors: string[] = [];
  const lockBlocker = await loadLabourEditLockBlocker(access, {
    organizationId: input.organizationId,
    companyId: input.companyId,
    siteId: input.siteId,
    contractorProfileId: input.contractorProfileId,
    attendanceDate: input.attendanceDate,
  });
  if (lockBlocker) errors.push(lockBlocker);

  let period = input.period || null;
  if (!period) {
    const periodMonth = monthStart(input.attendanceDate);
    if (periodMonth) {
      let periodQuery = access.admin
        .from("labour_attendance_periods")
        .select("id, status")
        .eq("organization_id", input.organizationId)
        .eq("company_id", input.companyId)
        .eq("site_id", input.siteId)
        .eq("period_month", periodMonth);
      periodQuery = input.contractorProfileId
        ? periodQuery.eq("contractor_profile_id", input.contractorProfileId)
        : periodQuery.is("contractor_profile_id", null);
      const { data, error } = await periodQuery.maybeSingle();
      if (error) throw error;
      period = data;
    }
  }

  if (period?.status === "submitted") errors.push("Attendance period is submitted.");
  if (period?.status === "finalized") errors.push("Attendance period is finalized.");
  if (period) {
    const { data: wagePeriod, error } = await access.admin
      .from("labour_wage_periods")
      .select("id, status")
      .eq("attendance_period_id", period.id)
      .maybeSingle();
    if (error) throw error;
    if (wagePeriod?.status === "finalized") errors.push("Finalized wage period prevents attendance changes.");
  }

  return errors;
}
