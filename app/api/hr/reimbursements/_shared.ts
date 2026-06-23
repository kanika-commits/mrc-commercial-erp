import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { ServerPermissionContext } from "@/lib/serverPermissions";
import {
  applyOrganizationScope,
  isGlobalScope,
  isInOrganizationScope,
  loadActorOrganizationScope,
} from "@/lib/serverOrganizationScope";

export { isInOrganizationScope };

export const MODULE_CODE = "reimbursements";
export const DOCUMENT_BUCKET = "reimbursement-documents";

export type AdminClient = ReturnType<typeof adminClient>;

export function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function normalizeStatus(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function userName(auth: ServerPermissionContext) {
  return (
    auth.user.user_metadata?.full_name ||
    auth.user.user_metadata?.name ||
    auth.user.email ||
    "HR User"
  );
}

export function amountValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function calculateTotalAmount(amount: unknown, gstAmount: unknown) {
  return amountValue(amount) + amountValue(gstAmount);
}

export function withComputedAmounts<T extends Record<string, any>>(claim: T) {
  return {
    ...claim,
    amount: amountValue(claim.amount),
    gst_amount: amountValue(claim.gst_amount),
    total_amount: calculateTotalAmount(claim.amount, claim.gst_amount),
  };
}

export async function loadActorAssignments(admin: AdminClient, userId: string) {
  const { data, error } = await admin
    .from("user_access_assignments")
    .select("company_id, site_id")
    .eq("user_id", userId);

  if (error) throw error;

  return {
    companyIds: Array.from(
      new Set((data || []).map((row) => row.company_id).filter(Boolean))
    ) as string[],
    siteIds: Array.from(
      new Set((data || []).map((row) => row.site_id).filter(Boolean))
    ) as string[],
  };
}

export async function ensureEmployeeInScope(
  admin: AdminClient,
  auth: ServerPermissionContext,
  employeeId: string
) {
  const organizationScope = await loadActorOrganizationScope(admin, auth);
  const { data: employee, error } = await admin
    .from("hr_employees")
    .select("id, organization_id, company_id, site_id, status")
    .eq("id", employeeId)
    .neq("status", "deleted")
    .maybeSingle();

  if (error) throw error;

  if (!employee) {
    return { error: "Selected employee was not found.", status: 404 } as const;
  }

  if (!isInOrganizationScope(organizationScope, employee.organization_id)) {
    return { error: "You do not have access to this organization.", status: 403 } as const;
  }

  if (!isGlobalScope(organizationScope)) {
    const assignments = await loadActorAssignments(admin, auth.user.id);

    if (assignments.siteIds.length > 0) {
      if (!employee.site_id || !assignments.siteIds.includes(employee.site_id)) {
        return { error: "Selected employee is not available for this user.", status: 403 } as const;
      }
    } else if (
      assignments.companyIds.length > 0 &&
      !assignments.companyIds.includes(employee.company_id)
    ) {
      return { error: "Selected employee is not available for this user.", status: 403 } as const;
    }
  }

  return { employee, organizationScope } as const;
}

export async function loadClaimForAccess(
  admin: AdminClient,
  auth: ServerPermissionContext,
  id: string
) {
  const { data: claim, error } = await admin
    .from("reimbursement_claims")
    .select("*")
    .eq("id", id)
    .neq("status", "deleted")
    .maybeSingle();

  if (error) throw error;

  if (!claim) {
    return { error: "Reimbursement claim was not found.", status: 404 } as const;
  }

  const organizationScope = await loadActorOrganizationScope(admin, auth);

  if (!isInOrganizationScope(organizationScope, claim.organization_id)) {
    return { error: "You do not have access to this organization.", status: 403 } as const;
  }

  if (!isGlobalScope(organizationScope)) {
    const assignments = await loadActorAssignments(admin, auth.user.id);

    if (assignments.siteIds.length > 0) {
      if (!claim.site_id || !assignments.siteIds.includes(claim.site_id)) {
        return { error: "You do not have access to this reimbursement claim.", status: 403 } as const;
      }
    } else if (
      assignments.companyIds.length > 0 &&
      !assignments.companyIds.includes(claim.company_id)
    ) {
      return { error: "You do not have access to this reimbursement claim.", status: 403 } as const;
    }
  }

  return { claim, organizationScope } as const;
}

export async function scopedClaimsQuery(
  admin: AdminClient,
  auth: ServerPermissionContext
) {
  const organizationScope = await loadActorOrganizationScope(admin, auth);
  let query = admin
    .from("reimbursement_claims")
    .select("*")
    .neq("status", "deleted")
    .order("created_at", { ascending: false });

  const scopedQuery = applyOrganizationScope(query, organizationScope);
  if (!scopedQuery) {
    return { query: null, organizationScope } as const;
  }

  query = scopedQuery;

  if (!isGlobalScope(organizationScope)) {
    const assignments = await loadActorAssignments(admin, auth.user.id);

    if (assignments.siteIds.length > 0) {
      query = query.in("site_id", assignments.siteIds);
    } else if (assignments.companyIds.length > 0) {
      query = query.in("company_id", assignments.companyIds);
    }
  }

  return { query, organizationScope } as const;
}

export async function insertStatusHistory(
  admin: AdminClient,
  auth: ServerPermissionContext,
  values: {
    organizationId: string;
    claimId: string;
    fromStatus?: string | null;
    toStatus: string;
    action: string;
    remarks?: string | null;
  }
) {
  const { error } = await admin.from("reimbursement_status_history").insert({
    organization_id: values.organizationId,
    reimbursement_claim_id: values.claimId,
    from_status: values.fromStatus || null,
    to_status: values.toStatus,
    action: values.action,
    remarks: values.remarks || null,
    changed_by: auth.user.id,
    changed_by_name: userName(auth),
    changed_by_email: auth.user.email || null,
  });

  if (error) throw error;
}

export function isEditableClaim(claim: Record<string, any>) {
  const status = normalizeStatus(claim.status);
  return status === "draft" || status === "rejected";
}

export function normalizeStoragePath(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!raw.startsWith("http")) return raw.replace(/^\/+/, "");

  const marker = `/storage/v1/object/public/${DOCUMENT_BUCKET}/`;
  const markerIndex = raw.indexOf(marker);

  if (markerIndex >= 0) {
    return decodeURIComponent(raw.slice(markerIndex + marker.length));
  }

  return raw;
}
