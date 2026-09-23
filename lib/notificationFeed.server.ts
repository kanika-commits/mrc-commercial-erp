const NOTIFICATION_COLUMNS = "id, notification_type, title, message, target_url, related_entity_type, related_entity_id, is_read, read_at, created_at";

export async function loadNotificationFeed(admin: any, recipientUserId: string, organizationId: string, limit: number) {
  const [rowsResult, unreadResult] = await Promise.all([
    admin.from("user_notifications").select(NOTIFICATION_COLUMNS)
      .eq("recipient_user_id", recipientUserId)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(limit),
    admin.from("user_notifications").select("id", { count: "exact", head: true })
      .eq("recipient_user_id", recipientUserId)
      .eq("organization_id", organizationId)
      .eq("is_read", false),
  ]);
  if (rowsResult.error) throw rowsResult.error;
  if (unreadResult.error) throw unreadResult.error;
  return { rows: rowsResult.data || [], unreadCount: unreadResult.count || 0 };
}
