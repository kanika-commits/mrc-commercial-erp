import { NextResponse } from "next/server";
import { HEARTBEAT_MIN_WRITE_INTERVAL_MS, jsonError, sessionRequestContext, validateSessionId } from "../_shared";

export async function POST(request: Request) {
  try {
    const context = await sessionRequestContext(request);
    if ("response" in context) return context.response;
    const body = await request.json().catch(() => ({}));
    const sessionId = validateSessionId(body.session_id);
    const resume = body.resume === true;

    const existing = await context.admin
      .from("user_session_activity")
      .select("id, last_seen_at, active_since_at")
      .eq("session_id", sessionId)
      .eq("user_id", context.user.id)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) return jsonError("Session not found.", 404);

    const nowDate = new Date();
    const previous = existing.data.last_seen_at ? new Date(existing.data.last_seen_at) : null;
    if (previous && nowDate.getTime() - previous.getTime() < HEARTBEAT_MIN_WRITE_INTERVAL_MS) {
      return NextResponse.json({ skipped: true, last_seen_at: existing.data.last_seen_at });
    }

    const now = nowDate.toISOString();
    const { data, error } = await context.admin
      .from("user_session_activity")
      .update({
        ...(resume ? { active_since_at: now } : {}),
        last_seen_at: now,
        browser: context.metadata.browser,
        device_type: context.metadata.device_type,
        ip_address: context.metadata.ip_address,
        user_agent: context.metadata.user_agent,
        updated_at: now,
      })
      .eq("id", existing.data.id)
      .eq("user_id", context.user.id)
      .select("id, active_since_at, last_seen_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ session: data });
  } catch (error: any) {
    return jsonError(error.message || "Failed to update session heartbeat.", 500);
  }
}
