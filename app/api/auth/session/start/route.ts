import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/auditEvent";
import { jsonError, sessionRequestContext, validateSessionId } from "../_shared";

export async function POST(request: Request) {
  try {
    const context = await sessionRequestContext(request);
    if ("response" in context) return context.response;
    const body = await request.json().catch(() => ({}));
    const sessionId = validateSessionId(body.session_id);

    const existingSession = await context.admin
      .from("user_session_activity")
      .select("id, user_id")
      .eq("session_id", sessionId)
      .maybeSingle();
    if (existingSession.error) throw existingSession.error;
    if (existingSession.data && existingSession.data.user_id !== context.user.id) {
      return jsonError("Session id belongs to another user.", 403);
    }

    const now = new Date().toISOString();
    const presencePayload: Record<string, unknown> = {
      session_id: sessionId,
      user_id: context.user.id,
      organization_id: context.metadata.organization_id,
      last_seen_at: now,
      logout_at: null,
      browser: context.metadata.browser,
      device_type: context.metadata.device_type,
      ip_address: context.metadata.ip_address,
      user_agent: context.metadata.user_agent,
      updated_at: now,
    };

    let data: any = null;
    let loginAuditRequired = false;

    if (existingSession.data) {
      const updateResult = await context.admin
        .from("user_session_activity")
        .update(presencePayload)
        .eq("id", existingSession.data.id)
        .eq("user_id", context.user.id)
        .select("id, session_id, login_at, active_since_at, last_seen_at")
        .single();

      if (updateResult.error) throw updateResult.error;
      data = updateResult.data;
    } else {
      const insertResult = await context.admin
        .from("user_session_activity")
        .insert({
          ...presencePayload,
          active_since_at: now,
          login_at: now,
        })
        .select("id, session_id, login_at, last_seen_at")
        .single();

      if (insertResult.error) {
        if (insertResult.error.code !== "23505") throw insertResult.error;

        const existingAfterConflict = await context.admin
          .from("user_session_activity")
          .select("id, user_id")
          .eq("session_id", sessionId)
          .maybeSingle();

        if (existingAfterConflict.error) throw existingAfterConflict.error;
        if (existingAfterConflict.data && existingAfterConflict.data.user_id !== context.user.id) {
          return jsonError("Session id belongs to another user.", 403);
        }
        if (!existingAfterConflict.data) throw insertResult.error;

        const updateResult = await context.admin
          .from("user_session_activity")
          .update(presencePayload)
          .eq("id", existingAfterConflict.data.id)
          .eq("user_id", context.user.id)
          .select("id, session_id, login_at, active_since_at, last_seen_at")
          .single();

        if (updateResult.error) throw updateResult.error;
        data = updateResult.data;
      } else {
        data = insertResult.data;
        loginAuditRequired = true;
      }
    }

    if (loginAuditRequired) {
      try {
        await recordAuditEvent(context.admin, context.user, {
          organizationId: context.metadata.organization_id,
          moduleCode: "authentication",
          entityType: "user_session",
          recordId: data.id,
          recordNumber: data.session_id,
          action: "login",
          actionCategory: "session",
          activityLabel: "Logged In",
          description: "User logged in.",
          workflowStage: "Session",
          newValues: {
            session_id: data.session_id,
            login_at: data.login_at,
            active_since_at: data.active_since_at,
            last_seen_at: data.last_seen_at,
            browser: context.metadata.browser,
            device_type: context.metadata.device_type,
            ip_address: context.metadata.ip_address,
          },
        }, request);
      } catch (auditError) {
        console.error("[Auth Audit] Login audit failed", auditError);
      }
    }

    return NextResponse.json({ session: data });
  } catch (error: any) {
    return jsonError(error.message || "Failed to start session.", 500);
  }
}
