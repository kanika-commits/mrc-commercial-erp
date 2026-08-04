import { NextResponse } from "next/server";
import {
  actorFields,
  audit,
  jsonError,
  loadEligibleDeployments,
  loadMusterSiteHrBlocker,
  originatingAttendanceSystem,
  requireLabourPermission,
  resolveSiteAttendanceSystem,
  validateLabourCompanySiteIndependent,
  validateContractorProfile,
} from "@/app/api/labour/_shared";
import { isoDate, todayInIst } from "@/lib/labour/operations";
import { normalizeText } from "@/lib/labour/constants";

function hasServerPermission(access: any, moduleCode: string, actionCode: string) {
  return (access.auth.permissions || []).some(
    (permission: any) =>
      permission.allowed === true &&
      ((permission.module_code === "*" && permission.action_code === "*") ||
        (permission.module_code === moduleCode && permission.action_code === actionCode)),
  );
}

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

function timeValue(value: unknown) {
  const next = text(value);
  if (!next) return null;
  const match = next.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  return match ? `${match[1]}:${match[2]}:${match[3] || "00"}` : null;
}

function displayTime(value?: string | null) {
  if (!value) return "-";
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function currentIstTime() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function actorName(access: any) {
  return access.auth.user.user_metadata?.full_name || access.auth.user.user_metadata?.name || access.auth.user.email || "Unknown User";
}

function displayEmployee(employee: any) {
  return employee?.employee_name || employee?.email || "Employee";
}

function assignmentEngineer(assignment: any) {
  return Array.isArray(assignment?.hr_employees) ? assignment.hr_employees[0] : assignment?.hr_employees;
}

function assignmentConflictLabel(assignment: any) {
  const engineer = assignmentEngineer(assignment);
  return displayEmployee(engineer);
}

function moneyLabel(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "Not Set";
  return `₹${amount.toLocaleString("en-IN")}`;
}

async function resolveScope(access: any, input: {
  requestedOrganizationId?: string | null;
  companyId?: string | null;
  siteId?: string | null;
}) {
  if (!input.companyId) return { error: "Company is required." };
  if (!input.siteId) return { error: "Site is required." };
  const fallbackOrganizationId = Array.isArray(access.organizationScope) ? access.organizationScope[0] : null;
  const scopeCheck = await validateLabourCompanySiteIndependent(access, input.requestedOrganizationId || fallbackOrganizationId, input.companyId, input.siteId);
  if ("error" in scopeCheck) return { error: scopeCheck.error || "Selected company/site is not available.", status: 403 };
  const siteHrBlocker = await loadMusterSiteHrBlocker(access, { organizationId: scopeCheck.organizationId, companyId: input.companyId, siteId: input.siteId });
  if (siteHrBlocker) return { error: siteHrBlocker, status: 403 };
  const system = await resolveSiteAttendanceSystem(access, { organizationId: scopeCheck.organizationId, companyId: input.companyId, siteId: input.siteId });
  if (!system.ok) return { error: system.message, status: 403 };
  if (system.attendanceSystem === "standard") return { error: "This site uses Standard Labour Attendance. Site-In is not required.", status: 403 };
  return scopeCheck;
}

function deploymentWorker(deployment: any) {
  return Array.isArray(deployment.labour_workers) ? deployment.labour_workers[0] : deployment.labour_workers;
}

function deploymentContractor(deployment: any) {
  return Array.isArray(deployment.labour_contractor_profiles) ? deployment.labour_contractor_profiles[0] : deployment.labour_contractor_profiles;
}

function deploymentTrade(deployment: any) {
  return Array.isArray(deployment.labour_trades) ? deployment.labour_trades[0] : deployment.labour_trades;
}

async function loadEngineerOptions(access: any, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
}) {
  const { data, error } = await access.admin
    .from("hr_employees")
    .select("id, employee_name, user_id, department_id, hr_departments(department_name)")
    .eq("organization_id", input.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("status", "active")
    .order("employee_name");
  if (error) throw error;
  return (data || []).map((employee: any) => {
    const department = Array.isArray(employee.hr_departments) ? employee.hr_departments[0] : employee.hr_departments;
    const departmentName = department?.department_name || "No Department";
    return {
      id: employee.id,
      employee_id: employee.id,
      employee_name: employee.employee_name,
      department_name: departmentName,
      user_id: employee.user_id || null,
      label: `${employee.employee_name} — ${departmentName}`,
    };
  });
}

async function validateEngineerCandidate(access: any, context: {
  organizationId: string;
  companyId: string;
  siteId: string;
}, engineerEmployeeId: string) {
  const engineers = await loadEngineerOptions(access, context);
  return engineers.find((engineer: any) => engineer.id === engineerEmployeeId) || null;
}

async function loadWorkerEngineerAssignments(access: any, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
  siteInDate: string;
  workerIds: string[];
}) {
  if (!input.workerIds.length) return [];
  const { data, error } = await access.admin
    .from("labour_site_in_engineer_assignments")
    .select("*, hr_employees(id, employee_name, user_id, hr_departments(department_name))")
    .eq("organization_id", input.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("site_in_date", input.siteInDate)
    .eq("status", "active")
    .in("labour_worker_id", input.workerIds);
  if (error) throw error;
  return data || [];
}

async function loadConflictingEngineerAssignments(access: any, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
  siteInDate: string;
  engineerEmployeeId: string;
  workerIds: string[];
}) {
  const assignments = await loadWorkerEngineerAssignments(access, input);
  return assignments.filter((assignment: any) =>
    assignment.engineer_employee_id &&
    assignment.engineer_employee_id !== input.engineerEmployeeId
  );
}

