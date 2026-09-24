type QueryClient = { from: (table: string) => any };

export async function findActiveUserResponsibilities(admin: QueryClient, userId: string) {
  const [siteHr, siteConfig, overrides, organizationConfig, siteInEngineers, dailyEngineers, attendanceEditors, requisitionApprovers] = await Promise.all([
    admin.from("site_hr_assignments").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "active"),
    admin.from("labour_site_configurations").select("id", { count: "exact", head: true }).eq("status", "active").or(`site_hr_user_id.eq.${userId},pm_user_id.eq.${userId}`),
    admin.from("labour_site_override_authorities").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "active"),
    admin.from("labour_organization_configurations").select("id", { count: "exact", head: true }).eq("ho_hr_user_id", userId).eq("status", "active"),
    admin.from("labour_site_in_engineer_assignments").select("id", { count: "exact", head: true }).eq("engineer_user_id", userId).eq("status", "active"),
    admin.from("labour_daily_work_engineer_assignments").select("id", { count: "exact", head: true }).eq("engineer_user_id", userId).eq("status", "active"),
    admin.from("employee_attendance_post_lock_editors").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "active"),
    admin.from("purchase_requisition_approval_layers").select("id", { count: "exact", head: true }).eq("approver_user_id", userId).eq("status", "active"),
  ]);

  const results = [siteHr, siteConfig, overrides, organizationConfig, siteInEngineers, dailyEngineers, attendanceEditors, requisitionApprovers];
  for (const result of results) if (result.error) throw result.error;

  return [
    ...(siteHr.count ? ["active Site HR assignment"] : []),
    ...(siteConfig.count ? ["active PM/Site responsibility"] : []),
    ...(overrides.count ? ["active attendance override authority"] : []),
    ...(organizationConfig.count ? ["active organization HR responsibility"] : []),
    ...(siteInEngineers.count || dailyEngineers.count ? ["active engineer responsibility"] : []),
    ...(attendanceEditors.count ? ["active attendance editor responsibility"] : []),
    ...(requisitionApprovers.count ? ["active purchase approval responsibility"] : []),
  ];
}

export async function revokeUserAccess(admin: QueryClient, userId: string) {
  for (const table of ["user_roles", "user_permissions", "user_access_assignments"]) {
    const result = await admin.from(table).delete().eq("user_id", userId);
    if (result.error) throw result.error;
  }
}
