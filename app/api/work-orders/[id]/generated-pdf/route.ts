import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/serverPermissions";
import { isInOrganizationScope, loadOrganizationScopeForUser } from "@/lib/serverOrganizationScope";
import { adminClient } from "@/lib/serverProcurementAccess";
import { renderApprovedWorkOrderPdfById } from "@/lib/workOrderApprovedPdf.server";

const value = (input: unknown) => String(input ?? "").trim();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission(request, "work_orders", "view");
    if ("response" in auth) return auth.response;
    const { id } = await params;
    const admin = adminClient();
    const { data: order, error: orderError } = await admin.from("work_orders").select("id,organization_id,wo_number,approval_status,status").eq("id", id).maybeSingle();
    if (orderError) throw orderError;
    const scope = await loadOrganizationScopeForUser(admin, auth.user.id);
    if (!order || !isInOrganizationScope(scope, order.organization_id)) return NextResponse.json({ error: "Work Order was not found." }, { status: 404 });
    return new NextResponse(await renderApprovedWorkOrderPdfById(admin, id), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${value(order.wo_number) || "work-order"}.pdf"` } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Could not generate Work Order PDF." }, { status: 500 });
  }
}
