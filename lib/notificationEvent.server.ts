import "server-only";

export type NotificationEventIdentity = {
  eventType: string;
  entityType: string;
  entityId: string;
  cycleId: string;
};

export const NOTIFICATION_EVENT_KEY_MAX_LENGTH = 256;
export const NOTIFICATION_EVENT_CONFLICT_TARGET = "organization_id,recipient_user_id,event_key";

/** Stable, bounded event identity. Call only from server-side producers. */
export function buildNotificationEventKey(identity: NotificationEventIdentity): string {
  const parts = [identity.eventType, identity.entityType, identity.entityId, identity.cycleId]
    .map((part) => String(part || "").trim());
  if (parts.some((part) => !part)) throw new Error("Notification event identity is incomplete.");
  const key = JSON.stringify(parts);
  if (Array.from(key).length > NOTIFICATION_EVENT_KEY_MAX_LENGTH) {
    throw new Error(`Notification event key exceeds ${NOTIFICATION_EVENT_KEY_MAX_LENGTH} characters.`);
  }
  return key;
}

/** Insert once using only the event identity index as the conflict target. */
export async function insertNotificationOnce(admin: any, notification: Record<string, unknown>) {
  const { error } = await admin.from("user_notifications").upsert(notification, {
    onConflict: NOTIFICATION_EVENT_CONFLICT_TARGET,
    ignoreDuplicates: true,
  });
  if (error) throw error;
}
