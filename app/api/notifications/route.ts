import { NextResponse } from "next/server";
import { loadNotificationFeed } from "@/lib/notificationFeed.server";
import { sanitizeNotificationTargetUrl } from "@/lib/notificationPresentation";
import { loadNotificationRequestScope } from "@/lib/serverNotificationScope";

function errorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message || fallback }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  try {
    const scope = await loadNotificationRequestScope(request);
    if ("response" in scope) return scope.response;
    if ("error" in scope) return NextResponse.json({ error: scope.error }, { status: scope.status });

    const rawLimit = Number(new URL(request.url).searchParams.get("limit") || 25);
    const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.floor(rawLimit))) : 25;
    const feed = await loadNotificationFeed(scope.admin, scope.auth.user.id, scope.organizationId, limit);
    const notifications = feed.rows.map((row: any) => ({
      ...row,
      target_url: sanitizeNotificationTargetUrl(row.target_url),
    }));
    return NextResponse.json({ notifications, unread_count: feed.unreadCount }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "Failed to load notifications.");
  }
}

export async function PATCH(request: Request) {
  try {
    const scope = await loadNotificationRequestScope(request);
    if ("response" in scope) return scope.response;
    if ("error" in scope) return NextResponse.json({ error: scope.error }, { status: scope.status });

    const payload = await request.json().catch(() => ({}));
    const id = String(payload.id || "").trim();
    if (!id) return NextResponse.json({ error: "Notification is required." }, { status: 400 });
    const { data, error } = await scope.admin.from("user_notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("id", id)
      .eq("recipient_user_id", scope.auth.user.id)
      .eq("organization_id", scope.organizationId)
      .select("id, target_url")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Notification not found." }, { status: 404 });
    return NextResponse.json({ notification: { ...data, target_url: sanitizeNotificationTargetUrl(data.target_url) } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "Failed to mark notification read.");
  }
}
