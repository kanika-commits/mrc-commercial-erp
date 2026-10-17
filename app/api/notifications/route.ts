import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadPermissionContext } from "@/lib/serverPermissions";

function adminClient() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!); }

async function notificationLifecycle(admin: any, notification: any) {
  const id = notification.related_entity_id;
  if (!id) return { resolved: false, deleted: false };
  const type = String(notification.notification_type || "");
  const query = type === "work_order_submitted_for_approval"
    ? admin.from("work_orders").select("id,status,approval_status").eq("id", id).maybeSingle()
    : type === "contractor_recovery_debit_note"
      ? admin.from("debit_notes").select("id,status,approval_status,is_deleted").eq("id", id).maybeSingle()
      : type === "pilot_ra_bill_over_quantity_exception"
        ? admin.from("work_order_pilot_ra_bills").select("id,status,over_quantity_exception_status").eq("id", id).maybeSingle()
        : type === "labour_attendance_sent_back"
          ? admin.from("labour_attendance_periods").select("id,status").eq("id", id).maybeSingle()
          : null;
  if (!query) return { resolved: false, deleted: false };
  const result = await query;
  if (result.error) throw result.error;
  if (!result.data) return { resolved: false, deleted: true };
  const row = result.data;
  if (type === "work_order_submitted_for_approval") return { resolved: !["pending", "submitted"].includes(String(row.approval_status || row.status || "").toLowerCase()), deleted: false };
  if (type === "contractor_recovery_debit_note") return { resolved: Boolean(row.is_deleted) || String(row.status || "").toLowerCase() !== "draft", deleted: false };
  if (type === "pilot_ra_bill_over_quantity_exception") return { resolved: String(row.over_quantity_exception_status || "").toLowerCase() !== "pending", deleted: false };
  return { resolved: String(row.status || "").toLowerCase() !== "reopened", deleted: false };
}

export async function GET(request: Request) {
  try {
    const auth = await loadPermissionContext(request);
    if ("response" in auth) return auth.response;
    const limit = Math.min(50, Math.max(1, Number(new URL(request.url).searchParams.get("limit") || 25)));
    const admin = adminClient();
    const { data, error } = await admin.from("user_notifications").select("id, notification_type, title, message, target_url, related_entity_type, related_entity_id, is_read, read_at, dismissed_at, created_at").eq("recipient_user_id", auth.user.id).is("dismissed_at", null).order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    const notifications = [] as any[];
    for (const notification of data || []) {
      const state = await notificationLifecycle(admin, notification);
      if (state.resolved) { await admin.from("user_notifications").update({ dismissed_at: new Date().toISOString() }).eq("id", notification.id).eq("recipient_user_id", auth.user.id); continue; }
      if (state.deleted) {
        const message = `${notification.message || "The linked record"} was deleted.`;
        await admin.from("user_notifications").update({ title: "Notification: linked record deleted", message }).eq("id", notification.id).eq("recipient_user_id", auth.user.id);
        notifications.push({ ...notification, title: "Notification: linked record deleted", message });
      } else notifications.push(notification);
    }
    return NextResponse.json({ notifications });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Failed to load notifications." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const auth = await loadPermissionContext(request);
    if ("response" in auth) return auth.response;
    const payload = await request.json().catch(() => ({}));
    const id = String(payload.id || "").trim();
    if (!id) return NextResponse.json({ error: "Notification is required." }, { status: 400 });
    const { data, error } = await adminClient().from("user_notifications").update({ is_read: true, read_at: new Date().toISOString(), dismissed_at: new Date().toISOString() }).eq("id", id).eq("recipient_user_id", auth.user.id).select("id, target_url").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Notification not found." }, { status: 404 });
    return NextResponse.json({ notification: data });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Failed to mark notification read." }, { status: 500 }); }
}
