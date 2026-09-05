import { NextResponse } from "next/server";
import {
  actorFields,
  audit,
  findOrCreateAttendancePeriod,
  jsonError,
  loadEligibleDeployments,
  originatingAttendanceSystem,
  requireLabourPermission,
  resolveSiteAttendanceSystem,
  validateLabourOperationalCompanySite,
  isGlobalOrSuperAdmin,
  hasLabourPermission,
  loadResolvedLabourSitePairs,
} from "@/app/api/labour/_shared";
import { normalizeText } from "@/lib/labour/constants";
import { buildLabourAttendanceUpsertPayload, isoDate } from "@/lib/labour/operations";
import { dateText, numberOrNull } from "@/lib/labour/v2";

const SHIFT_STATUSES = ["present", "absent"] as const;
const WORK_TYPES = ["productive", "non_productive"] as const;
const EDITABLE_SUBMISSION_STATUSES = ["draft", "sent_back_by_pm", "sent_back_by_ho"];

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

function actorName(access: any) {
  return access.auth.user.user_metadata?.full_name || access.auth.user.user_metadata?.name || access.auth.user.email || "Unknown User";
}

function optionalWholeHours(value: unknown) {
  if (value === null || value === undefined || value === "") return { ok: true, minutes: null };
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) return { ok: false, minutes: null };
  const hours = Number(raw);
  if (!Number.isSafeInteger(hours) || hours < 0) return { ok: false, minutes: null };
  return { ok: true, minutes: hours * 60 };
}

function nullableShiftStatus(value: unknown) {
  const next = text(value);
  if (!next) return null;
  return SHIFT_STATUSES.includes(next as any) ? next : "__invalid__";
}

function shiftStatusToBoolean(value: string | null) {
  if (value === "present") return true;
  if (value === "absent") return false;
  return null;
}

function booleanToShiftStatus(value: unknown) {
  if (value === true) return "present";
  if (value === false) return "absent";
  return null;
}

function summaryStatus(first: string | null, second: string | null) {
  if (first === "present" && second === "present") return "present";
  if (first === "absent" && second === "absent") return "absent";
  if (first || second) return "half_day";
  return "not_deployed";
}

function contractorName(contractor: any) {
  return contractor?.vendors?.vendor_name || contractor?.contractor_code || "Contractor";
}

function employeeDepartment(employee: any) {
  const department = Array.isArray(employee?.hr_departments) ? employee.hr_departments[0] : employee?.hr_departments;
  return department?.department_name || "No Department";
}

function employeeLabel(employee: any) {
  if (!employee) return "Engineer";
  return `${employee.employee_name || "Engineer"} — ${employeeDepartment(employee)}`;
}

function moneyLabel(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "Not Set";
  return `₹${amount.toLocaleString("en-IN")}`;
}

function workerFromDeployment(deployment: any) {
  return Array.isArray(deployment.labour_workers) ? deployment.labour_workers[0] : deployment.labour_workers;
}

function tradeFromDeployment(deployment: any) {
  return Array.isArray(deployment.labour_trades) ? deployment.labour_trades[0] : deployment.labour_trades;
}

function contractorFromDeployment(deployment: any) {
  return Array.isArray(deployment.labour_contractor_profiles) ? deployment.labour_contractor_profiles[0] : deployment.labour_contractor_profiles;
}

async function loadBaseLookups(access: any) {
  return loadResolvedLabourSitePairs(access);
}

async function validateEngineerDailyCompanySite(access: any, organizationId: string | null | undefined, companyId: string, siteId: string) {
  return validateLabourOperationalCompanySite(access, organizationId, companyId, siteId);
}

