import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/auditEvent";
import { jsonError, sessionRequestContext, validateSessionId } from "../_shared";

export async function POST(request: Request) {
  try {
    const context = await sessionRequestContext(request);
    if ("response" in context) return context.response;
    const body = await request.json().catch(() => ({}));
    const sessionId = validateSessionId(body.session_id);
    const now = new Date().toISOString();

    const existing = await context.admin
      .from("user_session_activity")
      .select("id, logout_at")
      .eq("session_id", sessionId)
      .eq("user_id", context.user.id)
      .maybeSingle();
    if (existing.error) throw existing.error;
    const shouldAuditLogout = Boolean(existing.data && !existing.data.logout_at);

    const { data, error } = await context.admin
      .from("user_session_activity")
      .update({
        last_seen_at: now,
        logout_at: now,
        browser: context.metadata.browser,
        device_type: context.metadata.device_type,
        ip_address: context.metadata.ip_address,
        user_agent: context.metadata.user_agent,
        updated_at: now,
      })
      .eq("session_id", sessionId)
      .eq("user_id", context.user.id)
      .select("id, logout_at, last_seen_at")
      .maybeSingle();
    if (error) throw error;

    if (data && shouldAuditLogout) {
      try {
        await recordAuditEvent(context.admin, context.user, {
          organizationId: context.metadata.organization_id,
          moduleCode: "authentication",
          entityType: "user_session",
          recordId: data.id,
          recordNumber: sessionId,
          action: "logout",
          actionCategory: "session",
          activityLabel: "Logged Out",
          description: "User logged out.",
          workflowStage: "Session",
          newValues: {
            session_id: sessionId,
            logout_at: data.logout_at,
            last_seen_at: data.last_seen_at,
            browser: context.metadata.browser,
            device_type: context.metadata.device_type,
            ip_address: context.metadata.ip_address,
          },
        }, request);
      } catch (auditError) {
        console.error("[Auth Audit] Logout audit failed", auditError);
      }
    }

    return NextResponse.json({ session: data || null });
  } catch (error: any) {
    return jsonError(error.message || "Failed to close session.", 500);
  }
}
