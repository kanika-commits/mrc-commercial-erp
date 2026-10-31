import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";
import { applyOrganizationScope, loadActorOrganizationScope } from "@/lib/serverOrganizationScope";

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission(request, "work_orders", "view");
    if ("response" in auth) return auth.response;
    const id = String((await context.params).id || "").trim();
    const admin = db();
    const scope = await loadActorOrganizationScope(admin, auth);
    const { data: assignments, error: assignmentsError } = await admin
      .from("user_access_assignments")
      .select("company_id,site_id")
      .eq("user_id", auth.user.id);
    if (assignmentsError) throw assignmentsError;
    const assignedSites = Array.from(new Set((assignments || []).map((row: any) => row.site_id).filter(Boolean)));
    const assignedCompanies = Array.from(new Set((assignments || []).map((row: any) => row.company_id).filter(Boolean)));
    let workOrderQuery = admin.from("work_orders").select("*").eq("id", id);
    workOrderQuery = applyOrganizationScope(workOrderQuery, scope) as any;
    if (!workOrderQuery) return NextResponse.json({ error: "Work Order was not found." }, { status: 404 });
    const { data: workOrder, error } = await workOrderQuery.maybeSingle();
    if (error) throw error;
    if (!workOrder) return NextResponse.json({ error: "Work Order was not found." }, { status: 404 });
    if (assignedSites.length > 0 && !assignedSites.includes(workOrder.site_id)) return NextResponse.json({ error: "You do not have access to this Work Order." }, { status: 403 });
    if (assignedSites.length === 0 && assignedCompanies.length > 0 && !assignedCompanies.includes(workOrder.company_id)) return NextResponse.json({ error: "You do not have access to this Work Order." }, { status: 403 });
    const [company, site, raBills, invoices, payments, debitNotes, vendors, changes] = await Promise.all([
      workOrder.company_id ? admin.from("companies").select("id,company_name,company_code").eq("id", workOrder.company_id).eq("organization_id", workOrder.organization_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      workOrder.site_id ? admin.from("sites").select("id,site_name,site_code,location,state").eq("id", workOrder.site_id).eq("organization_id", workOrder.organization_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      admin.from("ra_bills").select("id,ra_number,ra_date,gross_amount,net_amount,status,approval_status,created_at,created_by_name,created_by_email,approved_by_name,approved_by_email,approved_at,vendor_id").eq("work_order_id", id).not("approval_status", "ilike", "rejected").order("ra_date", { ascending: false }),
      admin.from("invoices").select("id,invoice_number,invoice_date,taxable_amount,gst_amount,invoice_amount,status,approval_status,itc_status,vendor_id,created_at,created_by_name,created_by_email,itc_claimed_by_name,itc_claimed_by_email,itc_claimed_at,itc_rejected_by_name,itc_rejected_by_email,itc_rejected_at").eq("work_order_id", id).not("approval_status", "ilike", "rejected").order("invoice_date", { ascending: false }),
      admin.from("payments").select("id,payment_number,payment_date,payment_amount,total_payment,transferred_amount,tds_amount,payment_mode,utr_number,reference_number,status,vendor_id,created_at,created_at_user,created_by_name,created_by_email").eq("work_order_id", id).order("payment_date", { ascending: false }),
      admin.from("debit_notes").select("id,debit_note_number,debit_note_date,debit_note_type,total_amount,reason,status,approval_status,vendor_id,created_at,created_by_name,created_by_email,approved_by_name,approved_by_email,approved_at").eq("work_order_id", id).not("approval_status", "ilike", "rejected").order("debit_note_date", { ascending: false }),
      admin.from("work_order_vendors").select("id,work_order_id,vendor_id,vendor_role,is_primary,vendors(id,vendor_name)").eq("work_order_id", id).order("is_primary", { ascending: false }),
      fetch(`${new URL(request.url).origin}/api/work-orders/${encodeURIComponent(id)}/changes`, { headers: { authorization: request.headers.get("authorization") || "" } }).then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || "Failed to load Work Order changes.");
        return body.changes || [];
      }),
    ]);
    const resultErrors = [company, site, raBills, invoices, payments, debitNotes, vendors].map((x: any) => x.error).filter(Boolean);
    if (resultErrors.length) throw resultErrors[0];
    const related = [...(raBills.data || []), ...(invoices.data || []), ...(payments.data || []), ...(debitNotes.data || [])];
    const vendorIds = Array.from(new Set(related.map((row: any) => row.vendor_id).filter(Boolean)));
    const relatedVendors = vendorIds.length ? await admin.from("vendors").select("id,vendor_name").in("id", vendorIds) : { data: [], error: null };
    if (relatedVendors.error) throw relatedVendors.error;
    const names = new Map((relatedVendors.data || []).map((row: any) => [row.id, row.vendor_name || "-"]));
    const enrich = (rows: any[]) => rows.map((row) => ({ ...row, vendor_name: row.vendor_id ? names.get(row.vendor_id) || "-" : "-" }));
    return NextResponse.json({ work_order: workOrder, company: company.data, site: site.data, vendors: vendors.data || [], ra_bills: enrich(raBills.data || []), invoices: enrich(invoices.data || []), payments: enrich(payments.data || []), debit_notes: enrich(debitNotes.data || []), changes });
  } catch {
    return NextResponse.json({ error: "Could not load Work Order details." }, { status: 500 });
  }
}
