import { NextResponse } from "next/server";
import { loadManagedInvitationSession } from "@/lib/managedTenant/invitationSession";
import { platformAdminClient } from "@/lib/serverPlatform";
export async function POST(request: Request) {
  const auth = await loadManagedInvitationSession(request);
  if ("response" in auth) return auth.response;
  if (process.env.SITEQUBE_TENANT_INVITES_ENABLED !== "true") {
    return NextResponse.json({ error: "Managed tenant invitation acceptance is not activated." }, { status: 503 });
  }
  const body = await request.json().catch(() => ({}));
  if (!body?.invitationId || typeof body.invitationId !== "string") return NextResponse.json({ error: "Invitation id is required." }, { status: 400 });
  const result = await platformAdminClient().rpc("accept_managed_tenant_invitation", { p_invitation_id: body.invitationId, p_auth_user_id: auth.userId });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 409 });
  return NextResponse.json(result.data);
}
