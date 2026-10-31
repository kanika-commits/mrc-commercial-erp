import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";
import { isGlobalScope, loadActorOrganizationScope } from "@/lib/serverOrganizationScope";
import { loadActorAssignments } from "@/app/api/approvals/_shared";

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission(request, "organizations", "view");
    if ("response" in auth) return auth.response;
    const { id } = await params;
    const admin = adminClient();
    const [organizationScope, assignments] = await Promise.all([loadActorOrganizationScope(admin, auth), loadActorAssignments(admin, auth.user.id)]);
    if (!isGlobalScope(organizationScope) && !organizationScope.includes(id)) return NextResponse.json({ error: "Organization was not found." }, { status: 404 });
    const { data: organization, error: organizationError } = await admin.from("organizations").select("id, name, code, status, created_at").eq("id", id).maybeSingle();
    if (organizationError) throw organizationError;
    if (!organization) return NextResponse.json({ error: "Organization was not found." }, { status: 404 });
    let companiesQuery = admin.from("companies").select("id, company_name, company_code, status").eq("organization_id", id).order("company_name");
    if (!isGlobalScope(organizationScope) && assignments.companyIds.length > 0) companiesQuery = companiesQuery.in("id", assignments.companyIds);
    const { data: companies, error: companiesError } = await companiesQuery;
    if (companiesError) throw companiesError;
    let accessQuery = admin.from("user_access_assignments").select("user_id, company_id, site_id").eq("organization_id", id);
    if (!isGlobalScope(organizationScope) && assignments.siteIds.length > 0) accessQuery = accessQuery.in("site_id", assignments.siteIds);
    else if (!isGlobalScope(organizationScope) && assignments.companyIds.length > 0) accessQuery = accessQuery.in("company_id", assignments.companyIds);
    const { data: accessRows, error: accessError } = await accessQuery;
    if (accessError) throw accessError;
    const userIds = Array.from(new Set((accessRows || []).map((row: any) => row.user_id).filter(Boolean)));
    const { data: profileRows, error: profileError } = userIds.length ? await admin.from("profiles").select("id, email, full_name, status").in("id", userIds) : { data: [], error: null };
    if (profileError) throw profileError;
    const { data: userRoleRows, error: userRoleError } = userIds.length ? await admin.from("user_roles").select("user_id, role_id").in("user_id", userIds) : { data: [], error: null };
    if (userRoleError) throw userRoleError;
    const roleIds = Array.from(new Set((userRoleRows || []).map((row: any) => row.role_id).filter(Boolean)));
    const { data: roleRows, error: roleError } = roleIds.length ? await admin.from("roles").select("id, role_name, role_code").in("id", roleIds) : { data: [], error: null };
    if (roleError) throw roleError;
    const rolesById = new Map((roleRows || []).map((role: any) => [role.id, role]));
    const rolesByUserId = new Map<string, string[]>();
    (userRoleRows || []).forEach((row: any) => { const role = rolesById.get(row.role_id); if (role) rolesByUserId.set(row.user_id, [...(rolesByUserId.get(row.user_id) || []), role.role_name || role.role_code]); });
    return NextResponse.json({ organization, companies: companies || [], users: (profileRows || []).map((profile: any) => ({ ...profile, roles: rolesByUserId.get(profile.id) || [] })) });
  } catch {
    return NextResponse.json({ error: "Could not load the organization." }, { status: 500 });
  }
}
