import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";
import { applyOrganizationScope, loadActorOrganizationScope } from "@/lib/serverOrganizationScope";
import { decodePilotPdfBytes, pilotPdfIntegrity } from "@/lib/workOrderPilotRaBillArtifact.server";

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission(request, "work_orders", "approve");
    if ("response" in auth) return auth.response;
    const admin = db();
    const scope = await loadActorOrganizationScope(admin, auth);
    const id = (await params).id;
    let query = admin.from("work_order_pilot_ra_bill_review_cycles").select("id,cycle_number,status,pdf_bytes,reviewed_pdf_sha256,reviewed_pdf_byte_length,ra_bill:work_order_pilot_ra_bills!inner(id,status,organization_id,work_order:work_orders!inner(organization_id,approval_status,creation_request_id))").eq("ra_bill_id", id).in("status", ["submitted", "approved", "rejected"]).eq("ra_bill.work_order.approval_status", "approved").not("ra_bill.work_order.creation_request_id", "is", null).order("cycle_number", { ascending: false }).limit(1);
    query = applyOrganizationScope(query, scope);
    if (!query) return NextResponse.json({ error: "Pilot PDF is outside your authorized scope." }, { status: 404 });
    const result = await query.maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return NextResponse.json({ error: "Pilot reviewed PDF not found." }, { status: 404 });
    const bytes = decodePilotPdfBytes(result.data.pdf_bytes);
    const integrity = pilotPdfIntegrity(bytes);
    if (integrity.sha256 !== result.data.reviewed_pdf_sha256 || integrity.byteLength !== Number(result.data.reviewed_pdf_byte_length)) return NextResponse.json({ error: "The persisted Pilot reviewed PDF failed integrity verification." }, { status: 409 });
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Length": String(bytes.length), "Cache-Control": "private, no-store", "X-Pilot-PDF-SHA256": integrity.sha256 } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Could not load Pilot reviewed PDF." }, { status: 500 });
  }
}
