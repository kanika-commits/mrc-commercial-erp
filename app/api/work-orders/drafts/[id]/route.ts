import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/serverPermissions";
import { adminClient } from "@/lib/serverProcurementAccess";
import { isInOrganizationScope, loadActorOrganizationScope } from "@/lib/serverOrganizationScope";

const text = (value: unknown) => String(value ?? "").trim();
const types = new Set(["Consultant", "Contractor (Labour)", "Contractor (SITC)", "Daily Wage", "Rental"]);

async function loadDraft(request: Request, id: string) {
  const auth = await requirePermission(request, "work_orders", "edit");
  if ("response" in auth) return { response: auth.response } as const;
  const admin = adminClient();
  const scope = await loadActorOrganizationScope(admin, auth);
  const { data, error } = await admin.from("work_orders").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data || !isInOrganizationScope(scope, data.organization_id)) return { response: NextResponse.json({ error: "Work Order was not found." }, { status: 404 }) } as const;
  if (String(data.approval_status).toLowerCase() !== "draft") return { response: NextResponse.json({ error: "Only draft Work Orders can be edited here." }, { status: 409 }) } as const;
  return { auth, admin, data } as const;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await loadDraft(request, (await params).id);
  if ("response" in result) return result.response;
  const [{ data: vendor }, { data: items }] = await Promise.all([
    result.admin.from("work_order_vendors").select("vendor_id,vendor_role").eq("work_order_id", result.data.id).eq("is_primary", true).maybeSingle(),
    result.admin.from("work_order_items").select("*").eq("work_order_id", result.data.id).order("sort_order"),
  ]);
  const selection = result.data.delivery_snapshot?.master_selection || {};
  return NextResponse.json({ ...result.data, vendor_id: vendor?.vendor_id || "", vendor_role: vendor?.vendor_role || "Main Contractor", items: items || [], letterhead_id: result.data.template_id || "", terms_template_id: result.data.template_id || "", delivery_snapshot: { ...result.data.delivery_snapshot, master_selection: selection } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await loadDraft(request, (await params).id);
  if ("response" in result) return result.response;
  const body = await request.json().catch(() => ({}));
  const number = text(body.wo_number), type = text(body.wo_type), items = Array.isArray(body.items) ? body.items : [];
  if (!number || !/^[^/\s]+\/[^/\s]+\/\d+$/.test(number) || !types.has(type) || !items.length) return NextResponse.json({ error: "A valid Work Order number, type, and item rows are required." }, { status: 400 });
  const { data: duplicate, error: duplicateError } = await result.admin.from("work_orders").select("id").eq("organization_id", result.data.organization_id).ilike("wo_number", number).neq("id", result.data.id).maybeSingle();
  if (duplicateError) throw duplicateError;
  if (duplicate) return NextResponse.json({ error: "Work Order number already exists." }, { status: 409 });
  const ids = Array.from(new Set(items.map((item: any) => text(item.item_master_id)).filter(Boolean)));
  const { data: masters, error: masterError } = await result.admin.from("work_order_item_masters").select("id,organization_id,item_header,description,unit,mode_of_measurement,status").in("id", ids).eq("organization_id", result.data.organization_id).eq("status", "active");
  if (masterError) throw masterError;
  if (!masters || masters.length !== ids.length) return NextResponse.json({ error: "One or more item masters are unavailable." }, { status: 400 });
  const masterMap = new Map(masters.map((master) => [master.id, master]));
  const normalized = items.map((item: any, index: number) => { const master = masterMap.get(text(item.item_master_id)); const quantity = Number(item.quantity), rate = Number(item.unit_rate), gst = Number(item.gst_percent); if (!master || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(rate) || rate < 0 || !Number.isFinite(gst) || gst < 0) throw new Error(`Invalid item row ${index + 1}.`); const basic = Number((quantity * rate).toFixed(2)); const gstAmount = Number((basic * gst / 100).toFixed(2)); return { work_order_id: result.data.id, organization_id: result.data.organization_id, item_master_id: master.id, item_header_snapshot: master.item_header, description_snapshot: master.description, additional_description_snapshot: text(item.additional_description) || null, unit_snapshot: master.unit, mode_of_measurement_snapshot: master.mode_of_measurement, quantity, unit_rate: rate, gst_percent: gst, basic_amount: basic, gst_amount: gstAmount, line_total: Number((basic + gstAmount).toFixed(2)), sort_order: index + 1, created_by: result.auth.user.id }; });
  const basic = normalized.reduce((sum: number, item: any) => sum + item.basic_amount, 0), gst = normalized.reduce((sum: number, item: any) => sum + item.gst_amount, 0);
  const { data: updated, error: updateError } = await result.admin.from("work_orders").update({ wo_number: number, wo_type: type, company_id: text(body.company_id), site_id: text(body.site_id), wo_date: text(body.wo_date), description: text(body.description) || null, wo_value: basic, gst_percent: Number(body.gst_percent || 0), total_basic_amount: basic, total_gst_amount: gst, total_amount: basic + gst, standard_terms_snapshot: text(body.standard_terms_snapshot), delivery_snapshot: body.delivery_snapshot || result.data.delivery_snapshot, work_order_key_terms: body.work_order_key_terms || result.data.work_order_key_terms, letterhead_snapshot: body.letterhead_snapshot || result.data.letterhead_snapshot }).eq("id", result.data.id).eq("approval_status", "draft").select("id,wo_number,approval_status,total_basic_amount,total_gst_amount,total_amount").single();
  if (updateError) { if (updateError.code === "23505") return NextResponse.json({ error: "Work Order number already exists." }, { status: 409 }); throw updateError; }
  const { error: deleteError } = await result.admin.from("work_order_items").delete().eq("work_order_id", result.data.id);
  if (deleteError) throw deleteError;
  const { error: itemError } = await result.admin.from("work_order_items").insert(normalized);
  if (itemError) throw itemError;
  return NextResponse.json({ workOrder: updated });
}
