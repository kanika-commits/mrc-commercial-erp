import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";
import { applyWorkOrderScope, loadAllowedWorkOrderIds, loadApprovalScope } from "@/app/api/approvals/_shared";

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission(request, "debit_notes", "view");
    if ("response" in auth) return auth.response;
    const id = String((await context.params).id || "").trim();
    if (!id) return NextResponse.json({ error: "Debit Note id is required." }, { status: 400 });
    const admin = db();
    const { organizationScope, assignments } = await loadApprovalScope(admin, auth);
    const allowedWorkOrderIds = await loadAllowedWorkOrderIds(admin, organizationScope, assignments);
    let noteQuery = admin.from("debit_notes").select("*").eq("id", id);
    if (organizationScope !== null) noteQuery = noteQuery.in("organization_id", organizationScope);
    const { data: note, error } = await noteQuery.maybeSingle();
    if (error) throw error;
    if (!note) return NextResponse.json({ error: "Debit Note was not found." }, { status: 404 });
    if (allowedWorkOrderIds !== null && note.work_order_id && !allowedWorkOrderIds.includes(note.work_order_id)) {
      return NextResponse.json({ error: "You do not have access to this Debit Note." }, { status: 403 });
    }
    const [po, wo, vendor] = await Promise.all([
      note.source_purchase_order_id
        ? admin.from("procurement_purchase_orders").select("id,po_number,po_date,purpose,recovery_work_order_id,vendor_name_snapshot,total_basic_amount,total_gst_amount,total_amount,status").eq("id", note.source_purchase_order_id).eq("organization_id", note.organization_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      note.work_order_id ? admin.from("work_orders").select("id,wo_number,wo_value,wo_date,company_id,site_id,organization_id").eq("id", note.work_order_id).eq("organization_id", note.organization_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      note.vendor_id ? admin.from("vendors").select("id,vendor_name,pan,gstin").eq("id", note.vendor_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    if (po.error || wo.error || vendor.error) throw po.error || wo.error || vendor.error;
    const [company, site] = await Promise.all([
      wo.data?.company_id ? admin.from("companies").select("id,company_name,company_code").eq("id", wo.data.company_id).eq("organization_id", note.organization_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      wo.data?.site_id ? admin.from("sites").select("id,site_name,site_code").eq("id", wo.data.site_id).eq("organization_id", note.organization_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    if (company.error || site.error) throw company.error || site.error;
    return NextResponse.json({ note, source_purchase_order: po.data, work_order: wo.data, company: company.data, site: site.data, vendor: vendor.data });
  } catch {
    return NextResponse.json({ error: "Could not load Debit Note." }, { status: 500 });
  }
}
