import { createHash } from "node:crypto";
import { platformAdminClient, requirePlatformOwner } from "@/lib/serverPlatform";
import { validateManagedTenantInput, type ManagedTenantProvisioningInput } from "@/lib/platformProvisioning";

export function provisioningPayloadHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function provisionManagedOrganization(request: Request, input: unknown) {
  const access = await requirePlatformOwner(request);
  if ("response" in access) return access;
  const validation = validateManagedTenantInput(input);
  if (!validation.valid) return { response: Response.json(validation, { status: 400 }) } as const;
  if (process.env.SITEQUBE_PROVISIONING_ENABLED !== "true") {
    return { response: Response.json({ error: "Provisioning backend is not activated." }, { status: 503 }) } as const;
  }
  const body = input as ManagedTenantProvisioningInput;
  const requestKey = String((body as any).requestKey || crypto.randomUUID()).trim();
  const payloadHash = provisioningPayloadHash(validation);
  const admin = platformAdminClient();
  return admin.rpc("provision_managed_organization", {
    p_request_key: requestKey,
    p_payload_hash: payloadHash,
    p_organization_name: validation.organization.name,
    p_organization_code: validation.organization.code,
    p_company_name: validation.company.name,
    p_company_code: validation.company.code,
    p_module_codes: validation.modules,
    p_platform_role_template_ids: validation.roleTemplateIds || [],
    p_primary_admin_name: validation.primaryAdministrator.name,
    p_primary_admin_email: validation.primaryAdministrator.email,
    p_branding_display_name: validation.branding.displayName,
    p_branding_login_tagline: validation.branding.loginTagline,
    p_branding_primary_color: validation.branding.primaryColor,
    p_branding_secondary_color: validation.branding.secondaryColor,
    p_slug: validation.domain.slug,
    p_requested_by: access.user.id,
  });
}
