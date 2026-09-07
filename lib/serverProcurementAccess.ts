import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { hasServerPermission, requireAnyPermission, requirePermission } from "@/lib/serverPermissions";

export const ITEM_MODULE = "procurement_items";
export const REQUISITION_MODULE = "purchase_requisitions";
export const APPROVAL_MODULE = "purchase_requisition_approval";
export const MATERIAL_APPROVAL_MODULE = "procurement_material_approvals";

export function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(supabaseUrl, serviceRoleKey);
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function text(value: unknown) {
  return String(value || "").trim();
}

export function actorName(user: User) {
  return text(user.user_metadata?.full_name || user.user_metadata?.name || user.email) || null;
}

export function actorFields(user: User) {
  return {
    updated_by: user.id,
    updated_by_name: actorName(user),
    updated_by_email: user.email || null,
  };
}

export function createActorFields(user: User) {
  const actor = actorFields(user);
  return {
    created_by: user.id,
    created_by_name: actor.updated_by_name,
    created_by_email: actor.updated_by_email,
    ...actor,
  };
}

export async function requireProcurementPermission(request: Request, moduleCode: string, actionCode: string) {
  return requirePermission(request, moduleCode, actionCode);
}

export async function requireProcurementAny(request: Request, checks: Array<{ moduleCode: string; actionCode: string }>) {
  return requireAnyPermission(request, checks);
}

export function canProcurement(context: any, moduleCode: string, actionCode: string) {
  return hasServerPermission(context, moduleCode, actionCode);
}

export function hasGlobalProcurementAccess(context: any) {
  return context?.isGlobalAccess === true || context?.roleCodes?.includes("platform_owner");
}

export function applyCompanySiteAccess(query: any, context: any) {
  if (hasGlobalProcurementAccess(context)) return query;
  if ((context.sites || []).length > 0) return query.in("site_id", context.sites);
  if ((context.companies || []).length > 0) return query.in("company_id", context.companies);
  return null;
}

export function applyOrganizationAccess(query: any, context: any) {
  if (hasGlobalProcurementAccess(context)) return query;
  if ((context.organizations || []).length === 0) return null;
  return query.in("organization_id", context.organizations);
}

export async function validateCompanySiteAccess(admin: any, context: any, companyId: string, siteId: string) {
  const [companyResult, siteResult] = await Promise.all([
    admin.from("companies").select("id, organization_id, company_name, company_code, status").eq("id", companyId).maybeSingle(),
    admin.from("sites").select("id, organization_id, company_id, site_name, site_code, status").eq("id", siteId).maybeSingle(),
  ]);

  if (companyResult.error) throw companyResult.error;
  if (siteResult.error) throw siteResult.error;

  const company = companyResult.data;
  const site = siteResult.data;
  if (!company) return { error: "Selected company was not found.", status: 404 } as const;
  if (!site) return { error: "Selected site was not found.", status: 404 } as const;
  if (company.status !== "active") return { error: "Selected company is inactive.", status: 400 } as const;
  if (site.status !== "active") return { error: "Selected site is inactive.", status: 400 } as const;
  if (company.organization_id !== site.organization_id || (site.company_id !== company.id && site.company_id !== null)) return { error: "Selected company and site are not a valid organization scope.", status: 400 } as const;

  if (!hasGlobalProcurementAccess(context)) {
    if (!(context.organizations || []).includes(company.organization_id)) return { error: "Selected company/site is outside your organization access.", status: 403 } as const;
    if ((context.sites || []).length > 0 && !(context.sites || []).includes(siteId)) return { error: "Selected site is outside your access.", status: 403 } as const;
    if ((context.companies || []).length > 0 && !(context.companies || []).includes(companyId)) return { error: "Selected company is outside your access.", status: 403 } as const;
  }

  return { company, site, organizationId: company.organization_id } as const;
}

export async function validateOrganizationSiteAccess(admin: any, context: any, companyId: string, siteId: string) {
  const [companyResult, siteResult] = await Promise.all([
    admin.from("companies").select("id, organization_id, company_name, company_code, status").eq("id", companyId).maybeSingle(),
    admin.from("sites").select("id, organization_id, company_id, site_name, site_code, status").eq("id", siteId).maybeSingle(),
  ]);
  if (companyResult.error) throw companyResult.error;
  if (siteResult.error) throw siteResult.error;
  const company = companyResult.data;
  const site = siteResult.data;
  if (!company) return { error: "Selected company was not found.", status: 404 } as const;
  if (!site) return { error: "Selected site was not found.", status: 404 } as const;
  if (company.status !== "active") return { error: "Selected company is inactive.", status: 400 } as const;
  if (site.status !== "active") return { error: "Selected site is inactive.", status: 400 } as const;
  if (company.organization_id !== site.organization_id) return { error: "Selected company and site are not in the same organization.", status: 400 } as const;
  if (!hasGlobalProcurementAccess(context)) {
    if (!(context.organizations || []).includes(company.organization_id)) return { error: "Selected company/site is outside your organization access.", status: 403 } as const;
    if ((context.sites || []).length > 0 && !(context.sites || []).includes(siteId)) return { error: "Selected site is outside your access.", status: 403 } as const;
    if ((context.companies || []).length > 0 && !(context.companies || []).includes(companyId)) return { error: "Selected company is outside your access.", status: 403 } as const;
  }
  return { company, site, organizationId: company.organization_id } as const;
}
