import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/serverPermissions";
import { isInOrganizationScope, loadOrganizationScopeForUser } from "@/lib/serverOrganizationScope";
import { canAny, loadApprovalScope } from "@/app/api/approvals/_shared";
import { adminClient } from "@/lib/serverProcurementAccess";
import { renderApprovedWorkOrderPdfById } from "@/lib/workOrderApprovedPdf.server";

const value = (input: unknown) => String(input ?? "").trim();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAnyPermission(request, [
      { moduleCode: "work_orders", actionCode: "view" },
      { moduleCode: "wo_approval", actionCode: "view" },
      { moduleCode: "wo_approval", actionCode: "edit" },
      { moduleCode: "wo_approval", actionCode: "approve" },
      { moduleCode: "wo_approval", actionCode: "reject" },
      { moduleCode: "wo_approval", actionCode: "upload" },
    ]);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    const admin = adminClient();
    const { data: order, error: orderError } = await admin.from("work_orders").select("id,organization_id,company_id,site_id,wo_number,approval_status,status,creation_request_id").eq("id", id).maybeSingle();
    if (orderError) throw orderError;
    const scope = await loadOrganizationScopeForUser(admin, auth.user.id);
    if (!order || !isInOrganizationScope(scope, order.organization_id)) return NextResponse.json({ error: "Work Order was not found." }, { status: 404 });
    if (canAny(auth.permissions, "wo_approval", ["view", "edit", "approve", "reject", "upload"])) {
      const approvalScope = await loadApprovalScope(admin, auth);
      const { companyIds, siteIds } = approvalScope.assignments;
      const inAssignedScope = siteIds.length > 0
        ? siteIds.includes(order.site_id)
        : companyIds.length === 0 || companyIds.includes(order.company_id);
      if (!inAssignedScope) return NextResponse.json({ error: "Work Order was not found." }, { status: 404 });
    }
    if (order.creation_request_id) {
      const { data: artifact, error: artifactError } = await admin
        .from("work_order_documents")
        .select("file_path, file_url, file_name")
        .eq("work_order_id", id)
        .eq("drive_sync_key", "pilot-reviewed-pdf")
        .maybeSingle();
      if (artifactError) throw artifactError;
      const path = String(artifact?.file_path || artifact?.file_url || "").trim();
      if (!artifact || !path || path.startsWith("http")) {
        return NextResponse.json({ error: "The reviewed Work Order PDF artifact is missing." }, { status: 409 });
      }
      const { data: file, error: downloadError } = await admin.storage.from("work-order-documents").download(path);
      if (downloadError || !file) {
        return NextResponse.json({ error: "The reviewed Work Order PDF artifact could not be loaded." }, { status: 409 });
      }
      return new NextResponse(file, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${value(artifact.file_name) || `${value(order.wo_number) || "work-order"}-reviewed-package.pdf`}"` } });
    }
    return new NextResponse(await renderApprovedWorkOrderPdfById(admin, id), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${value(order.wo_number) || "work-order"}.pdf"` } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Could not generate Work Order PDF." }, { status: 500 });
  }
}
