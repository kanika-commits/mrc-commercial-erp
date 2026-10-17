import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";
import { applyOrganizationScope, loadActorOrganizationScope } from "@/lib/serverOrganizationScope";
import { renderPilotRaBillPdf } from "@/lib/workOrderPilotRaBillPdf.server";
import { pilotRaBillReviewBindingHash } from "@/lib/workOrderPilotRaBillReviewBinding";

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission(request, "work_orders", "view");
    if ("response" in auth) return auth.response;
    const admin = db();
    const scope = await loadActorOrganizationScope(admin, auth);
    let billQuery = admin.from("work_order_pilot_ra_bills").select("*,work_order_pilot_ra_bill_items(*)").eq("id", (await params).id);
    billQuery = applyOrganizationScope(billQuery, scope);
    if (!billQuery) return NextResponse.json({ error: "Pilot RA Bill not found." }, { status: 404 });
    const billResult = await billQuery.maybeSingle();
    if (billResult.error) throw billResult.error;
    const bill = billResult.data;
    if (!bill) return NextResponse.json({ error: "Pilot RA Bill not found." }, { status: 404 });
    let orderQuery = admin.from("work_orders").select("id,organization_id,wo_number,creation_request_id,approval_status,wo_date,wo_value,gst_percent,description,company:companies(company_name),site:sites(site_name),work_order_vendors(is_primary,vendors(vendor_name))").eq("id", bill.work_order_id).eq("approval_status", "approved").not("creation_request_id", "is", null);
    orderQuery = applyOrganizationScope(orderQuery, scope);
    if (!orderQuery) return NextResponse.json({ error: "The bill Work Order is outside your authorized scope." }, { status: 404 });
    const orderResult = await orderQuery.maybeSingle();
    if (orderResult.error) throw orderResult.error;
    if (!orderResult.data) return NextResponse.json({ error: "The bill Work Order is not an approved Pilot Work Order." }, { status: 409 });
    const revision = await admin.from("work_order_pilot_revisions").select("id,revision_number,status,applicable_date,snapshot").eq("work_order_id", bill.work_order_id).in("status", ["approved", "issued"]).order("revision_number", { ascending: false }).limit(1).maybeSingle();
    if (revision.error) throw revision.error;
    const effectiveRevision = revision.data;
    const storedRevision = bill.revision_snapshot || {};
    if (storedRevision.id && (!effectiveRevision || storedRevision.id !== effectiveRevision.id)) throw new Error("The approved Pilot Work Order revision changed. Reopen the bill and review it again.");
    if (storedRevision.source === "original_approved_work_order" && effectiveRevision) throw new Error("A new approved Pilot Work Order revision exists. Reopen the bill and review it again.");
    const [debit, credit] = await Promise.all([
      admin.from("debit_notes").select("total_amount,gross_amount").eq("organization_id", bill.organization_id).eq("work_order_id", bill.work_order_id).ilike("approval_status", "approved").ilike("status", "approved").eq("is_deleted", false),
      admin.from("credit_notes").select("total_amount,gross_amount").eq("organization_id", bill.organization_id).eq("work_order_id", bill.work_order_id).ilike("approval_status", "approved").ilike("status", "approved"),
    ]);
    if (debit.error) throw debit.error;
    if (credit.error) throw credit.error;
    const totalDebit = (debit.data || []).reduce((sum: number, row: any) => sum + Number(row.total_amount ?? row.gross_amount ?? 0), 0);
    const totalCredit = (credit.data || []).reduce((sum: number, row: any) => sum + Number(row.total_amount ?? row.gross_amount ?? 0), 0);
    const calculationSnapshot = { ...(bill.calculation_snapshot || {}), total_debit_notes: totalDebit, total_credit_notes: totalCredit };
    if (Number(bill.calculation_snapshot?.total_debit_notes || 0) !== totalDebit || Number(bill.calculation_snapshot?.total_credit_notes || 0) !== totalCredit) throw new Error("Debit Note or Credit Note totals changed. Save the Pilot RA Bill again before reviewing it.");
    const bytes = await renderPilotRaBillPdf({ bill, order: orderResult.data, effectiveRevision });
    return NextResponse.json({ pdf_base64: bytes.toString("base64"), sha256: crypto.createHash("sha256").update(bytes).digest("hex"), byte_length: bytes.length, input_snapshot_sha256: pilotRaBillReviewBindingHash({ billId: bill.id, organizationId: bill.organization_id, workOrderId: bill.work_order_id, withheld: Number(bill.withheld || 0), labourCess: Number(bill.labour_cess || 0), calculationSnapshot }) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Could not render Pilot RA Bill preview." }, { status: 500 });
  }
}
