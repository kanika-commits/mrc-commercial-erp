import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";
import { applyOrganizationScope, loadActorOrganizationScope } from "@/lib/serverOrganizationScope";

const BUCKET = "work-order-pilot-ra-bill-attachments";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "text/plain"]);
const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function bill(admin: any, id: string, scope: string[] | null) {
  let q = admin.from("work_order_pilot_ra_bills").select("id,organization_id,status,work_order:work_orders!inner(creation_request_id,approval_status)").eq("id", id).eq("work_order.approval_status", "approved").not("work_order.creation_request_id", "is", null);
  q = applyOrganizationScope(q, scope); if (!q) return null;
  const result = await q.maybeSingle(); if (result.error) throw result.error; return result.data;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission(request, "work_orders", "view"); if ("response" in auth) return auth.response;
    const admin = db(); const scope = await loadActorOrganizationScope(admin, auth); const record = await bill(admin, (await params).id, scope);
    if (!record) return NextResponse.json({ error: "Pilot RA Bill not found." }, { status: 404 });
    const result = await admin.from("work_order_pilot_ra_bill_attachments").select("id,original_file_name,mime_type,size_bytes,sha256,status,created_at,submitted_at").eq("ra_bill_id", record.id).neq("status", "removed").order("created_at");
    if (result.error) throw result.error; return NextResponse.json({ attachments: result.data || [] });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Could not load Pilot attachments." }, { status: 500 }); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let uploadedKey = "";
  try {
    const auth = await requirePermission(request, "work_orders", "edit"); if ("response" in auth) return auth.response;
    const admin = db(); const scope = await loadActorOrganizationScope(admin, auth); const record = await bill(admin, (await params).id, scope);
    if (!record) return NextResponse.json({ error: "Pilot RA Bill not found." }, { status: 404 });
    if (!["draft", "sent_back"].includes(record.status)) return NextResponse.json({ error: "Attachments can only be changed while the Pilot RA Bill is editable." }, { status: 409 });
    const form = await request.formData(); const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to attach." }, { status: 422 });
    if (file.size <= 0 || file.size > MAX_BYTES) return NextResponse.json({ error: "Attachments must be between 1 byte and 10 MB." }, { status: 422 });
    if (!ALLOWED.has(file.type)) return NextResponse.json({ error: "Only PDF, PNG, JPEG, WebP, or text attachments are allowed." }, { status: 422 });
    const bytes = Buffer.from(await file.arrayBuffer()); const hash = crypto.createHash("sha256").update(bytes).digest("hex"); const id = crypto.randomUUID();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120) || "attachment"; uploadedKey = `${record.organization_id}/${record.id}/${id}-${safeName}`;
    const storage = await admin.storage.from(BUCKET).upload(uploadedKey, bytes, { contentType: file.type, upsert: false }); if (storage.error) throw storage.error;
    const inserted = await admin.from("work_order_pilot_ra_bill_attachments").insert({ id, organization_id: record.organization_id, ra_bill_id: record.id, original_file_name: file.name, mime_type: file.type, size_bytes: file.size, storage_bucket: BUCKET, storage_key: uploadedKey, sha256: hash, created_by: auth.user.id }).select("id,original_file_name,mime_type,size_bytes,sha256,status,created_at").single();
    if (inserted.error) throw inserted.error; return NextResponse.json({ attachment: inserted.data });
  } catch (error: any) {
    if (uploadedKey) await db().storage.from(BUCKET).remove([uploadedKey]).catch(() => null);
    return NextResponse.json({ error: error.message || "Could not upload Pilot attachment." }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission(request, "work_orders", "edit"); if ("response" in auth) return auth.response;
    const admin = db(); const scope = await loadActorOrganizationScope(admin, auth); const record = await bill(admin, (await params).id, scope); if (!record) return NextResponse.json({ error: "Pilot RA Bill not found." }, { status: 404 });
    if (record.status !== "draft" && record.status !== "sent_back") return NextResponse.json({ error: "Submitted Pilot attachments cannot be removed." }, { status: 409 });
    const body = await request.json(); const attachment = await admin.from("work_order_pilot_ra_bill_attachments").select("id,storage_bucket,storage_key").eq("id", String(body.attachment_id || "")).eq("ra_bill_id", record.id).eq("status", "draft").maybeSingle(); if (attachment.error) throw attachment.error; if (!attachment.data) return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
    await admin.storage.from(BUCKET).remove([attachment.data.storage_key]); const removed = await admin.from("work_order_pilot_ra_bill_attachments").update({ status: "removed" }).eq("id", attachment.data.id).eq("ra_bill_id", record.id); if (removed.error) throw removed.error; return NextResponse.json({ ok: true });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Could not remove Pilot attachment." }, { status: 400 }); }
}
