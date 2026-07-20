import { createClient } from "@supabase/supabase-js";
import type { ServerPermission, ServerPermissionContext } from "@/lib/serverPermissions";
import {
  applyOrganizationScope,
  isGlobalScope,
  loadActorOrganizationScope,
  type OrganizationScope,
} from "@/lib/serverOrganizationScope";

export function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export function canAny(
  permissions: ServerPermission[],
  moduleCode: string,
  actionCodes: string[],
) {
  return permissions.some(
    (permission) =>
      permission.allowed === true &&
      ((permission.module_code === "*" && permission.action_code === "*") ||
        (permission.module_code === moduleCode &&
          actionCodes.includes(permission.action_code))),
  );
}

export async function loadActorAssignments(
  admin: ReturnType<typeof adminClient>,
  userId: string,
) {
  const { data, error } = await admin
    .from("user_access_assignments")
    .select("company_id, site_id")
    .eq("user_id", userId);

  if (error) throw error;

  return {
    companyIds: Array.from(
      new Set((data || []).map((row) => row.company_id).filter(Boolean)),
    ) as string[],
    siteIds: Array.from(
      new Set((data || []).map((row) => row.site_id).filter(Boolean)),
    ) as string[],
  };
}

export async function loadApprovalScope(
  admin: ReturnType<typeof adminClient>,
  auth: ServerPermissionContext,
) {
  const organizationScope = await loadActorOrganizationScope(admin, auth);
  const assignments = isGlobalScope(organizationScope)
    ? { companyIds: [], siteIds: [] }
    : await loadActorAssignments(admin, auth.user.id);

  return { organizationScope, assignments };
}

export function applyCompanySiteScope(
  query: any,
  assignments: { companyIds: string[]; siteIds: string[] },
) {
  if (assignments.siteIds.length > 0) {
    return query.in("site_id", assignments.siteIds);
  }

  if (assignments.companyIds.length > 0) {
    return query.in("company_id", assignments.companyIds);
  }

  return query;
}

export async function loadAllowedWorkOrderIds(
  admin: ReturnType<typeof adminClient>,
  organizationScope: OrganizationScope,
  assignments: { companyIds: string[]; siteIds: string[] },
) {
  if (isGlobalScope(organizationScope)) return null;

  let query = admin.from("work_orders").select("id");

  const scopedQuery = applyOrganizationScope(query, organizationScope);
  if (!scopedQuery) return [];
  query = scopedQuery;

  query = applyCompanySiteScope(query, assignments);

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((workOrder) => workOrder.id).filter(Boolean) as string[];
}

export function applyWorkOrderScope(
  query: any,
  workOrderIds: string[] | null,
  column = "work_order_id",
) {
  if (workOrderIds === null) return query;
  if (workOrderIds.length === 0) return null;
  return query.in(column, workOrderIds);
}

export async function safeQuery(query: any) {
  if (!query) return [];
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