function assignmentConflictResponse(conflicts: any[], workersById: Map<string, any>) {
  const details = conflicts.map((assignment: any) => {
    const worker = workersById.get(assignment.labour_worker_id) || {};
    const workerName = worker.worker_name || worker.labour_code || "Selected labourer";
    const workerCode = worker.labour_code ? ` (${worker.labour_code})` : "";
    return `${workerName}${workerCode} is already assigned to ${assignmentConflictLabel(assignment)}.`;
  });
  return {
    error: "This labourer is already assigned to another Engineer's saved team and cannot be transferred through Site-In.",
    conflicts: details,
  };
}

async function loadContractorProfileIds(access: any, organizationId: string, contractorProfileId?: string | null, fallbackVendorId?: string | null) {
  const id = text(contractorProfileId);
  if (!id) return null;
  const { data: profile, error: profileError } = await access.admin
    .from("labour_contractor_profiles")
    .select("id, organization_id, contractor_status")
    .eq("id", id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (profile) {
    if (profile.organization_id !== organizationId || profile.contractor_status !== "active") {
      return { error: "Selected contractor is not available." };
    }
    return { profileIds: [id] };
  }
  const vendorId = text(fallbackVendorId) || id;
  const { data: profiles, error: vendorProfileError } = await access.admin
    .from("labour_contractor_profiles")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("vendor_id", vendorId)
    .eq("contractor_status", "active");
  if (vendorProfileError) throw vendorProfileError;
  return { profileIds: (profiles || []).map((profile: any) => profile.id).filter(Boolean) };
}

async function loadSiteInEligibleDeployments(access: any, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
  siteInDate: string;
  contractorProfileId?: string | null;
  contractorVendorId?: string | null;
}): Promise<{ deployments: any[] } | { error: string }> {
  const contractorCheck = await loadContractorProfileIds(access, input.organizationId, input.contractorProfileId, input.contractorVendorId);
  if (contractorCheck && "error" in contractorCheck) return { error: contractorCheck.error || "Selected contractor is not available." };
  const deployments = await loadEligibleDeployments(access, {
    organizationId: input.organizationId,
    companyId: input.companyId,
    siteId: input.siteId,
    contractorProfileId: null,
    attendanceDate: input.siteInDate,
  });
  if (!contractorCheck?.profileIds) return { deployments };
  const allowed = new Set(contractorCheck.profileIds);
  const filtered = deployments.filter((deployment: any) => allowed.has(deployment.contractor_profile_id));
  if (!filtered.length) return { error: "Selected contractor has no registered labour for this Site/date." };
  return { deployments: filtered };
}

