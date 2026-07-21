import type { User } from "@supabase/supabase-js";

type ServiceClient = any;

export type ErpAuditAction =
  | "create"
  | "update"
  | "delete"
  | "restore"
  | "import"
  | "export"
  | "upload"
  | "download"
  | "approve"
  | "reject"
  | "login"
  | "logout"
  | "password_change"
  | "permission_change"
  | "salary_revision"
  | "employment_change"
  | "document_upload"
  | "document_replace"
  | "document_delete"
  | "photo_upload"
  | "photo_replace"
  | "manual_event"
  | "other";

export type ErpAuditInput = {
  organizationId?: string | null;
  companyId?: string | null;
  siteId?: string | null;
  moduleCode: string;
  entityType: string;
  recordId?: string | null;
  parentEntityType?: string | null;
  parentRecordId?: string | null;
  action: ErpAuditAction;
  description?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  source?: "system" | "manual" | "import" | "api";
  importBatchId?: string | null;
};

function actorName(user: User) {
  return (
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email ||
    "Unknown User"
  );
}

function requestIp(request?: Request | null) {
  if (!request) return null;
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || null;
  return request.headers.get("x-real-ip") || null;
}

function browserFromUserAgent(userAgent: string | null) {
  const ua = userAgent || "";
  if (/Edg\//i.test(ua)) return "Edge";
  if (/Chrome\//i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return "Safari";
  if (/Firefox\//i.test(ua)) return "Firefox";
  return null;
}

function deviceFromUserAgent(userAgent: string | null) {
  const ua = userAgent || "";
  if (/Mobile|Android|iPhone|iPad/i.test(ua)) return "mobile";
  if (/Macintosh|Windows|Linux/i.test(ua)) return "desktop";
  return null;
}

export async function insertErpAuditLog(
  admin: ServiceClient,
  user: User,
  input: ErpAuditInput,
  request?: Request | null,
) {
  const userAgent = request?.headers.get("user-agent") || null;

  const { error } = await admin.from("erp_audit_logs").insert({
    organization_id: input.organizationId || null,
    company_id: input.companyId || null,
    site_id: input.siteId || null,
    module_code: input.moduleCode,
    entity_type: input.entityType,
    record_id: input.recordId || null,
    parent_entity_type: input.parentEntityType || null,
    parent_record_id: input.parentRecordId || null,
    action: input.action,
    description: input.description || null,
    old_values: input.oldValues ?? null,
    new_values: input.newValues ?? null,
    ip_address: requestIp(request),
    user_agent: userAgent,
    browser: browserFromUserAgent(userAgent),
    device_type: deviceFromUserAgent(userAgent),
    source: input.source || "system",
    import_batch_id: input.importBatchId || null,
    created_by: user.id,
    created_by_name: actorName(user),
    created_by_email: user.email || null,
  });

  if (error) {
    console.error("[erp_audit_logs] insert failed:", error.message);
  }
}
