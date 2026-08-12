import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAnyPermission } from "@/lib/serverPermissions";

function adminClient() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!); }

export async function GET(request: Request) {
  try {
    const auth = await requireAnyPermission(request, [{ moduleCode: "labour_attendance", actionCode: "view" }, { moduleCode: "labour_daily_submission", actionCode: "view" }]);
    if ("response" in auth) return auth.response;
    const limit = Math.min(50, Math.max(1, Number(new URL(request.url).searchParams.get("limit") || 25)));
    const { data, error } = await adminClient().from("user_notifications").select("id, notification_type, title, message, target_url, related_entity_type, related_entity_id, is_read, read_at, created_at").eq("recipient_user_id", auth.user.id).order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return NextResponse.json({ notifications: data || [] });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Failed to load notifications." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireAnyPermission(request, [{ moduleCode: "labour_attendance", actionCode: "view" }, { moduleCode: "labour_daily_submission", actionCode: "view" }]);
    if ("response" in auth) return auth.response;
    const payload = await request.json().catch(() => ({}));
    const id = String(payload.id || "").trim();
    if (!id) return NextResponse.json({ error: "Notification is required." }, { status: 400 });
    const { data, error } = await adminClient().from("user_notifications").update({ is_read: true, read_at: new Date().toISOString() }).eq("id", id).eq("recipient_user_id", auth.user.id).select("id, target_url").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Notification not found." }, { status: 404 });
    return NextResponse.json({ notification: data });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Failed to mark notification read." }, { status: 500 }); }
}
