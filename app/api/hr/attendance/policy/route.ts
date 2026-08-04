import { NextResponse } from "next/server";
import { insertErpAuditLog } from "@/lib/serverAudit";
import { actorName } from "@/lib/hr/attendance";
import { EMPLOYEE_STANDARD_WORKING_HOURS } from "@/lib/hr/attendance";
import {
  adminClient,
  jsonError,
  loadEmployeeAttendancePolicyLookups,
  requireAttendancePolicyView,
  requireAttendancePolicyWrite,
  validateEmployeeAttendancePolicyScope,
} from "../_shared";

function normalizeStatus(value: unknown) {
  const text = String(value || "").trim().toLowerCase();
  return text === "inactive" ? "inactive" : "active";
}

function text(value: unknown) {
  const next = String(value || "").trim();
  return next || null;
}

function approvalLevelCount(value: unknown) {
  const count = Number(value ?? 1);
  if (!Number.isInteger(count) || count < 0 || count > 3) return null;
  return count;
}

function lockAfterHours(value: unknown) {
  const hours = Number(value ?? 5);
  if (!Number.isInteger(hours) || hours < 0 || hours > 168) return null;
  return hours;
}

function normalizeLayers(value: unknown, count: number) {
  const rows = Array.isArray(value) ? value : [];
  return Array.from({ length: count }, (_, index) => {
    const source = rows.find((row: any) => Number(row?.level_sequence) === index + 1) || rows[index] || {};
    return {
      level_sequence: index + 1,
      stage_name: `Level ${index + 1} Approval`,
      approver_user_id: text(source.approver_user_id),
    };
  });
}

function normalizeStringArray(value: unknown) {
  return Array.from(new Set((Array.isArray(value) ? value : []).map(text).filter(Boolean) as string[]));
}

async function loadPolicyChildren(admin: ReturnType<typeof adminClient>, policies: any[]) {
  const policyIds = policies.map((policy) => policy.id).filter(Boolean);
  if (!policyIds.length) return { layers: [], editors: [] };
  const [layerResult, editorResult] = await Promise.all([
    admin
      .from("employee_attendance_policy_layers")
      .select("*")
      .in("policy_id", policyIds)
      .eq("status", "active")
      .order("level_sequence", { ascending: true }),
    admin
      .from("employee_attendance_post_lock_editors")
      .select("*")
      .in("policy_id", policyIds)
      .eq("status", "active"),
  ]);
  if (layerResult.error && layerResult.error.code !== "42P01") throw layerResult.error;
  if (editorResult.error && editorResult.error.code !== "42P01") throw editorResult.error;
  return { layers: layerResult.data || [], editors: editorResult.data || [] };
}

async function loadPolicyUsers(admin: ReturnType<typeof adminClient>) {
  const [profiles, employees] = await Promise.all([
    admin.from("profiles").select("id, email, full_name, status").eq("status", "active").order("full_name"),
    admin.from("hr_employees").select("id, employee_name, user_id, department_id, status").neq("status", "deleted"),
  ]);
  for (const result of [profiles, employees]) {
    if (result.error) throw result.error;
  }
  const employeesByUser = new Map((employees.data || []).filter((employee: any) => employee.user_id).map((employee: any) => [employee.user_id, employee]));
  return {
    users: (profiles.data || []).map((profile: any) => {
      const employee: any = employeesByUser.get(profile.id);
      return {
        id: profile.id,
        label: employee?.employee_name || profile.full_name || profile.email,
        email: profile.email,
        employee_id: employee?.id || null,
        employee_name: employee?.employee_name || null,
      };
    }),
  };
}

