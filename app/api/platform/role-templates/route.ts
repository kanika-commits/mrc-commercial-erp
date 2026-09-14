import { NextResponse } from "next/server";
import { platformAdminClient, requirePlatformOwner } from "@/lib/serverPlatform";

export async function GET(request: Request) {
  const access = await requirePlatformOwner(request);
  if ("response" in access) return access.response;
  const admin = platformAdminClient();
  const templates = await admin.from("platform_role_templates").select("id, template_key, name, description, status, sort_order, is_default, is_tenant_admin_template, applicable_modules").eq("status", "active").order("sort_order").order("name");
  if (templates.error) return NextResponse.json({ error: templates.error.message }, { status: 500 });
  const ids = (templates.data || []).map((row: { id: string }) => row.id);
  const links = ids.length ? await admin.from("platform_role_template_permissions").select("role_template_id, module_code, action_code").in("role_template_id", ids) : { data: [], error: null };
  if (links.error) return NextResponse.json({ error: links.error.message }, { status: 500 });
  return NextResponse.json({ templates: (templates.data || []).map((template: any) => ({ ...template, permissions: (links.data || []).filter((link: any) => link.role_template_id === template.id).map(({ module_code, action_code }: any) => ({ module_code, action_code })) })) });
}
