import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";
import { applyOrganizationScope, loadActorOrganizationScope } from "@/lib/serverOrganizationScope";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  try {
    const auth = await requirePermission(request, "work_orders", "approve"); if ("response" in auth) return auth.response;
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!); const scope = await loadActorOrganizationScope(admin, auth); const { id, attachmentId } = await params;
    let q = admin.from("work_order_pilot_ra_bill_attachments").select("id,storage_bucket,storage_key,status,ra_bill:work_order_pilot_ra_bills!inner(id,organization_id,status,work_order:work_orders!inner(creation_request_id,approval_status))").eq("id", attachmentId).eq("ra_bill_id", id).eq("ra_bill.status", "submitted").eq("ra_bill.work_order.approval_status", "approved").not("ra_bill.work_order.creation_request_id", "is", null);
    q = applyOrganizationScope(q, scope); if (!q) return NextResponse.json({ error: "Attachment is outside your authorized Pilot scope." }, { status: 404 }); const result = await q.maybeSingle(); if (result.error) throw result.error; if (!result.data) return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
    const signed = await admin.storage.from("work-order-pilot-ra-bill-attachments").createSignedUrl(result.data.storage_key, 300); if (signed.error) throw signed.error; return NextResponse.json({ url: signed.data.signedUrl, expires_in: 300 });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Could not authorize Pilot attachment." }, { status: 400 }); }
}
