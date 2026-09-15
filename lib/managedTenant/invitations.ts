import { NextResponse } from "next/server";
import { platformAdminClient, requirePlatformOwner } from "@/lib/serverPlatform";
export async function createManagedTenantInvitation(request: Request, input: { invitationId?: string }) {
  const access = await requirePlatformOwner(request);
  if ("response" in access) return access;
  if (process.env.SITEQUBE_TENANT_INVITES_ENABLED !== "true") return { response: NextResponse.json({ error: "Tenant invitations are disabled." }, { status: 503 }) } as const;
  if (!input?.invitationId || !/^[0-9a-f-]{36}$/i.test(input.invitationId)) return { response: NextResponse.json({ error: "Invitation id is required." }, { status: 400 }) } as const;
  const admin = platformAdminClient();
  const invitation = await admin.from("managed_tenant_invitations").select("id, organization_id, invited_email, invited_name, status, expires_at").eq("id", input.invitationId).maybeSingle();
  if (invitation.error) return { response: NextResponse.json({ error: "Unable to load the invitation." }, { status: 500 }) } as const;
  if (!invitation.data || !["pending", "sent"].includes(invitation.data.status)) return { response: NextResponse.json({ error: "This invitation is no longer available." }, { status: 409 }) } as const;
  if (new Date(invitation.data.expires_at).getTime() <= Date.now()) return { response: NextResponse.json({ error: "This invitation has expired." }, { status: 409 }) } as const;
  const redirectTo = new URL(`/invitations/accept?invitationId=${encodeURIComponent(invitation.data.id)}`, request.url).toString();
  const sent = await admin.auth.admin.inviteUserByEmail(invitation.data.invited_email, { data: { managed_tenant_invitation_id: invitation.data.id, invited_name: invitation.data.invited_name }, redirectTo });
  if (sent.error) return { response: NextResponse.json({ error: "Invitation email could not be sent. Check the configured Supabase Auth email delivery settings." }, { status: 502 }) } as const;
  const updated = await admin.from("managed_tenant_invitations").update({ status: "sent", updated_at: new Date().toISOString() }).eq("id", invitation.data.id).in("status", ["pending", "sent"]);
  if (updated.error) return { response: NextResponse.json({ error: "Invitation was sent but its delivery status could not be recorded." }, { status: 500 }) } as const;
  return { response: NextResponse.json({ invitationId: invitation.data.id, status: "sent" }) } as const;
}
export function invitationAdminClient() { return platformAdminClient(); }