export async function GET(request: Request) {
  try {
    const auth = await requireAttendancePolicyView(request);
    if ("response" in auth) return auth.response;
    const admin = adminClient();
    const lookups = await loadEmployeeAttendancePolicyLookups(admin, auth);
    const pairs = lookups.pairs || [];
    const policyKeys = new Set(pairs.map((pair: any) => `${pair.organization_id}:${pair.company_id}:${pair.site_id}`));

    let query = admin
      .from("employee_attendance_policies")
      .select("*")
      .neq("status", "deleted");
    const organizationIds = Array.from(new Set(pairs.map((pair: any) => pair.organization_id).filter(Boolean)));
    if (organizationIds.length > 0) query = query.in("organization_id", organizationIds);
    const { data, error } = await query.order("updated_at", { ascending: false });
    if (error) throw error;

    const policies = (data || []).filter((policy: any) =>
      policyKeys.has(`${policy.organization_id}:${policy.company_id}:${policy.site_id}`),
    );
    const children = await loadPolicyChildren(admin, policies);
    const layersByPolicy = new Map<string, any[]>();
    const editorsByPolicy = new Map<string, any[]>();
    for (const layer of children.layers) layersByPolicy.set(layer.policy_id, [...(layersByPolicy.get(layer.policy_id) || []), layer]);
    for (const editor of children.editors) editorsByPolicy.set(editor.policy_id, [...(editorsByPolicy.get(editor.policy_id) || []), editor]);
    const userLookups = await loadPolicyUsers(admin);
    return NextResponse.json({
      ...lookups,
      ...userLookups,
      policies: policies.map((policy: any) => ({
        ...policy,
        standard_working_hours: EMPLOYEE_STANDARD_WORKING_HOURS,
        approval_level_count: Number.isInteger(Number(policy.approval_level_count)) ? Number(policy.approval_level_count) : 1,
        approval_workflow_version: Number(policy.approval_workflow_version || 1),
        lock_after_hours: Number.isInteger(Number(policy.lock_after_hours)) ? Number(policy.lock_after_hours) : 5,
        approval_layers: (layersByPolicy.get(policy.id) || []).filter((layer) => Number(layer.workflow_version) === Number(policy.approval_workflow_version || 1)),
        post_lock_editors: (editorsByPolicy.get(policy.id) || []).filter((editor) => editor.user_id),
      })),
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load employee attendance policies.", 500);
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireAttendancePolicyWrite(request);
    if ("response" in auth) return auth.response;
    const payload = await request.json().catch(() => ({}));
    const companyId = String(payload.company_id || "").trim();
    const siteId = String(payload.site_id || "").trim();
    const admin = adminClient();
    const scope = await validateEmployeeAttendancePolicyScope(admin, auth, companyId, siteId);
    if ("response" in scope) return scope.response;

    const status = normalizeStatus(payload.status);
    const levelCount = approvalLevelCount(payload.approval_level_count);
    if (levelCount === null) return jsonError("Approval levels must be between 0 and 3.", 400);
    const lockHours = lockAfterHours(payload.lock_after_hours);
    if (lockHours === null) return jsonError("Lock After Hours must be a whole number between 0 and 168.", 400);
    const incomingLayers = normalizeLayers(payload.approval_layers, levelCount);
    const postLockUserIds = normalizeStringArray(payload.post_lock_user_ids);
    for (const layer of incomingLayers) {
      if (!layer.approver_user_id) return jsonError(`Approver is required for Level ${layer.level_sequence}.`, 400);
    }
    const values = {
      organization_id: scope.organizationId,
      company_id: companyId,
      site_id: siteId,
      attendance_method: "manual_hr_entry",
      approval_workflow_code: "employee_attendance_period_approval",
      attendance_lock_rule: String(payload.attendance_lock_rule || "finalized_period").trim() || "finalized_period",
      standard_working_hours: EMPLOYEE_STANDARD_WORKING_HOURS,
      approval_level_count: levelCount,
      lock_after_hours: lockHours,
      status,
      updated_by: auth.user.id,
      updated_by_name: actorName(auth.user),
      updated_by_email: auth.user.email || null,
      updated_at: new Date().toISOString(),
    };

    const { data: existing, error: existingError } = await admin
      .from("employee_attendance_policies")
      .select("*")
      .eq("organization_id", scope.organizationId)
      .eq("company_id", companyId)
      .eq("site_id", siteId)
      .neq("status", "deleted")
      .maybeSingle();
    if (existingError) throw existingError;
    const existingLayers = existing?.id
      ? await admin
          .from("employee_attendance_policy_layers")
          .select("level_sequence, stage_name, approver_user_id")
          .eq("policy_id", existing.id)
          .eq("workflow_version", existing.approval_workflow_version || 1)
          .eq("status", "active")
          .order("level_sequence", { ascending: true })
      : { data: [], error: null };
    if (existingLayers.error && existingLayers.error.code !== "42P01") throw existingLayers.error;
    const existingSignature = JSON.stringify((existingLayers.data || []).map((layer: any) => ({
      level_sequence: Number(layer.level_sequence),
      stage_name: layer.stage_name || `Level ${layer.level_sequence} Approval`,
      approver_user_id: layer.approver_user_id || "",
    })));
    const nextSignature = JSON.stringify(incomingLayers.map((layer) => ({
      level_sequence: layer.level_sequence,
      stage_name: layer.stage_name,
      approver_user_id: layer.approver_user_id,
    })));
    const workflowChanged = !existing || Number(existing.approval_level_count ?? 1) !== levelCount || existingSignature !== nextSignature;
    const workflowVersion = workflowChanged ? Number(existing?.approval_workflow_version || 1) + (existing ? 1 : 0) : Number(existing?.approval_workflow_version || 1);
    const valuesWithWorkflow = { ...values, approval_workflow_version: workflowVersion };

    const result = existing?.id
      ? await admin
          .from("employee_attendance_policies")
          .update(valuesWithWorkflow)
          .eq("id", existing.id)
          .select("*")
          .single()
      : await admin
          .from("employee_attendance_policies")
          .insert({
            ...valuesWithWorkflow,
            created_by: auth.user.id,
            created_by_name: actorName(auth.user),
            created_by_email: auth.user.email || null,
          })
          .select("*")
          .single();
    if (result.error) throw result.error;
    const policyId = result.data.id;
    if (workflowChanged && existing?.id) {
      const inactiveResult = await admin
        .from("employee_attendance_policy_layers")
        .update({ status: "inactive", updated_by: auth.user.id, updated_by_name: actorName(auth.user), updated_by_email: auth.user.email || null, updated_at: new Date().toISOString() })
        .eq("policy_id", policyId)
        .eq("status", "active");
      if (inactiveResult.error && inactiveResult.error.code !== "42P01") throw inactiveResult.error;
    }
    if (workflowChanged && incomingLayers.length) {
      const userIds = incomingLayers.map((layer) => layer.approver_user_id).filter(Boolean) as string[];
      const { data: employeeRows, error: employeeError } = userIds.length
        ? await admin.from("hr_employees").select("id, user_id").in("user_id", userIds).neq("status", "deleted")
        : { data: [], error: null };
      if (employeeError) throw employeeError;
      const employeeByUser = new Map((employeeRows || []).map((employee: any) => [employee.user_id, employee.id]));
      const insertResult = await admin.from("employee_attendance_policy_layers").insert(incomingLayers.map((layer) => ({
        policy_id: policyId,
        organization_id: scope.organizationId,
        company_id: companyId,
        site_id: siteId,
        workflow_version: workflowVersion,
        level_sequence: layer.level_sequence,
        stage_name: layer.stage_name,
        approver_user_id: layer.approver_user_id,
        approver_employee_id: employeeByUser.get(layer.approver_user_id) || null,
        status: "active",
        created_by: auth.user.id,
        created_by_name: actorName(auth.user),
        created_by_email: auth.user.email || null,
      })));
      if (insertResult.error) throw insertResult.error;
    }

    const existingEditors = await admin
      .from("employee_attendance_post_lock_editors")
      .select("*")
      .eq("policy_id", policyId)
      .eq("status", "active");
    if (existingEditors.error && existingEditors.error.code !== "42P01") throw existingEditors.error;
    const existingEditorRows = existingEditors.data || [];
    const nextUserIds = new Set(postLockUserIds);
    const cancelEditorIds = existingEditorRows
      .filter((row: any) => row.role_code || (row.user_id && !nextUserIds.has(row.user_id)))
      .map((row: any) => row.id);
    if (cancelEditorIds.length) {
      const cancelResult = await admin
        .from("employee_attendance_post_lock_editors")
        .update({ status: "cancelled", updated_by: auth.user.id, updated_by_name: actorName(auth.user), updated_by_email: auth.user.email || null, updated_at: new Date().toISOString() })
        .in("id", cancelEditorIds);
      if (cancelResult.error) throw cancelResult.error;
    }
    const existingUserIds = new Set(existingEditorRows.map((row: any) => row.user_id).filter(Boolean));
    const editorRows = [
      ...postLockUserIds.filter((userId) => !existingUserIds.has(userId)).map((userId) => ({ role_code: null, user_id: userId })),
    ].map((row) => ({
      policy_id: policyId,
      organization_id: scope.organizationId,
      company_id: companyId,
      site_id: siteId,
      ...row,
      status: "active",
      assigned_by: auth.user.id,
      assigned_by_name: actorName(auth.user),
      assigned_by_email: auth.user.email || null,
    }));
    if (editorRows.length) {
      const editorInsert = await admin.from("employee_attendance_post_lock_editors").insert(editorRows);
      if (editorInsert.error) throw editorInsert.error;
    }

    await insertErpAuditLog(admin, auth.user, {
      organizationId: scope.organizationId,
      companyId,
      siteId,
      moduleCode: "hr_employee_attendance_policy",
      entityType: "employee_attendance_policy",
      recordId: result.data.id,
      action: existing ? "update" : "create",
      description: existing ? "Employee attendance policy updated." : "Employee attendance policy created.",
      oldValues: existing || null,
      newValues: { ...result.data, approval_layers: incomingLayers, post_lock_user_ids: postLockUserIds },
      source: "system",
    }, request);

    return NextResponse.json({ policy: result.data });
  } catch (error: any) {
    return jsonError(error.message || "Failed to save employee attendance policy.", 500);
  }
}