async function hasExistingEngineerDailyOrigin(access: any, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
  workDate: string;
}) {
  const { data, error } = await access.admin
    .from("labour_site_ins")
    .select("id, originating_attendance_system")
    .eq("organization_id", input.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("site_in_date", input.workDate)
    .eq("status", "active")
    .limit(1);
  if (error && error.code !== "42703") throw error;
  if (error) return false;
  return (data || []).some((row: any) => (originatingAttendanceSystem(row.originating_attendance_system) || "site_in_engineer") === "site_in_engineer");
}

async function resolveContext(access: any, input: any) {
  const companyId = text(input.companyId || input.company_id);
  const siteId = text(input.siteId || input.site_id);
  const workDate = isoDate(input.workDate || input.work_date || input.attendance_date);
  const requestedOrganizationId = text(input.organizationId || input.organization_id) || (Array.isArray(access.organizationScope) ? access.organizationScope[0] : null);
  if (!companyId) return { error: "Company is required.", status: 400 };
  if (!siteId) return { error: "Site is required.", status: 400 };
  if (!workDate) return { error: "Date is required.", status: 400 };
  const scope = await validateEngineerDailyCompanySite(access, requestedOrganizationId, companyId, siteId);
  if ("error" in scope) return { error: scope.error || "Selected company/site is not available.", status: 403 };
  const system = await resolveSiteAttendanceSystem(access, { organizationId: scope.organizationId, companyId, siteId });
  if (!system.ok) return { error: system.message, status: 403 };
  if (system.attendanceSystem !== "site_in_engineer") {
    const existingOrigin = await hasExistingEngineerDailyOrigin(access, { organizationId: scope.organizationId, companyId, siteId, workDate });
    if (!existingOrigin) return { error: "This site uses Standard Labour Attendance. Engineer Daily Labour is not required.", status: 403 };
  }
  return { organizationId: scope.organizationId, companyId, siteId, workDate };
}

async function loadEngineerOptions(access: any, context: any) {
  const { data, error } = await access.admin
    .from("labour_site_in_engineer_assignments")
    .select("engineer_employee_id, engineer_user_id, hr_employees(id, employee_name, user_id, status, department_id, hr_departments(department_name))")
    .eq("organization_id", context.organizationId)
    .eq("company_id", context.companyId)
    .eq("site_id", context.siteId)
    .eq("site_in_date", context.workDate)
    .eq("status", "active");
  if (error) throw error;
  const engineers = new Map<string, any>();
  for (const assignment of data || []) {
    const employee = Array.isArray(assignment.hr_employees) ? assignment.hr_employees[0] : assignment.hr_employees;
    if (!employee || employee.status !== "active") continue;
    engineers.set(employee.id, {
      id: employee.id,
      employee_name: employee.employee_name,
      department_name: employeeDepartment(employee),
      user_id: employee.user_id || assignment.engineer_user_id || null,
      has_erp_login: Boolean(employee.user_id || assignment.engineer_user_id),
      label: employeeLabel(employee),
    });
  }
  return Array.from(engineers.values()).sort((first, second) => first.label.localeCompare(second.label));
}

async function resolveEngineerContext(access: any, context: any, requestedEngineerId?: string | null) {
  const admin = isGlobalOrSuperAdmin(access);
  if (admin) {
    const engineers = await loadEngineerOptions(access, context);
    const selectedId = text(requestedEngineerId);
    return { admin: true, engineers, engineer: selectedId ? engineers.find((engineer: any) => engineer.id === selectedId) || null : null };
  }
  if (requestedEngineerId) return { admin: false, engineers: [], engineer: null, error: "Engineers can access only their own Daily Labour page." };
  const { data, error } = await access.admin
    .from("hr_employees")
    .select("id, employee_name, user_id, department_id, hr_departments(department_name)")
    .eq("organization_id", context.organizationId)
    .eq("company_id", context.companyId)
    .eq("site_id", context.siteId)
    .eq("user_id", access.auth.user.id)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  if (!data) return { admin: false, engineers: [], engineer: null, error: "Your ERP login is not linked to an active engineer employee for this company/site." };
  return {
    admin: false,
    engineers: [],
    engineer: {
      id: data.id,
      employee_name: data.employee_name,
      department_name: employeeDepartment(data),
      user_id: data.user_id,
      has_erp_login: true,
      label: employeeLabel(data),
    },
  };
}

async function loadAssignedRows(access: any, context: any, engineerId: string, contractorProfileId?: string | null) {
  let assignmentQuery = access.admin
    .from("labour_site_in_engineer_assignments")
    .select("*, labour_site_ins(id, site_in_time, status)")
    .eq("organization_id", context.organizationId)
    .eq("company_id", context.companyId)
    .eq("site_id", context.siteId)
    .eq("site_in_date", context.workDate)
    .eq("engineer_employee_id", engineerId)
    .eq("status", "active");
  if (contractorProfileId) assignmentQuery = assignmentQuery.eq("contractor_profile_id", contractorProfileId);
  const { data: assignments, error } = await assignmentQuery;
  if (error) throw error;
  const deploymentIds = Array.from(new Set((assignments || []).map((row: any) => row.deployment_id).filter(Boolean)));
  const workerIds = Array.from(new Set((assignments || []).map((row: any) => row.labour_worker_id).filter(Boolean)));
  if (!deploymentIds.length || !workerIds.length) return { rows: [], contractorIds: [] };
  const [deployments, attendanceResult] = await Promise.all([
    loadEligibleDeployments(access, {
      organizationId: context.organizationId,
      companyId: context.companyId,
      siteId: context.siteId,
      attendanceDate: context.workDate,
    }),
    access.admin
      .from("labour_attendance")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("company_id", context.companyId)
      .eq("site_id", context.siteId)
      .eq("attendance_date", context.workDate)
      .in("labour_worker_id", workerIds),
  ]);
  if (attendanceResult.error) throw attendanceResult.error;
  const deploymentById = new Map((deployments || []).filter((deployment: any) => deploymentIds.includes(deployment.id)).map((deployment: any) => [deployment.id, deployment]));
  const attendanceByWorker = new Map((attendanceResult.data || []).map((row: any) => [row.labour_worker_id, row]));
  const rows = (assignments || []).map((assignment: any) => {
    const deployment: any = deploymentById.get(assignment.deployment_id);
    if (!deployment) return null;
    const worker = workerFromDeployment(deployment);
    const contractor = contractorFromDeployment(deployment);
    const trade = tradeFromDeployment(deployment);
    const siteIn = Array.isArray(assignment.labour_site_ins) ? assignment.labour_site_ins[0] : assignment.labour_site_ins;
    const saved: any = attendanceByWorker.get(assignment.labour_worker_id);
    return {
      assignment_id: assignment.id,
      site_in_id: assignment.site_in_id,
      deployment_id: assignment.deployment_id,
      labour_worker_id: assignment.labour_worker_id,
      contractor_profile_id: deployment.contractor_profile_id,
      contractor_name: contractorName(contractor),
      labour_code: worker?.labour_code || null,
      worker_name: worker?.worker_name || null,
      category_name: trade?.trade_name || deployment.trade || null,
      daily_rate: deployment.wage_rate,
      daily_rate_label: moneyLabel(deployment.wage_rate),
      site_in_time: siteIn?.site_in_time || null,
      attendance: saved || null,
      first_shift_status: booleanToShiftStatus(saved?.first_half_present),
      second_shift_status: booleanToShiftStatus(saved?.second_half_present),
      ot_hours: Number(saved?.overtime_minutes || 0) > 0 ? String(Math.round(Number(saved.overtime_minutes) / 60)) : (saved?.overtime_minutes === 0 ? "0" : ""),
      bonus_hours: saved?.bonus_minutes === null || saved?.bonus_minutes === undefined ? "" : String(Math.round(Number(saved.bonus_minutes || 0) / 60)),
      remarks: saved?.remarks || "",
      status: saved?.status || "draft",
    };
  }).filter(Boolean);
  const contractorIds = Array.from(new Set(rows.map((row: any) => row.contractor_profile_id).filter(Boolean))) as string[];
  return { rows, contractorIds };
}

async function loadWorkLogs(access: any, context: any, contractorIds: string[]) {
  if (!contractorIds.length) return [];
  const { data, error } = await access.admin
    .from("labour_daily_work_logs")
    .select("*")
    .eq("organization_id", context.organizationId)
    .eq("company_id", context.companyId)
    .eq("site_id", context.siteId)
    .eq("work_date", context.workDate)
    .in("contractor_profile_id", contractorIds)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

function validateWorkRow(row: any, mode: "save_draft" | "submit" = "submit") {
  const contractorProfileId = text(row.contractor_profile_id);
  const workType = text(row.work_type);
  const activity = text(row.work_description || row.activity);
  const quantity = numberOrNull(row.quantity);
  const unit = text(row.unit);
  const hasAny = contractorProfileId || workType || activity || row.quantity || unit || text(row.remarks);
  if (!hasAny) return { empty: true };
  if (!contractorProfileId) return { error: "Contractor is required for Daily Work." };
  if (workType && !WORK_TYPES.includes(workType as any)) return { error: "Work Type is required." };
  if (mode === "submit" && !workType) return { error: "Work Type is required." };
  if (mode === "submit" && !activity) return { error: "Activity / Work Description is required." };
  if (row.quantity !== "" && row.quantity !== null && row.quantity !== undefined && (quantity === null || quantity < 0)) return { error: "Quantity must be non-negative." };
  if (mode === "submit" && workType === "productive" && quantity === null) return { error: "Quantity required for Productive work." };
  if (mode === "submit" && workType === "productive" && !unit) return { error: "Unit required for Productive work." };
  if (quantity !== null && !unit && mode === "save_draft") return { contractorProfileId, workType, activity, quantity, unit };
  return { contractorProfileId, workType, activity, quantity, unit };
}

function hasNonEmptyWorkRow(row: any) {
  const parsed = validateWorkRow(row);
  return !("empty" in parsed);
}

async function loadGroups(access: any, context: any, engineerId: string) {
  const { data: groups, error } = await access.admin
    .from("labour_work_groups")
    .select("*")
    .eq("organization_id", context.organizationId)
    .eq("company_id", context.companyId)
    .eq("site_id", context.siteId)
    .eq("work_date", context.workDate)
    .eq("engineer_employee_id", engineerId)
    .eq("group_type", "engineer_group")
    .neq("status", "cancelled")
    .order("group_number", { ascending: true });
  if (error) throw error;
  const groupIds = (groups || []).map((group: any) => group.id);
  if (!groupIds.length) return [];
  const [membersResult, logsResult, photosResult] = await Promise.all([
    access.admin.from("labour_work_group_members").select("*").in("work_group_id", groupIds).eq("status", "active"),
    access.admin.from("labour_daily_work_logs").select("*").in("work_group_id", groupIds).neq("status", "locked").order("created_at", { ascending: true }),
    access.admin.from("labour_photo_evidence").select("id, reference_id, work_group_id, original_file_name, server_received_at, uploaded_by_name, photo_type, is_active").eq("reference_type", "work_group").in("reference_id", groupIds).eq("is_active", true).order("server_received_at", { ascending: false }),
  ]);
  if (membersResult.error) throw membersResult.error;
  if (logsResult.error) throw logsResult.error;
  if (photosResult.error) throw photosResult.error;
  const membersByGroup = new Map<string, any[]>();
  for (const member of membersResult.data || []) {
    membersByGroup.set(member.work_group_id, [...(membersByGroup.get(member.work_group_id) || []), member]);
  }
  const logByGroup = new Map((logsResult.data || []).map((log: any) => [log.work_group_id, log]));
  const photosByGroup = new Map<string, any[]>();
  for (const photo of photosResult.data || []) {
    photosByGroup.set(photo.reference_id, [...(photosByGroup.get(photo.reference_id) || []), photo]);
  }
  return (groups || []).map((group: any) => {
    const log: any = logByGroup.get(group.id);
    return {
      id: group.id,
      client_id: group.id,
      group_number: group.group_number,
      status: group.status || "draft",
      group_name: group.group_label || group.crew_name || "",
      contractor_profile_id: group.contractor_profile_id || "",
      work_type: log?.work_type || "productive",
      work_description: log?.activity || "",
      quantity: log?.quantity === null || log?.quantity === undefined ? "" : String(log.quantity),
      unit: log?.unit || "",
      remarks: log?.remarks || "",
      work_log_id: log?.id || "",
      member_worker_ids: (membersByGroup.get(group.id) || []).map((member: any) => member.labour_worker_id).filter(Boolean),
      photos: photosByGroup.get(group.id) || [],
    };
  });
}

function groupToWorkRow(group: any, assignedRows: any[]) {
  const memberIds = new Set(Array.isArray(group.member_worker_ids) ? group.member_worker_ids : []);
  const memberRows = assignedRows.filter((row: any) => memberIds.has(row.labour_worker_id));
  const firstMember = memberRows[0];
  return {
    id: text(group.work_log_id),
    contractor_profile_id: text(group.contractor_profile_id) || firstMember?.contractor_profile_id || null,
    work_type: group.work_type,
    work_description: group.work_description,
    quantity: group.quantity,
    unit: group.unit,
    remarks: group.remarks,
    work_group_id: text(group.id),
    derived_labour_count: memberRows.length,
  };
}

function validateGroupPayload(assignedRows: any[], groups: any[], mode: "save_draft" | "submit") {
  const assignedByWorker = new Map(assignedRows.map((row: any) => [row.labour_worker_id, row]));
  const assignedWorkerIds = new Set(assignedRows.map((row: any) => row.labour_worker_id));
  const seenWorkers = new Set<string>();
  for (const group of groups || []) {
    const memberIds = Array.from(new Set((Array.isArray(group.member_worker_ids) ? group.member_worker_ids : []).map((id: any) => text(id)).filter(Boolean))) as string[];
    if (!memberIds.length && !text(group.id)) continue;
    if (mode === "submit" && !memberIds.length) return { error: "This group has no labourers. Add labourers or delete the group before submitting." };
    for (const workerId of memberIds) {
      if (!assignedWorkerIds.has(workerId)) return { error: "Groups can include only labour assigned to this engineer/date." };
      if (seenWorkers.has(workerId)) return { error: "A labourer can belong to only one active group for this site/date." };
      seenWorkers.add(workerId);
    }
  }
  if (mode === "submit" && seenWorkers.size !== assignedRows.length) return { error: "Place every assigned Site-In labourer in a group before submitting." };
  return { assignedByWorker, seenWorkers };
}

async function reconcileGroupMembers(access: any, groupId: string, context: any, assignedByWorker: Map<string, any>, memberIds: string[]) {
  const desired = new Set(memberIds);
  const { data: existingRows, error } = await access.admin
    .from("labour_work_group_members")
    .select("*")
    .eq("work_group_id", groupId);
  if (error) throw error;
  const existingByWorker = new Map((existingRows || []).map((row: any) => [row.labour_worker_id, row]));
  const now = new Date().toISOString();

  for (const existing of existingRows || []) {
    if (existing.status === "active" && !desired.has(existing.labour_worker_id)) {
      const { error: cancelError } = await access.admin
        .from("labour_work_group_members")
        .update({ status: "cancelled", updated_at: now, ...actorFields(access.auth, "updated") })
        .eq("id", existing.id);
      if (cancelError) throw cancelError;
    }
  }

  for (const workerId of memberIds) {
    const row: any = assignedByWorker.get(workerId);
    const existing: any = existingByWorker.get(workerId);
    const memberPayload = {
      organization_id: context.organizationId,
      company_id: context.companyId,
      site_id: context.siteId,
      work_date: context.workDate,
      contractor_profile_id: row.contractor_profile_id,
      deployment_id: row.deployment_id,
      site_in_id: row.site_in_id,
      site_in_time_snapshot: row.site_in_time,
      category_snapshot: row.category_name,
      status: "active",
      assigned_by: access.auth.user.id,
      assigned_by_name: actorName(access),
      assigned_by_email: access.auth.user.email || null,
      updated_at: now,
      ...actorFields(access.auth, existing ? "updated" : "created"),
    };
    if (existing) {
      if (existing.status !== "active") {
        const { error: reactivateError } = await access.admin
          .from("labour_work_group_members")
          .update(memberPayload)
          .eq("id", existing.id);
        if (reactivateError) throw reactivateError;
      }
      continue;
    }
    const { error: insertError } = await access.admin
      .from("labour_work_group_members")
      .insert({
        work_group_id: groupId,
        labour_worker_id: workerId,
        ...memberPayload,
      });
    if (insertError) throw insertError;
  }
}

async function saveGroupRows(access: any, request: Request, context: any, engineer: any, assignedRows: any[], groups: any[], mode: "save_draft" | "submit") {
  const validation = validateGroupPayload(assignedRows, groups, mode);
  if ("error" in validation) return validation;
  const assignedByWorker = validation.assignedByWorker as Map<string, any>;
  const savedGroups: any[] = [];
  let nextNumber = 1;
  for (const group of groups || []) {
    const memberIds = Array.from(new Set((Array.isArray(group.member_worker_ids) ? group.member_worker_ids : []).map((id: any) => text(id)).filter(Boolean))) as string[];
    if (!memberIds.length && !text(group.id)) continue;
    const groupNumber = Number(group.group_number) > 0 ? Number(group.group_number) : nextNumber;
    nextNumber = Math.max(nextNumber, groupNumber + 1);
    const firstMember: any = memberIds.length ? assignedByWorker.get(memberIds[0]) : null;
    const groupName = text(group.group_name) || `Group ${groupNumber}`;
    const groupPayload = {
      organization_id: context.organizationId,
      company_id: context.companyId,
      site_id: context.siteId,
      work_date: context.workDate,
      contractor_profile_id: text(group.contractor_profile_id) || firstMember?.contractor_profile_id || null,
      commercial_model: "contract_basis",
      crew_name: groupName,
      group_label: groupName,
      group_number: groupNumber,
      group_type: "engineer_group",
      engineer_employee_id: engineer.id,
      engineer_user_id: engineer.user_id || null,
      status: "draft",
    };
    let groupId = text(group.id);
    if (groupId) {
      const { data: existingGroup, error: loadError } = await access.admin
        .from("labour_work_groups")
        .select("id, status")
        .eq("id", groupId)
        .eq("engineer_employee_id", engineer.id)
        .maybeSingle();
      if (loadError) throw loadError;
      if (!existingGroup) return { error: "Group not found for this engineer/date." };
      if (existingGroup.status !== "draft") return { error: "Only draft groups can be modified." };
      const { error } = await access.admin.from("labour_work_groups").update({ ...groupPayload, ...actorFields(access.auth, "updated"), updated_at: new Date().toISOString() }).eq("id", groupId).eq("engineer_employee_id", engineer.id).eq("status", "draft");
      if (error) throw error;
    } else {
      const { data, error } = await access.admin.from("labour_work_groups").insert({ ...groupPayload, ...actorFields(access.auth, "created") }).select("id").single();
      if (error) throw error;
      groupId = data.id;
      await audit(access, request, { moduleCode: "labour_engineer_daily", action: "create", entityType: "labour_work_group", recordId: groupId, organizationId: context.organizationId, companyId: context.companyId, siteId: context.siteId, description: "Created Engineer Daily Labour group.", newValues: groupPayload });
    }
    if (!groupId) return { error: "Could not resolve saved group." };
    await reconcileGroupMembers(access, groupId, context, assignedByWorker, memberIds);
    savedGroups.push({ ...group, id: groupId, group_number: groupNumber });
  }
  return { groups: savedGroups };
}

async function markGroupsSubmitted(access: any, context: any, engineer: any, groups: any[]) {
  const groupIds = Array.from(new Set((groups || []).map((group: any) => text(group.id)).filter(Boolean))) as string[];
  if (!groupIds.length) return { submittedGroups: 0 };
  const { error } = await access.admin
    .from("labour_work_groups")
    .update({ status: "submitted", updated_at: new Date().toISOString(), ...actorFields(access.auth, "updated") })
    .eq("organization_id", context.organizationId)
    .eq("company_id", context.companyId)
    .eq("site_id", context.siteId)
    .eq("work_date", context.workDate)
    .eq("engineer_employee_id", engineer.id)
    .eq("group_type", "engineer_group")
    .eq("status", "draft")
    .in("id", groupIds);
  if (error) throw error;
  return { submittedGroups: groupIds.length };
}

async function deleteDraftGroups(access: any, context: any, engineer: any, groupIds: string[]) {
  const ids = Array.from(new Set(groupIds.map((id) => text(id)).filter(Boolean))) as string[];
  if (!ids.length) return { deleted: 0 };
  const { data: groups, error } = await access.admin
    .from("labour_work_groups")
    .select("id, status")
    .eq("organization_id", context.organizationId)
    .eq("company_id", context.companyId)
    .eq("site_id", context.siteId)
    .eq("work_date", context.workDate)
    .eq("engineer_employee_id", engineer.id)
    .eq("group_type", "engineer_group")
    .in("id", ids);
  if (error) throw error;
  const deletableIds = (groups || []).filter((group: any) => group.status === "draft").map((group: any) => group.id);
  if (deletableIds.length !== ids.length) return { error: "Only draft groups can be deleted." };
  if (!deletableIds.length) return { deleted: 0 };
  await access.admin.from("labour_work_group_members").update({ status: "cancelled", updated_at: new Date().toISOString(), ...actorFields(access.auth, "updated") }).in("work_group_id", deletableIds).eq("status", "active");
  await access.admin.from("labour_daily_work_logs").delete().in("work_group_id", deletableIds).eq("status", "draft");
  await access.admin.from("labour_photo_evidence").update({ is_active: false }).eq("reference_type", "work_group").in("reference_id", deletableIds).eq("is_active", true);
  const { error: groupError } = await access.admin.from("labour_work_groups").update({ status: "cancelled", updated_at: new Date().toISOString(), ...actorFields(access.auth, "updated") }).in("id", deletableIds);
  if (groupError) throw groupError;
  return { deleted: deletableIds.length };
}

async function saveDailyWorkRows(access: any, request: Request, context: any, workerRows: any[], rows: any[]) {
  const assignedContractors = new Set(workerRows.map((row: any) => row.contractor_profile_id).filter(Boolean));
  const savedIds: string[] = [];
  for (const item of rows || []) {
    const parsed = validateWorkRow(item, "save_draft");
    if ("empty" in parsed) continue;
    if ("error" in parsed) return { error: parsed.error };
    if (!parsed.workType || !parsed.activity) continue;
    if (!assignedContractors.has(parsed.contractorProfileId)) return { error: "Daily Work contractor must be assigned to the selected engineer/date." };
    const base = {
      organization_id: context.organizationId,
      company_id: context.companyId,
      site_id: context.siteId,
      work_date: context.workDate,
      contractor_profile_id: parsed.contractorProfileId,
      commercial_work_order_id: null,
      manpower_work_order_id: null,
      commercial_model: "contract_basis",
      work_group_id: text(item.work_group_id),
      work_type: parsed.workType || "productive",
      work_period: "regular",
      activity: parsed.activity,
      quantity: parsed.quantity,
      unit: parsed.unit,
      remarks: text(item.remarks),
      non_productive_reason: parsed.workType === "non_productive" ? parsed.activity : null,
      status: "draft",
    };
    if (text(item.id)) {
      const patch = { ...base, ...actorFields(access.auth, "updated"), updated_at: new Date().toISOString() };
      const { error } = await access.admin.from("labour_daily_work_logs").update(patch).eq("id", text(item.id)).eq("status", "draft");
      if (error) throw error;
      savedIds.push(text(item.id)!);
    } else {
      const insertPayload = { ...base, ...actorFields(access.auth, "created") };
      const { data, error } = await access.admin.from("labour_daily_work_logs").insert(insertPayload).select("id").single();
      if (error) throw error;
      savedIds.push(data.id);
      await audit(access, request, {
        moduleCode: "labour_engineer_daily",
        action: "create",
        entityType: "labour_daily_work_log",
        recordId: data.id,
        organizationId: context.organizationId,
        companyId: context.companyId,
        siteId: context.siteId,
        description: "Created Engineer Daily Labour work row.",
        newValues: insertPayload,
      });
    }
  }
  return { savedIds };
}

async function saveAttendanceRows(access: any, context: any, rows: any[], mode: "save_draft" | "submit") {
  const workerRows = await loadAssignedRows(access, context, context.engineerId, null);
  const eligibleByWorker = new Map(workerRows.rows.map((row: any) => [row.labour_worker_id, row]));
  const workerIds = rows.map((row: any) => text(row.labour_worker_id)).filter(Boolean) as string[];
  const invalidWorker = workerIds.find((workerId) => !eligibleByWorker.has(workerId));
  if (invalidWorker) return { error: "One or more attendance rows are not assigned to this engineer." };
  const periodsByContractor = new Map<string, any>();
  for (const workerId of workerIds) {
    const eligible: any = eligibleByWorker.get(workerId);
    if (!eligible || periodsByContractor.has(eligible.contractor_profile_id)) continue;
    const period = await findOrCreateAttendancePeriod(access, {
      organizationId: context.organizationId,
      companyId: context.companyId,
      siteId: context.siteId,
      contractorProfileId: eligible.contractor_profile_id,
      attendanceDate: context.workDate,
      originatingAttendanceSystem: "site_in_engineer",
    });
    periodsByContractor.set(eligible.contractor_profile_id, period);
  }
  const periodIds = Array.from(new Set(Array.from(periodsByContractor.values()).map((period: any) => period.id).filter(Boolean)));
  const { data: existingRows, error: existingError } = workerIds.length && periodIds.length
    ? await access.admin
        .from("labour_attendance")
        .select("*")
        .in("period_id", periodIds)
        .eq("attendance_date", context.workDate)
        .in("labour_worker_id", workerIds)
    : { data: [], error: null };
  if (existingError) throw existingError;
  const existingByPeriodWorker = new Map((existingRows || []).map((row: any) => [`${row.period_id}:${row.labour_worker_id}`, row]));
  const upserts = [];
  const now = new Date().toISOString();
  for (const row of rows) {
    const workerId = text(row.labour_worker_id);
    const eligible: any = workerId ? eligibleByWorker.get(workerId) : null;
    if (!eligible) continue;
    const firstShift = nullableShiftStatus(row.first_shift_status);
    const secondShift = nullableShiftStatus(row.second_shift_status);
    if (firstShift === "__invalid__" || secondShift === "__invalid__") return { error: `Invalid shift status for ${eligible.worker_name || eligible.labour_code}.` };
    if (mode === "submit" && (!firstShift || !secondShift)) return { error: `Mark First Shift and Second Shift for ${eligible.worker_name || eligible.labour_code}.` };
    const ot = optionalWholeHours(row.ot_hours);
    if (!ot.ok) return { error: `OT Hours must be blank or a non-negative whole number for ${eligible.worker_name || eligible.labour_code}.` };
    const bonus = optionalWholeHours(row.bonus_hours);
    if (!bonus.ok) return { error: `Bonus Hours must be blank or a non-negative whole number for ${eligible.worker_name || eligible.labour_code}.` };
    const period = periodsByContractor.get(eligible.contractor_profile_id);
    if (["submitted", "finalized"].includes(period.status)) return { error: "Attendance period is locked for editing." };
    upserts.push(buildLabourAttendanceUpsertPayload({
      existingRow: existingByPeriodWorker.get(`${period.id}:${workerId}`) as Record<string, any> | null | undefined,
      organizationId: context.organizationId,
      companyId: context.companyId,
      siteId: context.siteId,
      contractorProfileId: eligible.contractor_profile_id,
      labourWorkerId: workerId!,
      deploymentId: eligible.deployment_id,
      periodId: period.id,
      attendanceDate: context.workDate,
      status: summaryStatus(firstShift as string | null, secondShift as string | null) as any,
      overtimeMinutes: ot.minutes || 0,
      remarks: text(row.remarks),
      source: "manual",
      actorId: access.auth.user.id,
      actorName: actorName(access),
      actorEmail: access.auth.user.email || null,
      now,
      extra: {
        site_in_id: eligible.site_in_id,
        first_half_present: shiftStatusToBoolean(firstShift as string | null),
        second_half_present: shiftStatusToBoolean(secondShift as string | null),
        bonus_minutes: bonus.minutes,
        proposed_overtime_minutes: ot.minutes || 0,
        approved_overtime_minutes: ot.minutes || 0,
      },
    }));
  }
  if (upserts.length) {
    const { error } = await access.admin.from("labour_attendance").upsert(upserts, { onConflict: "period_id,labour_worker_id,attendance_date" });
    if (error) throw error;
  }
  return { saved: upserts.length };
}

function groupIdsByContractor(groups: any[]) {
  const map = new Map<string, string[]>();
  for (const group of groups || []) {
    const contractorId = text(group.contractor_profile_id);
    const groupId = text(group.id);
    if (!contractorId || !groupId) continue;
    map.set(contractorId, [...(map.get(contractorId) || []), groupId]);
  }
  return map;
}

async function submitContractorPackages(access: any, request: Request, context: any, engineer: any, contractorIds: string[], groups: any[], remarks?: string | null) {
  const submitted = [];
  const groupsByContractor = groupIdsByContractor(groups);
  for (const contractorProfileId of contractorIds) {
    const scopedGroupIds = groupsByContractor.get(contractorProfileId) || [];
    if (!scopedGroupIds.length) continue;
    const existingQuery = access.admin
      .from("labour_daily_submissions")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("company_id", context.companyId)
      .eq("site_id", context.siteId)
      .eq("contractor_profile_id", contractorProfileId)
      .eq("work_date", context.workDate)
      .eq("engineer_employee_id", engineer.id);
    const { data: existing, error: existingError } = await existingQuery.maybeSingle();
    if (existingError) throw existingError;
    if (existing && !EDITABLE_SUBMISSION_STATUSES.includes(existing.status)) return { error: "This Daily Labour package is already submitted." };
    const version = (existing?.submission_version || 0) + 1;
    const now = new Date().toISOString();
    const snapshot = { source: "engineer_daily", originating_attendance_system: "site_in_engineer", engineer_employee_id: engineer.id, engineer_user_id: engineer.user_id || null, contractor_profile_id: contractorProfileId };
    const patch = {
      organization_id: context.organizationId,
      company_id: context.companyId,
      site_id: context.siteId,
      contractor_profile_id: contractorProfileId,
      originating_attendance_system: "site_in_engineer",
      engineer_employee_id: engineer.id,
      engineer_user_id: engineer.user_id || null,
      work_date: context.workDate,
      status: "pending_pm_approval",
      submission_version: version,
      submitted_by: access.auth.user.id,
      submitted_by_name: actorName(access),
      submitted_by_email: access.auth.user.email || null,
      submitted_at: now,
      last_transition: existing ? "site_hr_resubmit" : "site_hr_submit",
      last_transition_at: now,
      snapshot,
      ...(existing ? actorFields(access.auth, "updated") : actorFields(access.auth, "created")),
      updated_at: now,
    };
    const { data: submission, error } = existing
      ? await access.admin.from("labour_daily_submissions").update(patch).eq("id", existing.id).select("*").single()
      : await access.admin.from("labour_daily_submissions").insert(patch).select("*").single();
    if (error) throw error;
    const { error: workSubmitError } = await access.admin.from("labour_daily_work_logs").update({ status: "submitted", submitted_by: access.auth.user.id, submitted_by_name: actorName(access), submitted_by_email: access.auth.user.email || null, submitted_at: now, updated_at: now, ...actorFields(access.auth, "updated") })
      .eq("organization_id", context.organizationId)
      .eq("company_id", context.companyId)
      .eq("site_id", context.siteId)
      .eq("contractor_profile_id", contractorProfileId)
      .eq("work_date", context.workDate)
      .eq("status", "draft")
      .in("work_group_id", scopedGroupIds);
    if (workSubmitError) throw workSubmitError;
    const eventPayload = {
      submission_id: submission.id,
      organization_id: context.organizationId,
      company_id: context.companyId,
      site_id: context.siteId,
      contractor_profile_id: contractorProfileId,
      engineer_employee_id: engineer.id,
      engineer_user_id: engineer.user_id || null,
      work_date: context.workDate,
      submission_version: version,
      action: existing ? "site_hr_resubmit" : "site_hr_submit",
      previous_status: existing?.status || null,
      new_status: "pending_pm_approval",
      reason: null,
      remarks: text(remarks),
      snapshot,
      ...actorFields(access.auth, "created"),
    };
    const { error: eventError } = await access.admin.from("labour_daily_submission_events").insert(eventPayload);
    if (eventError) throw eventError;
    submitted.push(submission);
  }
  return { submitted };
}

export async function GET(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_engineer_daily", "view");
    if ("response" in access) return access.response;
    const { searchParams } = new URL(request.url);
    const lookups = await loadBaseLookups(access);
    const adminMode = isGlobalOrSuperAdmin(access);
    const companyId = text(searchParams.get("company_id"));
    const siteId = text(searchParams.get("site_id"));
    const workDate = dateText(searchParams.get("work_date"));
    const contextOnly = searchParams.get("context_only") === "1";
    if (!companyId || !siteId || !workDate) return NextResponse.json({ ...lookups, rows: [], work_logs: [], engineers: [], current_engineer: null, admin_mode: adminMode });
    const context = await resolveContext(access, { companyId, siteId, workDate, organizationId: searchParams.get("organization_id") });
    if ("error" in context) return jsonError(context.error || "Engineer Daily Labour is not available.", context.status || 403);
    const engineerContext = await resolveEngineerContext(access, context, searchParams.get("engineer_employee_id"));
    if (engineerContext.error) return jsonError(engineerContext.error, 403);
    if (contextOnly) return NextResponse.json({ ...lookups, rows: [], work_logs: [], engineers: engineerContext.engineers, current_engineer: engineerContext.engineer, admin_mode: engineerContext.admin, read_only: false, submission_state: "draft" });
    if (!engineerContext.engineer) return NextResponse.json({ ...lookups, rows: [], work_logs: [], engineers: engineerContext.engineers, current_engineer: null, admin_mode: engineerContext.admin });
    const contractorFilter = text(searchParams.get("contractor_profile_id"));
    const assigned = await loadAssignedRows(access, context, engineerContext.engineer.id, contractorFilter);
    const groups = await loadGroups(access, context, engineerContext.engineer.id);
    const submissionsResult = assigned.contractorIds.length
      ? await access.admin
          .from("labour_daily_submissions")
          .select("id, contractor_profile_id, engineer_employee_id, status, submitted_at, pm_sent_back_by_name, pm_sent_back_by_email, pm_sent_back_at, pm_send_back_reason, ho_sent_back_by_name, ho_sent_back_by_email, ho_sent_back_at, ho_send_back_reason, snapshot")
          .eq("organization_id", context.organizationId)
          .eq("company_id", context.companyId)
          .eq("site_id", context.siteId)
          .eq("work_date", context.workDate)
          .eq("engineer_employee_id", engineerContext.engineer.id)
          .in("contractor_profile_id", assigned.contractorIds)
      : { data: [], error: null };
    if (submissionsResult.error) throw submissionsResult.error;
    const submissions = submissionsResult.data || [];
    const submitted = submissions.some((row: any) => row.status && !EDITABLE_SUBMISSION_STATUSES.includes(row.status));
    const sentBackSubmission = submissions
      .filter((row: any) => row.status === "sent_back_by_pm" || row.status === "sent_back_by_ho")
      .sort((a: any, b: any) => String((b.ho_sent_back_at || b.pm_sent_back_at || "")).localeCompare(String(a.ho_sent_back_at || a.pm_sent_back_at || "")))[0] || null;
    const contractors = Array.from(new Map(assigned.rows.map((row: any) => [row.contractor_profile_id, { id: row.contractor_profile_id, contractor_name: row.contractor_name }])).values());
    return NextResponse.json({
      ...lookups,
      admin_mode: engineerContext.admin,
      engineers: engineerContext.engineers,
      current_engineer: engineerContext.engineer,
      rows: assigned.rows,
      contractors,
      groups,
      work_logs: groups.map((group: any) => ({ id: group.work_log_id, work_group_id: group.id, contractor_profile_id: group.contractor_profile_id, work_type: group.work_type, work_description: group.work_description, quantity: group.quantity, unit: group.unit, derived_labour_count: (group.member_worker_ids || []).length, remarks: group.remarks })),
      submission_state: submitted ? "submitted" : "draft",
      send_back_feedback: sentBackSubmission ? {
        status: sentBackSubmission.status,
        reason: sentBackSubmission.ho_send_back_reason || sentBackSubmission.pm_send_back_reason || "",
        sent_back_by_name: sentBackSubmission.ho_sent_back_by_name || sentBackSubmission.pm_sent_back_by_name || "",
        sent_back_by_email: sentBackSubmission.ho_sent_back_by_email || sentBackSubmission.pm_sent_back_by_email || "",
        sent_back_at: sentBackSubmission.ho_sent_back_at || sentBackSubmission.pm_sent_back_at || null,
        submitted_at: sentBackSubmission.submitted_at || null,
      } : null,
      read_only: submitted,
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load Engineer Daily Labour.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => ({}));
    const action = text(payload.action);
    if (action !== "save_draft" && action !== "submit") return jsonError("Unsupported Engineer Daily Labour action.");
    const access = await requireLabourPermission(request, "labour_engineer_daily", "view");
    if ("response" in access) return access.response;
    const allowed = action === "submit"
      ? hasLabourPermission(access, "labour_engineer_daily", "submit")
      : hasLabourPermission(access, "labour_engineer_daily", "add") || hasLabourPermission(access, "labour_engineer_daily", "edit");
    if (!allowed) return jsonError("You do not have permission to perform this Engineer Daily Labour action.", 403);
    const context = await resolveContext(access, payload);
    if ("error" in context) return jsonError(context.error || "Engineer Daily Labour is not available.", context.status || 403);
    const engineerContext = await resolveEngineerContext(access, context, payload.engineer_employee_id);
    if (engineerContext.error) return jsonError(engineerContext.error, 403);
    if (!engineerContext.engineer) return jsonError("Engineer is required.");
    const scopedContext = { ...context, engineerId: engineerContext.engineer.id };
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const groups = Array.isArray(payload.groups) ? payload.groups : [];
    const deletedGroupIds = Array.isArray(payload.deleted_group_ids) ? payload.deleted_group_ids : [];
    if (!rows.length) return jsonError("Load assigned Site-In labour before saving.");
    const currentAssigned = await loadAssignedRows(access, context, engineerContext.engineer.id, null);
    const groupValidation = validateGroupPayload(currentAssigned.rows, groups, action);
    if ("error" in groupValidation) return jsonError(groupValidation.error || "Groups are invalid.");
    const previewWorkRows = (groups || []).map((group: any) => groupToWorkRow(group, currentAssigned.rows));
    const invalidWorkRow = previewWorkRows.map((row: any) => validateWorkRow(row, action)).find((result: any) => "error" in result) as any;
    if (invalidWorkRow?.error) return jsonError(invalidWorkRow.error || "Daily Work rows are invalid.");
    if (action === "submit" && !previewWorkRows.some(hasNonEmptyWorkRow)) return jsonError("Add at least one Daily Work activity before submitting.");
    const attendanceSave = await saveAttendanceRows(access, scopedContext, rows, action);
    if ("error" in attendanceSave) return jsonError(attendanceSave.error || "Attendance rows are invalid.");
    const deleteSave = await deleteDraftGroups(access, scopedContext, engineerContext.engineer, deletedGroupIds);
    if ("error" in deleteSave) return jsonError(deleteSave.error || "Could not delete draft group.");
    const groupSave = await saveGroupRows(access, request, scopedContext, engineerContext.engineer, currentAssigned.rows, groups, action);
    if ("error" in groupSave) return jsonError(groupSave.error || "Groups are invalid.");
    const savedGroups = "groups" in groupSave ? groupSave.groups || [] : [];
    const workRows = savedGroups.map((group: any) => groupToWorkRow(group, currentAssigned.rows));
    const workSave = await saveDailyWorkRows(access, request, context, currentAssigned.rows, workRows);
    if ("error" in workSave) return jsonError(workSave.error || "Daily Work rows are invalid.");
    if (action === "submit") {
      const contractorIds = Array.from(new Set(currentAssigned.rows.map((row: any) => row.contractor_profile_id).filter(Boolean))) as string[];
      const submitResult = await submitContractorPackages(access, request, scopedContext, engineerContext.engineer, contractorIds, savedGroups, text(payload.submit_remarks));
      if ("error" in submitResult) return jsonError(submitResult.error || "Could not submit Daily Labour.", 403);
      const groupSubmit = await markGroupsSubmitted(access, scopedContext, engineerContext.engineer, savedGroups);
      await audit(access, request, {
        moduleCode: "labour_engineer_daily",
        action: "update",
        entityType: "labour_engineer_daily",
        recordId: contractorIds[0] || context.siteId,
        organizationId: context.organizationId,
        companyId: context.companyId,
        siteId: context.siteId,
        description: "Submitted Engineer Daily Labour.",
        newValues: { attendance_rows: attendanceSave.saved, groups: groupSubmit.submittedGroups || 0, work_rows: workSave.savedIds?.length || 0, contractor_packages: submitResult.submitted?.length || 0 },
      });
      return NextResponse.json({ saved: attendanceSave.saved, groups: groupSubmit.submittedGroups || 0, work_rows: workSave.savedIds?.length || 0, submitted: submitResult.submitted?.length || 0, saved_groups: savedGroups });
    }
    await audit(access, request, {
      moduleCode: "labour_engineer_daily",
      action: "update",
      entityType: "labour_engineer_daily",
      recordId: context.siteId,
      organizationId: context.organizationId,
      companyId: context.companyId,
      siteId: context.siteId,
      description: "Saved Engineer Daily Labour draft.",
      newValues: { attendance_rows: attendanceSave.saved, groups: savedGroups.length || 0, work_rows: workSave.savedIds?.length || 0 },
    });
    return NextResponse.json({ saved: attendanceSave.saved, groups: savedGroups.length || 0, work_rows: workSave.savedIds?.length || 0, saved_groups: savedGroups });
  } catch (error: any) {
    return jsonError(error.message || "Failed to save Engineer Daily Labour.", 500);
  }
}
