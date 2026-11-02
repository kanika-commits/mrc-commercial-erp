import { NextResponse } from "next/server";
import { addWorkOrderDraftWatermark, addWorkOrderPackagePageNumbers } from "@/lib/workOrderPdfPackage.server";
import { loadWorkOrderLetterheadAssets, renderWorkOrderPdf } from "@/lib/workOrderPdfRenderer.server";
import { loadAuthorizedWorkOrderDraft } from "@/lib/serverWorkOrderDraft";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const result = await loadAuthorizedWorkOrderDraft(request, (await params).id);
    if ("response" in result) return result.response;
    const [companyResult, siteResult, vendorResult, itemsResult] = await Promise.all([
      result.admin.from("companies").select("company_name").eq("id", result.data.company_id).maybeSingle(),
      result.admin.from("sites").select("site_name").eq("id", result.data.site_id).maybeSingle(),
      result.admin.from("work_order_vendors").select("vendor_id,vendor_role,vendors(*)").eq("work_order_id", result.data.id).eq("is_primary", true).maybeSingle(),
      result.admin.from("work_order_items").select("*").eq("work_order_id", result.data.id).order("sort_order"),
    ]);
    const queryError = companyResult.error || siteResult.error || vendorResult.error || itemsResult.error;
    if (queryError) throw queryError;
    const delivery = result.data.delivery_snapshot || {};
    const vendor = vendorResult.data?.vendors || result.data.vendor_snapshot || {};
    const items = (itemsResult.data || []).map((item: any, index: number) => ({
      item_name_snapshot: item.item_header_snapshot || item.description_snapshot,
      specification_snapshot: item.description_snapshot,
      additional_description_snapshot: item.additional_description_snapshot || "",
      make_snapshot: item.mode_of_measurement_snapshot || "",
      quantity: item.quantity,
      uom_snapshot: item.unit_snapshot,
      unit_rate: item.unit_rate,
      gst_rate: item.gst_percent,
      gst_amount: item.gst_amount,
      total_amount: item.line_total,
      serial_no: index + 1,
    }));
    const pdf = await renderWorkOrderPdf({
      ...result.data,
      company: { company_name: companyResult.data?.company_name },
      site: { site_name: siteResult.data?.site_name },
      vendor_snapshot: delivery.vendor_snapshot || result.data.vendor_snapshot || vendor,
      delivery_snapshot: delivery,
      items,
      standard_terms_clauses: result.data.standard_terms_snapshot,
      approval_status: "draft",
    }, await loadWorkOrderLetterheadAssets(result.data.letterhead_snapshot, result.data.letterhead_id, result.data.company_id));
    const packaged = await addWorkOrderPackagePageNumbers(await addWorkOrderDraftWatermark(pdf), { plain: true });
    return new NextResponse(packaged, { headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline" } });
  } catch (error) {
    console.error("Work Order draft preview failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "The Work Order draft preview could not be generated." }, { status: 500 });
  }
}
