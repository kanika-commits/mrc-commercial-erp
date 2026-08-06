import { NextResponse } from "next/server";
import { jsonError, sessionRequestContext, validateSessionId } from "../_shared";

export async function POST(request: Request) {
  try {
    const context = await sessionRequestContext(request);
    if ("response" in context) return context.response;
    const body = await request.json().catch(() => ({}));
    const sessionId = validateSessionId(body.session_id);

    const existing = await context.admin
      .from("user_session_activity")
      .select("id, user_id")
      .eq("session_id", sessionId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data && existing.data.user_id !== context.user.id) {
      return jsonError("Session id belongs to another user.", 403);
    }

    const now = new Date().toISOString();
    const payload: Record<string, unknown> = {
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
    if (!existing.data) payload.login_at = now;

    const { data, error } = await context.admin
      .from("user_session_activity")
      .upsert(payload, { onConflict: "session_id" })
      .select("id, session_id, login_at, last_seen_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ session: data });
  } catch (error: any) {
    return jsonError(error.message || "Failed to start session.", 500);
  }
}
