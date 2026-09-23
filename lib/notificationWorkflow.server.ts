import "server-only";

import { buildNotificationEventKey, insertNotificationOnce } from "@/lib/notificationEvent.server";
import { extractApprovalLevel } from "@/lib/notificationDecision.mjs";

type WorkflowNotificationInput = {
  eventType: string;
  entityType: string;
  entityId: string;
  cycleId: string;
  organizationId: string;
  companyId?: string | null;
  siteId?: string | null;
  title: string;
  message: string;
  targetUrl: string;
  recipientIds: string[];
  actorId?: string | null;
  requiredPermission?: { moduleCode: string; actionCode: string };
  stage?: string | number | null;
};

/** Best-effort delivery for a successful workflow transition. */
export async function notifyWorkflowRecipients(admin: any, input: WorkflowNotificationInput) {
  try {
    const recipientIds = Array.from(new Set(input.recipientIds.filter((id) => id && id !== input.actorId)));
    if (!recipientIds.length) return;
    const { data: profiles, error: profileError } = await admin
      .from("profiles")
      .select("id, status")
      .in("id", recipientIds)
      .eq("status", "active");
    if (profileError) throw profileError;
    const activeIds = new Set((profiles || []).map((profile: any) => profile.id));
    if (input.requiredPermission && activeIds.size) {
      const [{ data: direct, error: directError }, { data: roles, error: rolesError }] = await Promise.all([
        admin.from("user_permissions").select("user_id, module_code, action_code, allowed").in("user_id", Array.from(activeIds)),
        admin.from("user_roles").select("user_id, role_id").in("user_id", Array.from(activeIds)),
      ]);
      if (directError) throw directError; if (rolesError) throw rolesError;
      const roleIds = Array.from(new Set((roles || []).map((r: any) => r.role_id).filter(Boolean)));
      const { data: rolePermissions, error: roleError } = roleIds.length ? await admin.from("role_permissions").select("role_id, module_code, action_code, allowed").in("role_id", roleIds) : { data: [], error: null };
      if (roleError) throw roleError;
      const directAllowed = new Set((direct || []).filter((p: any) => p.allowed).map((p: any) => `${p.user_id}:${p.module_code}:${p.action_code}`));
      const roleByUser = new Map<string, string[]>(); for (const r of roles || []) roleByUser.set(r.user_id, [...(roleByUser.get(r.user_id) || []), r.role_id]);
      const roleAllowed = new Set((rolePermissions || []).filter((p: any) => p.allowed).map((p: any) => `${String(p.role_id)}:${p.module_code}:${p.action_code}`));
      for (const id of Array.from(activeIds)) { const userId = String(id); const ok = directAllowed.has(`${userId}:${input.requiredPermission.moduleCode}:${input.requiredPermission.actionCode}`) || (roleByUser.get(userId) || []).some(r => roleAllowed.has(`${String(r)}:${input.requiredPermission!.moduleCode}:${input.requiredPermission!.actionCode}`)); if (!ok) activeIds.delete(id); }
    }
    const { data: assignments, error: assignmentError } = await admin
      .from("user_access_assignments")
      .select("user_id, organization_id, company_id, site_id")
      .eq("organization_id", input.organizationId)
      .in("user_id", Array.from(activeIds));
    if (assignmentError) throw assignmentError;
    const scopedIds = new Set((assignments || []).filter((assignment: any) => {
      if (!input.companyId && !input.siteId) return true;
      if (input.siteId && assignment.site_id) return assignment.site_id === input.siteId;
      if (input.companyId && assignment.company_id) return assignment.company_id === input.companyId;
      return !assignment.site_id && !assignment.company_id;
    }).map((assignment: any) => assignment.user_id));
    const eventKey = buildNotificationEventKey({ eventType: input.eventType, entityType: input.entityType, entityId: input.entityId, cycleId: `${input.cycleId}:${input.stage || "default"}` });
    await Promise.all(Array.from(scopedIds).map((recipientId) => insertNotificationOnce(admin, {
      organization_id: input.organizationId,
      recipient_user_id: recipientId,
      event_key: eventKey,
      title: input.title,
      message: input.message,
      target_url: input.targetUrl,
      is_read: false,
    })));
  } catch (error) {
    console.error("Workflow notification delivery failed:", error);
  }
}

export function approvalLayerRecipientIds(snapshot: any, level: number) {
  const layers = Array.isArray(snapshot?.approval_layers) ? snapshot.approval_layers : [];
  if (extractApprovalLevel(snapshot) === null) return [];
  return layers.filter((layer: any) => Number(layer.level ?? layer.layer_number ?? layer.approval_level) === level).map((layer: any) => layer.approver_user_id).filter(Boolean);
}
