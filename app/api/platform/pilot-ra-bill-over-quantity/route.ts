import { NextResponse } from "next/server";
import { platformAdminClient, requirePlatformOwner } from "@/lib/serverPlatform";
import { getPilotOverQuantityPolicy } from "@/lib/pilotRaBillOverQuantity.server";

export async function GET(request: Request) {
  const auth = await requirePlatformOwner(request); if ("response" in auth) return auth.response;
  try { const admin = platformAdminClient(); const organizations = await admin.from("organizations").select("id,name,code,status").order("name"); if (organizations.error) throw organizations.error; const ids = (organizations.data || []).map((o: any) => o.id); const settings = ids.length ? await admin.from("pilot_ra_bill_over_quantity_policies").select("organization_id,allowance_percent,configured_by,configured_at").in("organization_id", ids) : { data: [], error: null }; if (settings.error && !/relation .* does not exist|column .* does not exist/i.test(settings.error.message || "")) throw settings.error; const byId = new Map((settings.data || []).map((p: any) => [p.organization_id, p])); return NextResponse.json({ organizations: (organizations.data || []).map((o: any) => ({ ...o, policy: byId.get(o.id) || { organization_id: o.id, allowance_percent: 0 } })) }); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Could not load Pilot RA Bill policy." }, { status: 500 }); }
}

export async function PUT(request: Request) {
  const auth = await requirePlatformOwner(request); if ("response" in auth) return auth.response;
  try {
    const body = await request.json(); const allowance = Number(body.allowance_percent); const organizationId = String(body.organization_id || "");
    if (!organizationId) return NextResponse.json({ error: "Organization is required." }, { status: 422 });
    if (!Number.isFinite(allowance) || allowance < 0 || allowance > 1000) return NextResponse.json({ error: "Allowance must be a finite percentage between 0 and 1000." }, { status: 422 });
    const result = await platformAdminClient().from("pilot_ra_bill_over_quantity_policies").upsert({ organization_id: organizationId, allowance_percent: allowance, configured_by: auth.user.id, configured_at: new Date().toISOString(), updated_at: new Date().toISOString() }).select("organization_id,allowance_percent,configured_by,configured_at").single();
    if (result.error) throw result.error; return NextResponse.json({ policy: result.data });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Could not save Pilot RA Bill policy." }, { status: 500 }); }
}
