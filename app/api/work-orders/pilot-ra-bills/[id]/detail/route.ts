import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";
import { applyOrganizationScope, loadActorOrganizationScope } from "@/lib/serverOrganizationScope";

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission(request, "work_orders", "approve");
    if ("response" in auth) return auth.response;
    const admin = db();
    const scope = await loadActorOrganizationScope(admin, auth);
    const id = (await params).id;
    if (!isUuid(id)) return NextResponse.json({ error: "Pilot RA Bill not found." }, { status: 404 });
    let query = admin.from("work_order_pilot_ra_bills").select("*,work_order:work_orders!inner(id,organization_id,wo_number,approval_status,creation_request_id,wo_date,wo_value,companies(company_name),sites(site_name),work_order_vendors(is_primary,vendors(vendor_name))),items:work_order_pilot_ra_bill_items(*),cycles:work_order_pilot_ra_bill_review_cycles(id,cycle_number,status,reviewed_pdf_sha256,reviewed_pdf_byte_length,attachment_manifest,attachment_manifest_sha256,submitted_by,submitted_at,decided_by,decided_at,send_back_reason)").eq("id", id).in("status", ["draft", "submitted", "approved", "rejected", "sent_back"]).eq("work_order.approval_status", "approved").not("work_order.creation_request_id", "is", null);
    query = applyOrganizationScope(query, scope);
    if (!query) return NextResponse.json({ error: "Pilot RA Bill not found." }, { status: 404 });
    const result = await query.maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return NextResponse.json({ error: "Pilot RA Bill not found." }, { status: 404 });
    const bill = result.data;
    let auditQuery: any = admin.from("work_order_pilot_ra_bill_deletion_audit").select("id,actor_id,deleted_at,reason,prior_status,cleanup_status,cleanup_error,cleanup_updated_at").eq("ra_bill_id", id).eq("organization_id", bill.organization_id).maybeSingle();
    auditQuery = applyOrganizationScope(auditQuery, scope);
    if (!auditQuery) return NextResponse.json({ error: "Pilot RA Bill not found." }, { status: 404 });
    const auditResult = await auditQuery;
    if (auditResult.error) throw auditResult.error;
    const vendorLink = (bill.work_order?.work_order_vendors || []).find((entry: any) => entry.is_primary) || bill.work_order?.work_order_vendors?.[0];
    const profiles = [bill.created_by, ...(bill.cycles || []).flatMap((entry: any) => [entry.submitted_by, entry.decided_by])].filter(Boolean);
    const profileResult = profiles.length ? await admin.from("profiles").select("id,full_name,email").in("id", profiles) : { data: [], error: null };
    if (profileResult.error) throw profileResult.error;
    const profileById = new Map((profileResult.data || []).map((profile: any) => [profile.id, profile]));
    const historyResult = await admin.from("work_order_pilot_ra_bills").select("id,bill_number,bill_date,status,submitted_at,calculation_snapshot,created_at").eq("work_order_id", bill.work_order_id).eq("organization_id", bill.organization_id).order("bill_date", { ascending: true });
    if (historyResult.error) throw historyResult.error;
    const cycles = Array.isArray(bill.cycles) ? bill.cycles : [];
    const cycle = cycles.sort((a: any, b: any) => Number(b.cycle_number) - Number(a.cycle_number))[0];
    if (!cycle && bill.status !== "draft") return NextResponse.json({ error: "No submitted Pilot review cycle is available." }, { status: 409 });
    const manifest = Array.isArray(cycle?.attachment_manifest) ? cycle.attachment_manifest : [];
    const attachments = await Promise.all(manifest.map(async (entry: any) => {
      const signed = await admin.storage.from("work-order-pilot-ra-bill-attachments").createSignedUrl(String(entry.storage_key), 300);
      return { id: entry.id, file_name: entry.file_name, mime_type: entry.mime_type, byte_length: entry.byte_length, sha256: entry.sha256, url: signed.error ? null : signed.data.signedUrl, expires_in: signed.error ? 0 : 300 };
    }));
    return NextResponse.json({ bill: { ...bill, vendor_name: vendorLink?.vendors?.vendor_name || bill.work_order_snapshot?.vendor_name || null, submitter: profileById.get(bill.created_by) || null }, cycle: cycle || null, deletion_audit: auditResult.data || null, attachments, profiles: Object.fromEntries(profileById), history: historyResult.data || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Could not load Pilot RA Bill detail." }, { status: 500 });
  }
}
