import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requirePermission, type ServerPermissionContext } from "@/lib/serverPermissions";
import { HR_EMPLOYEE_IMPORT_MODULE } from "@/lib/hr/employeeImport";
import {
  applyOrganizationScope,
  loadActorOrganizationScope,
} from "@/lib/serverOrganizationScope";

export function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(supabaseUrl, serviceRoleKey);
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function requireImportPermission(request: Request, action: string) {
  return requirePermission(request, HR_EMPLOYEE_IMPORT_MODULE, action);
}

export function actorName(auth: ServerPermissionContext) {
  return (
    auth.user.user_metadata?.full_name ||
    auth.user.user_metadata?.name ||
    auth.user.email ||
    "HR User"
  );
}

export async function loadBatchForActor(
  admin: ReturnType<typeof adminClient>,
  batchId: string,
  auth: ServerPermissionContext,
) {
  const organizationScope = await loadActorOrganizationScope(admin, auth);
  let query = admin
    .from("employee_import_batches")
    .select("*")
    .eq("id", batchId);

  const scopedQuery = applyOrganizationScope(query, organizationScope);
  if (!scopedQuery) {
    return { response: jsonError("Import batch was not found.", 404) } as const;
  }

  query = scopedQuery;

  const { data: batch, error } = await query.maybeSingle();

  if (error) throw error;
  if (!batch) return { response: jsonError("Import batch was not found.", 404) } as const;

  return { batch } as const;
}