async function loadAuthorizedDeployment(access: any, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
  siteInDate: string;
  labourWorkerId: string;
  deploymentId?: string | null;
  contractorProfileId?: string | null;
  contractorVendorId?: string | null;
}): Promise<{ deployment: any | null } | { changed: true } | { error: string }> {
  const eligible = await loadSiteInEligibleDeployments(access, {
    organizationId: input.organizationId,
    companyId: input.companyId,
    siteId: input.siteId,
    siteInDate: input.siteInDate,
    contractorProfileId: input.contractorProfileId,
    contractorVendorId: input.contractorVendorId,
  });
  if ("error" in eligible) return eligible;
  const deployments = eligible.deployments || [];
  const deployment = deployments.find((item: any) => (
    item.labour_worker_id === input.labourWorkerId &&
    (!input.deploymentId || item.id === input.deploymentId)
  ));
  if (input.deploymentId && !deployment) return { changed: true };
  return { deployment: deployment || null };
}

export async function GET(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_site_in", "view");
    if ("response" in access) return access.response;
    const { searchParams } = new URL(request.url);
    const companyId = text(searchParams.get("company_id"));
    const siteId = text(searchParams.get("site_id"));
    const siteInDateRaw = searchParams.get("site_in_date") || searchParams.get("date");
    const siteInDate = isoDate(siteInDateRaw);
    const contractorProfileId = text(searchParams.get("contractor_profile_id"));
    const contractorVendorId = text(searchParams.get("contractor_vendor_id"));
    const assignmentOnly = searchParams.get("assignment_only") === "true";
    const engineerEmployeeId = text(searchParams.get("engineer_employee_id"));
    const search = normalizeText(searchParams.get("search")).toUpperCase();
    if (!siteInDateRaw) return jsonError("Site-In date is required.");
    if (!siteInDate) return jsonError("Site-In date must be in YYYY-MM-DD format.");
    const scope = await resolveScope(access, {
      requestedOrganizationId: text(searchParams.get("organization_id")),
      companyId,
      siteId,
    });
    if ("error" in scope) {
      const denied = scope as { error?: string; status?: number };
      return jsonError(denied.error || "Selected company/site is not available.", denied.status || 400);
    }
    const organizationId = scope.organizationId;
    const canAssignEngineer = hasServerPermission(access, "labour_work_logs", "assign_engineer");
    if (assignmentOnly) {
      const engineers = await loadEngineerOptions(access, { organizationId, companyId: companyId!, siteId: siteId! });
      return NextResponse.json({ can_assign_engineer: canAssignEngineer, engineers });
    }
    let selectedEngineer = null;
    if (engineerEmployeeId) {
      selectedEngineer = await validateEngineerCandidate(access, { organizationId, companyId: companyId!, siteId: siteId! }, engineerEmployeeId);
      if (!selectedEngineer) return jsonError("Selected engineer is not available for this company/site.", 403);
    }
    const eligible = await loadSiteInEligibleDeployments(access, {
      organizationId,
      companyId: companyId!,
      siteId: siteId!,
      siteInDate,
      contractorProfileId,
      contractorVendorId,
    });
    if ("error" in eligible) return jsonError(eligible.error || "Selected contractor is not available.", 403);
    const deployments = eligible.deployments || [];
    const canCorrectTime = hasServerPermission(access, "labour_site_in", "correct_time");
    const deploymentIds = deployments.map((deployment: any) => deployment.id);
    const { data: siteIns, error: siteInError } = deploymentIds.length
      ? await access.admin
          .from("labour_site_ins")
          .select("*")
          .eq("organization_id", organizationId)
          .eq("company_id", companyId)
          .eq("site_id", siteId)
          .eq("site_in_date", siteInDate)
          .eq("status", "active")
          .in("deployment_id", deploymentIds)
      : { data: [], error: null };
    if (siteInError) throw siteInError;
    const siteInByDeployment = new Map((siteIns || []).map((row: any) => [row.deployment_id, row]));
    const workerIds = deployments.map((deployment: any) => deployment.labour_worker_id).filter(Boolean);
    const [assignments, engineers] = await Promise.all([
      loadWorkerEngineerAssignments(access, {
        organizationId,
        companyId: companyId!,
        siteId: siteId!,
        siteInDate,
        workerIds,
      }),
      loadEngineerOptions(access, { organizationId, companyId: companyId!, siteId: siteId! }),
    ]);
    const assignmentByWorker = new Map((assignments || []).map((assignment: any) => [assignment.labour_worker_id, assignment]));
    const rows = deployments
      .map((deployment: any) => {
        const worker = deploymentWorker(deployment);
        const contractor = deploymentContractor(deployment);
        const trade = deploymentTrade(deployment);
        const siteIn = siteInByDeployment.get(deployment.id) || null;
        const assignment: any = assignmentByWorker.get(deployment.labour_worker_id) || null;
        const engineer = assignmentEngineer(assignment);
        const department = Array.isArray(engineer?.hr_departments) ? engineer.hr_departments[0] : engineer?.hr_departments;
        const engineerName = engineer ? displayEmployee(engineer) : null;
        const engineerDepartment = department?.department_name || null;
        return {
          deployment_id: deployment.id,
          labour_worker_id: deployment.labour_worker_id,
          labour_code: worker?.labour_code || "",
          worker_name: worker?.worker_name || "",
          contractor_profile_id: deployment.contractor_profile_id,
          contractor_name: contractor?.vendors?.vendor_name || contractor?.contractor_code || "",
          labour_trade_id: deployment.labour_trade_id,
          category_name: trade?.trade_name || deployment.trade || "",
          daily_rate: deployment.wage_rate || null,
          daily_rate_label: moneyLabel(deployment.wage_rate),
          site_in: siteIn,
          site_in_status: siteIn ? "site_in" : "not_site_in",
          site_in_time: siteIn?.site_in_time || null,
          site_in_time_label: displayTime(siteIn?.site_in_time),
          engineer_assignment: assignment,
          assigned_engineer_employee_id: assignment?.engineer_employee_id || null,
          assigned_engineer_user_id: assignment?.engineer_user_id || null,
          assigned_engineer_name: engineerName,
          assigned_engineer_department: engineerDepartment,
          assigned_engineer_label: engineerName ? `${engineerName}${engineerDepartment ? ` — ${engineerDepartment}` : ""}` : "Not Assigned",
          selectable: !assignment || assignment.engineer_employee_id === engineerEmployeeId,
          can_correct_time: Boolean(siteIn && canCorrectTime),
        };
      })
      .filter((row: any) => !engineerEmployeeId || !row.assigned_engineer_employee_id || row.assigned_engineer_employee_id === engineerEmployeeId)
      .filter((row: any) => {
        if (!search) return true;
        return [row.labour_code, row.worker_name, row.contractor_name, row.category_name]
          .some((value) => normalizeText(value).toUpperCase().includes(search));
      });

    return NextResponse.json({ rows, count: rows.length, engineers, selected_engineer: selectedEngineer });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load Site-In labourers.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_site_in", "add");
    if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    if (payload.action === "assign_engineer") {
      const companyId = text(payload.company_id);
      const siteId = text(payload.site_id);
      const siteInDate = isoDate(payload.site_in_date || payload.work_date);
      const engineerEmployeeId = text(payload.engineer_employee_id || payload.engineer_user_id);
      const selectedWorkerIds = Array.isArray(payload.labour_worker_ids)
        ? Array.from(new Set(payload.labour_worker_ids.map((id: unknown) => text(id)).filter(Boolean))) as string[]
        : [];
      const siteInTime = timeValue(payload.site_in_time) || `${currentIstTime()}:00`;
      if (!payload.site_in_date && !payload.work_date) return jsonError("Site-In date is required.");
      if (!siteInDate) return jsonError("Site-In date must be in YYYY-MM-DD format.");
      if (siteInDate > todayInIst()) return jsonError("Future Site-In cannot be marked.");
      if (!companyId) return jsonError("Company is required.");
      if (!siteId) return jsonError("Site is required.");
      if (!engineerEmployeeId) return jsonError("Engineer is required.");
      if (!selectedWorkerIds.length) return jsonError("Select at least one labourer.");

      const scope = await resolveScope(access, {
        requestedOrganizationId: text(payload.organization_id),
        companyId,
        siteId,
      });
      if ("error" in scope) {
        const denied = scope as { error?: string; status?: number };
        return jsonError(denied.error || "Selected company/site is not available.", denied.status || 400);
      }
      const organizationId = scope.organizationId;
      const engineer = await validateEngineerCandidate(access, { organizationId, companyId, siteId }, engineerEmployeeId);
      if (!engineer) return jsonError("Selected engineer is not available for this company/site.", 403);
      const eligible = await loadSiteInEligibleDeployments(access, {
        organizationId,
        companyId,
        siteId,
        siteInDate,
        contractorProfileId: text(payload.contractor_profile_id),
        contractorVendorId: text(payload.contractor_vendor_id),
      });
      if ("error" in eligible) return jsonError(eligible.error || "Selected contractor is not available.", 403);
      const eligibleByWorker = new Map((eligible.deployments || []).map((deployment: any) => [deployment.labour_worker_id, deployment]));
      const missingWorker = selectedWorkerIds.find((workerId) => !eligibleByWorker.has(workerId));
      if (missingWorker) return jsonError("One or more selected labourers are not actively deployed for this Site/date.", 403);
      const workersById = new Map((eligible.deployments || []).map((deployment: any) => {
        const worker = deploymentWorker(deployment) || {};
        return [deployment.labour_worker_id, worker];
      }));
      const lockedConflicts = await loadConflictingEngineerAssignments(access, {
        organizationId,
        companyId,
        siteId,
        siteInDate,
        engineerEmployeeId,
        workerIds: selectedWorkerIds,
      });
      if (lockedConflicts.length) {
        return NextResponse.json(assignmentConflictResponse(lockedConflicts, workersById), { status: 409 });
      }

      const deploymentIds = Array.from(new Set(selectedWorkerIds.map((workerId) => (eligibleByWorker.get(workerId) as any)?.id).filter(Boolean)));
      const { data: existingSiteIns, error: siteInError } = deploymentIds.length
        ? await access.admin
            .from("labour_site_ins")
            .select("*")
            .eq("organization_id", organizationId)
            .eq("company_id", companyId)
            .eq("site_id", siteId)
            .eq("site_in_date", siteInDate)
            .eq("status", "active")
            .in("deployment_id", deploymentIds)
        : { data: [], error: null };
      if (siteInError) throw siteInError;
      const siteInByDeployment = new Map((existingSiteIns || []).map((row: any) => [row.deployment_id, row]));
      const siteInsByWorker = new Map<string, any>();
      const createdSiteIns: any[] = [];
      const now = new Date().toISOString();
      for (const workerId of selectedWorkerIds) {
        const deployment: any = eligibleByWorker.get(workerId);
        let siteIn = siteInByDeployment.get(deployment.id);
        if (!siteIn) {
          const insertPayload = {
            organization_id: organizationId,
            company_id: companyId,
            site_id: siteId,
            contractor_profile_id: deployment.contractor_profile_id,
            labour_worker_id: workerId,
            deployment_id: deployment.id,
            site_in_date: siteInDate,
            site_in_time: siteInTime,
            originating_attendance_system: "site_in_engineer",
            status: "active",
            marked_by: access.auth.user.id,
            marked_by_name: actorName(access),
            marked_by_email: access.auth.user.email || null,
            marked_at: now,
            created_at: now,
            updated_at: now,
            ...actorFields(access.auth, "created"),
            ...actorFields(access.auth, "updated"),
          };
          const { data, error } = await access.admin.from("labour_site_ins").insert(insertPayload).select("*").single();
          if (error) {
            if (error.code === "23505") return jsonError("One selected labourer was marked Site-In by another user. Reload and retry.", 409);
            throw error;
          }
          siteIn = data;
          createdSiteIns.push(data);
          await audit(access, request, {
            moduleCode: "labour_site_in",
            action: "create",
            entityType: "labour_site_in",
            recordId: data.id,
            organizationId,
            companyId,
            siteId,
            description: "Created labour Site-In during engineer assignment.",
            newValues: { labour_worker_id: workerId, deployment_id: deployment.id, site_in_date: siteInDate, site_in_time: siteInTime },
          });
        } else {
          await audit(access, request, {
            moduleCode: "labour_site_in",
            action: "update",
            entityType: "labour_site_in",
            recordId: siteIn.id,
            organizationId,
            companyId,
            siteId,
            description: "Reused existing labour Site-In for engineer assignment.",
            newValues: { labour_worker_id: workerId, site_in_date: siteInDate, preserved_site_in_time: siteIn.site_in_time },
          });
        }
        siteInsByWorker.set(workerId, siteIn);
      }

      const existingAssignments = await loadWorkerEngineerAssignments(access, { organizationId, companyId, siteId, siteInDate, workerIds: selectedWorkerIds });
      const assignmentByWorker = new Map((existingAssignments || []).map((assignment: any) => [assignment.labour_worker_id, assignment]));
      const rowResults = [];
      const nowForAssignments = new Date().toISOString();
      for (const workerId of selectedWorkerIds) {
        const deployment: any = eligibleByWorker.get(workerId);
        const siteIn: any = siteInsByWorker.get(workerId);
        const existingAssignment: any = assignmentByWorker.get(workerId);
        const assignmentPayload = {
          organization_id: organizationId,
          company_id: companyId,
          site_id: siteId,
          site_in_date: siteInDate,
          contractor_profile_id: deployment.contractor_profile_id,
          labour_worker_id: workerId,
          deployment_id: deployment.id,
          site_in_id: siteIn.id,
          engineer_employee_id: engineerEmployeeId,
          engineer_user_id: engineer.user_id || null,
          status: "active",
          updated_by: access.auth.user.id,
          updated_by_name: actorName(access),
          updated_by_email: access.auth.user.email || null,
          updated_at: nowForAssignments,
        };
        if (existingAssignment) {
          if (existingAssignment.engineer_employee_id !== engineerEmployeeId) {
            return NextResponse.json(assignmentConflictResponse([existingAssignment], workersById), { status: 409 });
          }
          const { error } = await access.admin
            .from("labour_site_in_engineer_assignments")
            .update(assignmentPayload)
            .eq("id", existingAssignment.id);
          if (error) throw error;
          await audit(access, request, {
            moduleCode: "labour_site_in",
            action: "update",
            entityType: "labour_site_in_engineer_assignment",
            recordId: existingAssignment.id,
            organizationId,
            companyId,
            siteId,
            description: "Updated labour Site-In engineer assignment.",
            oldValues: existingAssignment,
            newValues: assignmentPayload,
          });
          rowResults.push({ labour_worker_id: workerId, status: "updated", site_in_id: siteIn.id, assignment_id: existingAssignment.id });
        } else {
          const insertPayload = {
            ...assignmentPayload,
            assigned_by: access.auth.user.id,
            assigned_by_name: actorName(access),
            assigned_by_email: access.auth.user.email || null,
            assigned_at: nowForAssignments,
          };
          const { data, error } = await access.admin
            .from("labour_site_in_engineer_assignments")
            .insert(insertPayload)
            .select("id")
            .single();
          if (error) {
            if (error.code === "23505") {
              const conflicts = await loadConflictingEngineerAssignments(access, {
                organizationId,
                companyId,
                siteId,
                siteInDate,
                engineerEmployeeId,
                workerIds: [workerId],
              });
              if (conflicts.length) {
                return NextResponse.json(assignmentConflictResponse(conflicts, workersById), { status: 409 });
              }
              return jsonError("One selected labourer was assigned by another user. Reload and retry.", 409);
            }
            throw error;
          }
          await audit(access, request, {
            moduleCode: "labour_site_in",
            action: "create",
            entityType: "labour_site_in_engineer_assignment",
            recordId: data.id,
            organizationId,
            companyId,
            siteId,
            description: "Assigned labourer to engineer during Site-In.",
            newValues: insertPayload,
          });
          rowResults.push({ labour_worker_id: workerId, status: "created", site_in_id: siteIn.id, assignment_id: data.id });
        }
      }

      return NextResponse.json({
        assignments: rowResults,
        engineer,
        selected_workers: selectedWorkerIds.length,
        site_ins_created: createdSiteIns.length,
      });
    }
    const companyId = text(payload.company_id);
    const siteId = text(payload.site_id);
    const siteInDate = isoDate(payload.site_in_date);
    const contractorProfileId = text(payload.contractor_profile_id);
    const contractorVendorId = text(payload.contractor_vendor_id);
    const labourWorkerId = text(payload.labour_worker_id);
    const deploymentId = text(payload.deployment_id);
    const siteInTime = timeValue(payload.site_in_time);
    if (!payload.site_in_date) return jsonError("Site-In date is required.");
    if (!siteInDate) return jsonError("Site-In date must be in YYYY-MM-DD format.");
    if (siteInDate > todayInIst()) return jsonError("Future Site-In cannot be marked.");
    if (!labourWorkerId) return jsonError("Labourer is required.");
    if (!siteInTime) return jsonError("Site-In time is required.");

    const scope = await resolveScope(access, {
      requestedOrganizationId: text(payload.organization_id),
      companyId,
      siteId,
    });
    if ("error" in scope) {
      const denied = scope as { error?: string; status?: number };
      return jsonError(denied.error || "Selected company/site is not available.", denied.status || 400);
    }
    const organizationId = scope.organizationId;
    const deploymentCheck = await loadAuthorizedDeployment(access, {
      organizationId,
      companyId: companyId!,
      siteId: siteId!,
      siteInDate,
      labourWorkerId,
      deploymentId,
      contractorProfileId,
      contractorVendorId,
    });
    if ("error" in deploymentCheck) return jsonError(deploymentCheck.error || "Selected contractor is not available.", 403);
    if ("changed" in deploymentCheck) return jsonError("This labourer's assignment changed. Reload the Site-In list.", 409);
    const deployment = deploymentCheck.deployment;
    if (!deployment) return jsonError("Labourer is not deployed for the selected site and date.", 403);

    const { data: existing, error: existingError } = await access.admin
      .from("labour_site_ins")
      .select("id")
      .eq("labour_worker_id", labourWorkerId)
      .eq("site_in_date", siteInDate)
      .eq("status", "active")
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) return jsonError("This labourer is already Site-In for the selected date.", 409);

    const now = new Date().toISOString();
    const insertPayload = {
      organization_id: organizationId,
      company_id: companyId,
      site_id: siteId,
      contractor_profile_id: deployment.contractor_profile_id,
      labour_worker_id: labourWorkerId,
      deployment_id: deployment.id,
      site_in_date: siteInDate,
      site_in_time: siteInTime,
      status: "active",
      marked_by: access.auth.user.id,
      marked_by_name: actorName(access),
      marked_by_email: access.auth.user.email || null,
      marked_at: now,
      created_at: now,
      updated_at: now,
      ...actorFields(access.auth, "created"),
      ...actorFields(access.auth, "updated"),
    };
    const { data, error } = await access.admin
      .from("labour_site_ins")
      .insert(insertPayload)
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") return jsonError("This labourer is already Site-In for the selected date.", 409);
      throw error;
    }
    await audit(access, request, {
      moduleCode: "labour_site_in",
      action: "create",
      entityType: "labour_site_in",
      recordId: data.id,
      organizationId,
      companyId,
      siteId,
      description: `Marked labour Site-In for ${siteInDate}.`,
      newValues: {
        labour_worker_id: labourWorkerId,
        deployment_id: deployment.id,
        contractor_profile_id: deployment.contractor_profile_id,
        site_in_date: siteInDate,
        site_in_time: siteInTime,
      },
    });
    return NextResponse.json({ site_in: data });
  } catch (error: any) {
    return jsonError(error.message || "Failed to mark Site-In.", 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json().catch(() => ({}));
    const access = await requireLabourPermission(request, "labour_site_in", "correct_time");
    if ("response" in access) return access.response;
    const siteInId = text(payload.site_in_id);
    const correctedTime = timeValue(payload.site_in_time);
    const reason = text(payload.reason);
    if (!siteInId) return jsonError("Site-In record is required.");
    if (!correctedTime) return jsonError("New Site-In time is required.");
    if (!reason || reason.length < 10) return jsonError("Enter a correction reason of at least 10 characters.");

    const { data: existing, error: existingError } = await access.admin
      .from("labour_site_ins")
      .select("*")
      .eq("id", siteInId)
      .eq("status", "active")
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return jsonError("Site-In record was not found.", 404);

    const scope = await validateLabourCompanySiteIndependent(access, existing.organization_id, existing.company_id, existing.site_id);
    if ("error" in scope) return jsonError(scope.error || "Selected company/site is not available.", 403);
    const workflow = originatingAttendanceSystem(existing.originating_attendance_system) || "site_in_engineer";
    if (workflow !== "site_in_engineer") return jsonError("This Site-In record does not belong to the Site-In & Engineer Daily workflow.", 403);
    if (existing.site_in_time === correctedTime) return jsonError("New Site-In time must be different from the existing time.");

    const now = new Date().toISOString();
    const updatePayload = {
      site_in_time: correctedTime,
      corrected_from_time: existing.site_in_time,
      corrected_to_time: correctedTime,
      correction_reason: reason,
      corrected_by: access.auth.user.id,
      corrected_by_name: actorName(access),
      corrected_by_email: access.auth.user.email || null,
      corrected_at: now,
      updated_at: now,
      ...actorFields(access.auth, "updated"),
    };
    const { data, error } = await access.admin
      .from("labour_site_ins")
      .update(updatePayload)
      .eq("id", siteInId)
      .select("*")
      .single();
    if (error) throw error;
    await audit(access, request, {
      moduleCode: "labour_site_in",
      action: "update",
      entityType: "labour_site_in",
      recordId: siteInId,
      organizationId: existing.organization_id,
      companyId: existing.company_id,
      siteId: existing.site_id,
      description: `Corrected labour Site-In time for ${existing.site_in_date}.`,
      oldValues: {
        site_in_time: existing.site_in_time,
      },
      newValues: {
        site_in_time: correctedTime,
        correction_reason: reason,
      },
    });
    return NextResponse.json({ site_in: data });
  } catch (error: any) {
    return jsonError(error.message || "Failed to correct Site-In time.", 500);
  }
}
