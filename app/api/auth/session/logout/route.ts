import { NextResponse } from "next/server";
import { jsonError, sessionRequestContext, validateSessionId } from "../_shared";

export async function POST(request: Request) {
  try {
    const context = await sessionRequestContext(request);
    if ("response" in context) return context.response;
    const body = await request.json().catch(() => ({}));
    const sessionId = validateSessionId(body.session_id);
    const now = new Date().toISOString();

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
    return NextResponse.json({ session: data || null });
  } catch (error: any) {
    return jsonError(error.message || "Failed to close session.", 500);
  }
}
