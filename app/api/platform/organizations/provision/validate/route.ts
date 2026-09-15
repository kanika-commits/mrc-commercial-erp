import { NextResponse } from "next/server";
import { platformAdminClient, requirePlatformOwner } from "@/lib/serverPlatform";
import { validateManagedTenantInput } from "@/lib/platformProvisioning";
export async function POST(request: Request) {
  try {
    const access = await requirePlatformOwner(request);
    if ("response" in access) return access.response;
    const validation = validateManagedTenantInput(await request.json().catch(() => ({})));
    if (!validation.valid) return NextResponse.json(validation, { status: 400 });
    const admin = platformAdminClient();
    const [orgCode, orgName, companyCode, slug, hostname, templates, templatePermissions] = await Promise.all([
      admin.from("organizations").select("id").eq("code", validation.organization.code).maybeSingle(),
      admin.from("organizations").select("id").ilike("name", validation.organization.name).limit(1),
      admin.from("companies").select("id").eq("company_code", validation.company.code).limit(1),
      admin.from("organization_domains").select("id").eq("slug", validation.domain.slug).maybeSingle(),
      admin.from("organization_domains").select("id").eq("hostname", validation.domain.hostname).maybeSingle(),
      admin.from("platform_role_templates").select("id,template_key,status,is_tenant_admin_template").in("id", validation.roleTemplateIds || []),
      admin.from("platform_role_template_permissions").select("role_template_id,module_code").in("role_template_id", validation.roleTemplateIds || []),
    ]);
    for (const result of [orgCode, orgName, companyCode, slug, hostname, templates, templatePermissions]) if (result.error) throw result.error;
    const conflicts = { organizationCode: Boolean(orgCode.data), organizationName: Boolean(orgName.data?.length), companyCode: Boolean(companyCode.data?.length), slug: Boolean(slug.data), hostname: Boolean(hostname.data) };
    const templateRows = templates.data || [];
    const templateErrors: string[] = [];
    if (templateRows.length !== (validation.roleTemplateIds || []).length) templateErrors.push("One or more selected role templates do not exist.");
    if (templateRows.some((row: any) => row.status !== "active" || row.is_tenant_admin_template)) templateErrors.push("Selected role templates must be active and cannot be Tenant Administrator.");
    if (new Set(templateRows.map((row: any) => row.template_key)).size !== templateRows.length) templateErrors.push("Selected role templates contain a duplicate role.");
    if ((templatePermissions.data || []).some((row: any) => !(validation.modules || []).includes(row.module_code))) templateErrors.push("A selected role template requires a module that is not enabled.");
    const conflictErrors = [...Object.entries(conflicts).filter(([, value]) => value).map(([key]) => `${key} already exists.`), ...templateErrors];
    return NextResponse.json({ ...validation, valid: conflictErrors.length === 0, errors: conflictErrors, checks: { duplicateIdentifiers: conflictErrors.length === 0 } }, { status: conflictErrors.length === 0 ? 200 : 409 });
  } catch { return NextResponse.json({ error: "Unable to validate the managed tenant plan." }, { status: 500 }); }
}
