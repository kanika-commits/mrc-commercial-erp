import { NextResponse } from "next/server";
import { loadPermissionContext } from "@/lib/serverPermissions";
import { createPrivateStorageAdapter, safeObjectKey } from "@/lib/storage/privateStorage";
import { createBrandingAdmin, resolveCurrentOrganization, TENANT_BRANDING_BUCKET } from "@/lib/serverTenantBranding";
import { isTenantBrandingColor, resolveTenantBranding } from "@/lib/tenantBranding";
import { recordAuditEvent } from "@/lib/auditEvent";

async function authorize(request: Request) {
  const access = await loadPermissionContext(request);
  if ("response" in access) return { response: access.response };
  if (!access.roleCodes.includes("platform_owner")) return { response: NextResponse.json({ error: "Platform Owner access required." }, { status: 403 }) };
  const admin = createBrandingAdmin();
  return { admin, user: access.user, organization: await resolveCurrentOrganization(admin) };
}

async function responseFor(admin: any, organization: any) {
  const { data, error } = await admin.from("organization_branding").select("organization_name, logo_path, primary_color, secondary_color, login_tagline, updated_at").eq("organization_id", organization.id).maybeSingle();
  if (error && error.code !== "42P01") throw error;
  const branding = resolveTenantBranding(data ? { organizationName: data.organization_name, logoPath: data.logo_path, primaryColor: data.primary_color, secondaryColor: data.secondary_color, loginTagline: data.login_tagline } : { organizationName: organization.name });
  if (branding.logoPath) branding.logoUrl = await createPrivateStorageAdapter(admin).createSignedReadUrl({ bucket: TENANT_BRANDING_BUCKET, key: branding.logoPath });
  return { ...branding, organizationId: organization.id, updatedAt: data?.updated_at || null };
}

export async function GET(request: Request) {
  try { const auth = await authorize(request); if ("response" in auth) return auth.response; return NextResponse.json(await responseFor(auth.admin, auth.organization)); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Could not load branding." }, { status: 500 }); }
}

export async function PUT(request: Request) {
  try {
    const auth = await authorize(request); if ("response" in auth) return auth.response;
    const body = await request.json();
    const current = resolveTenantBranding(body);
    if (!isTenantBrandingColor(body.primaryColor) || !isTenantBrandingColor(body.secondaryColor)) return NextResponse.json({ error: "Use six-digit hex colors." }, { status: 400 });
    const { error } = await auth.admin.from("organization_branding").upsert({ organization_id: auth.organization.id, organization_name: current.organizationName, primary_color: current.primaryColor, secondary_color: current.secondaryColor, login_tagline: current.loginTagline, updated_by: auth.user.id, updated_at: new Date().toISOString() }, { onConflict: "organization_id" });
    if (error) throw new Error(error.code === "42P01" ? "Branding storage is not initialized yet." : "Branding settings could not be saved.");
    await recordAuditEvent(auth.admin, auth.user, { organizationId: auth.organization.id, moduleCode: "tenant_branding", entityType: "organization_branding", recordId: auth.organization.id, action: "update", description: "Tenant branding updated." }, request);
    return NextResponse.json(await responseFor(auth.admin, auth.organization));
  } catch (error: any) { return NextResponse.json({ error: error.message || "Could not save branding." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const auth = await authorize(request); if ("response" in auth) return auth.response;
    const form = await request.formData(); const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Select a logo file." }, { status: 400 });
    if (!(<[string, string, string]>(["image/png", "image/jpeg", "image/webp"])).includes(file.type) || file.size > 2 * 1024 * 1024) return NextResponse.json({ error: "Logo must be PNG, JPEG, or WebP and no larger than 2 MB." }, { status: 400 });
    const key = safeObjectKey(["branding", "logo", `${crypto.randomUUID()}-${file.name}`]);
    const storage = createPrivateStorageAdapter(auth.admin); await storage.upload({ bucket: TENANT_BRANDING_BUCKET, key, file });
    const { data: old } = await auth.admin.from("organization_branding").select("logo_path").eq("organization_id", auth.organization.id).maybeSingle();
    const { error } = await auth.admin.from("organization_branding").upsert({ organization_id: auth.organization.id, organization_name: auth.organization.name, logo_path: key, updated_by: auth.user.id, updated_at: new Date().toISOString() }, { onConflict: "organization_id" });
    if (error) { await storage.delete({ bucket: TENANT_BRANDING_BUCKET, key }); throw new Error(error.code === "42P01" ? "Branding storage is not initialized yet." : "Branding settings could not be saved."); }
    if (old?.logo_path) await storage.delete({ bucket: TENANT_BRANDING_BUCKET, key: old.logo_path }).catch(() => null);
    await recordAuditEvent(auth.admin, auth.user, { organizationId: auth.organization.id, moduleCode: "tenant_branding", entityType: "organization_branding", recordId: auth.organization.id, action: "update", description: "Tenant logo updated." }, request);
    return NextResponse.json(await responseFor(auth.admin, auth.organization));
  } catch (error: any) { return NextResponse.json({ error: error.message || "Could not upload logo." }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  try { const auth = await authorize(request); if ("response" in auth) return auth.response; const { data } = await auth.admin.from("organization_branding").select("logo_path").eq("organization_id", auth.organization.id).maybeSingle(); await auth.admin.from("organization_branding").update({ logo_path: null, updated_by: auth.user.id, updated_at: new Date().toISOString() }).eq("organization_id", auth.organization.id); if (data?.logo_path) await createPrivateStorageAdapter(auth.admin).delete({ bucket: TENANT_BRANDING_BUCKET, key: data.logo_path }); return NextResponse.json(await responseFor(auth.admin, auth.organization)); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Could not remove logo." }, { status: 500 }); }
}
