import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/serverPermissions";
import { loadOrganizationScopeForUser, isInOrganizationScope } from "@/lib/serverOrganizationScope";
import { adminClient } from "@/lib/serverProcurementAccess";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "work_orders", "view");
  if ("response" in auth) return auth.response;
  const { id } = await params; const admin = adminClient();
  const { data: wo, error: woError } = await admin.from("work_orders").select("id,organization_id,company_id,site_id").eq("id", id).maybeSingle();
  if (woError) return NextResponse.json({ error: woError.message }, { status: 500 });
  const scope = await loadOrganizationScopeForUser(admin, auth.user.id);
  if (!wo || !isInOrganizationScope(scope, wo.organization_id)) return NextResponse.json({ error: "Work Order was not found." }, { status: 404 });
  const { data, error } = await admin.from("work_order_items").select("id,work_order_id,item_master_id,item_header_snapshot,description_snapshot,unit_snapshot,mode_of_measurement_snapshot,sort_order").eq("work_order_id", id).order("sort_order");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data || [] });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "work_orders", "edit");
  if ("response" in auth) return auth.response;
  const { id } = await params; const body = await request.json().catch(() => ({})); const masterId = String(body.item_master_id || "").trim();
  if (!masterId) return NextResponse.json({ error: "Select a Work Order Item Master item." }, { status: 400 });
  const admin = adminClient(); const { data: wo, error: woError } = await admin.from("work_orders").select("id,organization_id").eq("id", id).maybeSingle();
  if (woError) throw woError; const scope = await loadOrganizationScopeForUser(admin, auth.user.id);
  if (!wo || !isInOrganizationScope(scope, wo.organization_id)) return NextResponse.json({ error: "Work Order was not found." }, { status: 404 });
  const { data: master, error: masterError } = await admin.from("work_order_item_masters").select("id,organization_id,item_header,description,unit,mode_of_measurement,status").eq("id", masterId).eq("organization_id", wo.organization_id).eq("status", "active").maybeSingle();
  if (masterError) throw masterError; if (!master) return NextResponse.json({ error: "Selected item is not available in this organization." }, { status: 400 });
  const { count } = await admin.from("work_order_items").select("id", { count: "exact", head: true }).eq("work_order_id", id);
  const { data, error } = await admin.from("work_order_items").insert({ organization_id: wo.organization_id, work_order_id: id, item_master_id: master.id, item_header_snapshot: master.item_header, description_snapshot: master.description, unit_snapshot: master.unit, mode_of_measurement_snapshot: master.mode_of_measurement, sort_order: (count || 0) + 1, created_by: auth.user.id, created_by_name: auth.user.user_metadata?.full_name || auth.user.email, created_by_email: auth.user.email || null }).select("*").single();
  if (error) throw error; return NextResponse.json({ item: data }, { status: 201 });
}
