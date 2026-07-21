import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/serverPermissions";
import {
  isGlobalScope,
  loadActorOrganizationScope,
} from "@/lib/serverOrganizationScope";
import {
  hrAdminClient,
  loadActorAssignments,
} from "../hr/employees/_shared";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, "hr_audit", "view");
    if ("response" in auth) return auth.response;

    const admin = hrAdminClient();
    const { searchParams } = new URL(request.url);
    const moduleCode = searchParams.get("module_code")?.trim();
    const entityType = searchParams.get("entity_type")?.trim();
    const recordId = searchParams.get("record_id")?.trim();
    const action = searchParams.get("action")?.trim();
    const source = searchParams.get("source")?.trim();
    const user = searchParams.get("user")?.trim();
    const dateFrom = searchParams.get("date_from")?.trim();
    const dateTo = searchParams.get("date_to")?.trim();
    const search = searchParams.get("search")?.trim();

    let query = admin
      .from("erp_audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (moduleCode) query = query.eq("module_code", moduleCode);
    if (entityType) query = query.eq("entity_type", entityType);
    if (recordId) query = query.eq("record_id", recordId);
    if (action) query = query.eq("action", action);
    if (source) query = query.eq("source", source);
    if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
    if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);
    if (user) query = query.or(`created_by_email.ilike.%${user}%,created_by_name.ilike.%${user}%`);
    if (search) query = query.or(`action.ilike.%${search}%,description.ilike.%${search}%,created_by_email.ilike.%${search}%,created_by_name.ilike.%${search}%`);

    const organizationScope = await loadActorOrganizationScope(admin, auth);
    if (!isGlobalScope(organizationScope)) {
      if (organizationScope.length === 0) {
        return NextResponse.json({ auditLogs: [] });
      }
      query = query.in("organization_id", organizationScope);

      const assignments = await loadActorAssignments(admin, auth.user.id);
      if (assignments.siteIds.length > 0) {
        query = query.in("site_id", assignments.siteIds);
      } else if (assignments.companyIds.length > 0) {
        query = query.in("company_id", assignments.companyIds);
      }
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ auditLogs: data || [] });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load audit logs.", 500);
  }
}
