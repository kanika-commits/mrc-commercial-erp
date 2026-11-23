import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/serverPermissions";
import { isInOrganizationScope, loadOrganizationScopeForUser } from "@/lib/serverOrganizationScope";
import { canAny, loadApprovalScope } from "@/app/api/approvals/_shared";
import { adminClient } from "@/lib/serverProcurementAccess";
import { renderApprovedWorkOrderPdfById } from "@/lib/workOrderApprovedPdf.server";
import { addWorkOrderDraftWatermark, addWorkOrderPackagePageNumbers } from "@/lib/workOrderPdfPackage.server";
import { loadWorkOrderLetterheadAssets, renderWorkOrderPdf } from "@/lib/workOrderPdfRenderer.server";

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
    const { data: order, error: orderError } = await admin.from("work_orders").select("*").eq("id", id).maybeSingle();
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
    if (String(order.approval_status || "").toLowerCase() !== "approved") {
      const [companyResult, siteResult, vendorResult, itemsResult] = await Promise.all([
        admin.from("companies").select("company_name").eq("id", order.company_id).maybeSingle(),
        admin.from("sites").select("site_name").eq("id", order.site_id).maybeSingle(),
        admin.from("work_order_vendors").select("vendor_id,vendor_role,vendors(*)").eq("work_order_id", id).eq("is_primary", true).maybeSingle(),
        admin.from("work_order_items").select("*").eq("work_order_id", id).order("sort_order"),
      ]);
      const queryError = companyResult.error || siteResult.error || vendorResult.error || itemsResult.error;
      if (queryError) throw queryError;
      const delivery = order.delivery_snapshot || {};
      const vendor = vendorResult.data?.vendors || order.vendor_snapshot || {};
      const items = (itemsResult.data || []).map((item: any, index: number) => ({ item_name_snapshot: item.item_header_snapshot || item.description_snapshot, specification_snapshot: item.description_snapshot, additional_description_snapshot: item.additional_description_snapshot || "", make_snapshot: item.mode_of_measurement_snapshot || "", quantity: item.quantity, uom_snapshot: item.unit_snapshot, unit_rate: item.unit_rate, gst_rate: item.gst_percent, gst_amount: item.gst_amount, total_amount: item.line_total, serial_no: index + 1 }));
      const pdf = await renderWorkOrderPdf({ ...order, company: { company_name: companyResult.data?.company_name }, site: { site_name: siteResult.data?.site_name }, vendor_snapshot: delivery.vendor_snapshot || order.vendor_snapshot || vendor, delivery_snapshot: delivery, items, standard_terms_clauses: order.standard_terms_snapshot, approval_status: "draft" }, await loadWorkOrderLetterheadAssets(order.letterhead_snapshot, order.letterhead_id, order.company_id));
      const packaged = await addWorkOrderPackagePageNumbers(await addWorkOrderDraftWatermark(pdf), { plain: true });
      return new NextResponse(packaged, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${value(order.wo_number) || "work-order"}-draft.pdf"` } });
    }
    return new NextResponse(await renderApprovedWorkOrderPdfById(admin, id), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${value(order.wo_number) || "work-order"}.pdf"` } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Could not generate Work Order PDF." }, { status: 500 });
  }
}
