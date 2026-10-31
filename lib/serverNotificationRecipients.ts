type AdminClient = { from: (table: string) => any };

type ResolveOptions = {
  organizationId: string;
  companyId?: string | null;
  siteId?: string | null;
  moduleCode: string;
  actionCode: string;
  requiredRoleCodes?: string[];
};

export async function resolveNotificationRecipients(admin: AdminClient, options: ResolveOptions) {
  const assignments = await admin.from("user_access_assignments").select("user_id,company_id,site_id").eq("organization_id", options.organizationId);
  if (assignments.error) throw assignments.error;
  const rows = assignments.data || [];
  // user_roles is a user-to-role link table; organization scope lives on
  // user_access_assignments, not on user_roles.
  const organizationRoles = await admin.from("user_roles").select("user_id,role_id");
  if (organizationRoles.error) throw organizationRoles.error;
  const userIds = [...new Set([...rows.map((row: any) => row.user_id), ...(organizationRoles.data || []).map((row: any) => row.user_id)].filter(Boolean))];
  if (!userIds.length) return [];
  const [profiles, direct] = await Promise.all([
    admin.from("profiles").select("id,status").in("id", userIds),
    admin.from("user_permissions").select("user_id,allowed").in("user_id", userIds).eq("module_code", options.moduleCode).eq("action_code", options.actionCode),
  ]);
  if (profiles.error || direct.error) throw profiles.error || direct.error;
  const roleIds = [...new Set((organizationRoles.data || []).map((row: any) => row.role_id).filter(Boolean))];
  const [roles, rolePermissions] = roleIds.length ? await Promise.all([
    admin.from("roles").select("id,role_code,status").in("id", roleIds),
    admin.from("role_permissions").select("role_id,allowed").in("role_id", roleIds).eq("module_code", options.moduleCode).eq("action_code", options.actionCode),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (roles.error || rolePermissions.error) throw roles.error || rolePermissions.error;
  const activeProfiles = new Set((profiles.data || []).filter((row: any) => row.status === "active").map((row: any) => row.id));
  const roleById = new Map((roles.data || []).filter((row: any) => !["inactive", "disabled", "deleted"].includes(row.status)).map((row: any) => [row.id, row]));
  const directDecision = new Map((direct.data || []).map((row: any) => [row.user_id, row.allowed === true]));
  const allowedRoleIds = new Set((rolePermissions.data || []).filter((row: any) => row.allowed === true).map((row: any) => row.role_id));
  const requiredRoles = new Set(options.requiredRoleCodes || []);
  const result = new Set<string>();
  for (const userId of userIds) {
    if (!activeProfiles.has(userId)) continue;
    const userRoleRows = (organizationRoles.data || []).filter((row: any) => row.user_id === userId);
    const userRoleValues = userRoleRows.map((row: any) => roleById.get(row.role_id)).filter(Boolean);
    const global = userRoleValues.some((role: any) => role.role_code === "platform_owner");
    const hasRequiredRole = !requiredRoles.size || userRoleValues.some((role: any) => requiredRoles.has(role.role_code));
    const rolePermitted = userRoleRows.some((row: any) => allowedRoleIds.has(row.role_id));
    const permitted = global || (directDecision.has(userId) ? directDecision.get(userId) === true : rolePermitted);
    const scoped = global || rows.some((row: any) => row.user_id === userId && (!row.company_id || row.company_id === options.companyId) && (!row.site_id || row.site_id === options.siteId));
    if (permitted && hasRequiredRole && scoped) result.add(userId);
  }
  return [...result];
}

export async function insertNotificationOnce(admin: AdminClient, notification: Record<string, unknown>) {
  const existing = await admin.from("user_notifications").select("id").match({
    organization_id: notification.organization_id,
    recipient_user_id: notification.recipient_user_id,
    notification_type: notification.notification_type,
    related_entity_type: notification.related_entity_type,
    related_entity_id: notification.related_entity_id,
  }).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return { created: false, id: existing.data.id };
  const result = await admin.from("user_notifications").insert(notification).select("id").maybeSingle();
  if (result.error && result.error.code !== "23505") throw result.error;
  return { created: !result.error, id: result.data?.id || null };
}
