import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";
import { applyOrganizationScope, loadActorOrganizationScope } from "@/lib/serverOrganizationScope";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission(request, "work_orders", "approve");
    if ("response" in auth) return auth.response;
    if (!auth.roleCodes.includes("super_admin")) return NextResponse.json({ error: "Only a Super Admin can decide a Pilot over-quantity exception." }, { status: 403 });
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const scope = await loadActorOrganizationScope(admin, auth); const id = (await params).id; let query = admin.from("work_order_pilot_ra_bills").select("id,organization_id,status,over_quantity_exception_status").eq("id", id); query = applyOrganizationScope(query, scope); if (!query) return NextResponse.json({ error: "Pilot RA Bill is outside your organization scope." }, { status: 404 });
    const bill = await query.maybeSingle(); if (bill.error) throw bill.error; if (!bill.data) return NextResponse.json({ error: "Pilot RA Bill not found." }, { status: 404 });
    const body = await request.json().catch(() => ({})); const decision = String(body.decision || ""); if (!["approved", "rejected"].includes(decision)) return NextResponse.json({ error: "Decision must be approved or rejected." }, { status: 422 });
    const result = await admin.rpc("decide_work_order_pilot_ra_bill_over_quantity", { p_id: id, p_actor: auth.user.id, p_decision: decision, p_reason: String(body.reason || "") }); if (result.error) throw result.error;
    return NextResponse.json({ bill: result.data, exception_decision: decision });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Could not decide Pilot over-quantity exception." }, { status: 400 }); }
}
