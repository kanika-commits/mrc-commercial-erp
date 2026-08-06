import type { User } from "@supabase/supabase-js";

type ServiceClient = any;

export const STORED_AUDIT_ACTIONS = [
  "create",
  "update",
  "delete",
  "restore",
  "import",
  "export",
  "upload",
  "download",
  "approve",
  "reject",
  "login",
  "logout",
  "password_change",
  "permission_change",
  "salary_revision",
  "employment_change",
  "document_upload",
  "document_replace",
  "document_delete",
  "photo_upload",
  "photo_replace",
  "erp_profile_linked",
  "erp_profile_unlinked",
  "erp_profile_changed",
  "manual_event",
  "other",
] as const;

export const CANONICAL_AUDIT_ACTIONS = [
  "create",
  "update",
  "delete",
  "restore",
  "approve",
  "reject",
  "send_back",
  "submit",
  "finalize",
  "suspend",
  "resume",
  "activate",
  "deactivate",
  "transfer",
  "upload",
  "download",
  "import",
  "export",
  "permission_change",
  "role_assignment",
  "password_change",
  "login",
  "logout",
] as const;

export type StoredAuditAction = (typeof STORED_AUDIT_ACTIONS)[number];
export type CanonicalAuditAction = (typeof CANONICAL_AUDIT_ACTIONS)[number];
export type ErpAuditAction = StoredAuditAction | CanonicalAuditAction;

export type ErpAuditSource = "system" | "manual" | "import" | "api";

export type ErpAuditInput = {
  organizationId?: string | null;
  companyId?: string | null;
  siteId?: string | null;
  moduleCode: string;
  entityType: string;
  recordId?: string | null;
  parentEntityType?: string | null;
  parentRecordId?: string | null;
  action: ErpAuditAction | string;
  description?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  source?: ErpAuditSource;
  importBatchId?: string | null;
};

export type AuditRequestContext = {
  ipAddress: string | null;
  userAgent: string | null;
  browser: string | null;
  deviceType: string | null;
};

export type AuditActor = {
  userId: string;
  userName: string;
  userEmail: string | null;
};

const storedActionSet = new Set<string>(STORED_AUDIT_ACTIONS);

const canonicalToStoredAction: Record<string, StoredAuditAction> = {
  send_back: "reject",
  submit: "manual_event",
  finalize: "approve",
  suspend: "reject",
  resume: "restore",
  activate: "update",
  deactivate: "update",
  transfer: "update",
  role_assignment: "permission_change",
};

const legacyAliasToStoredAction: Record<string, StoredAuditAction> = {
  registered: "create",
  transferred: "update",
  suspended: "reject",
  batch_register: "import",
  validate: "manual_event",
};

export function normalizeAuditAction(action: unknown): StoredAuditAction {
  const value = String(action || "other").trim().toLowerCase();
  if (storedActionSet.has(value)) return value as StoredAuditAction;
  return canonicalToStoredAction[value] || legacyAliasToStoredAction[value] || "other";
}

export function canonicalAuditAction(action: unknown): string {
  return String(action || "other").trim().toLowerCase() || "other";
}

export function auditActorName(user: User) {
  return (
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email ||
    "Unknown User"
  );
}

export function auditActor(user: User): AuditActor {
  return {
    userId: user.id,
    userName: auditActorName(user),
    userEmail: user.email || null,
  };
}

export function requestIp(request?: Request | null) {
  if (!request) return null;
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || null;
  return request.headers.get("x-real-ip") || null;
}

export function browserFromUserAgent(userAgent: string | null) {
  const ua = userAgent || "";
  if (/Edg\//i.test(ua)) return "Edge";
  if (/Chrome\//i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return "Safari";
  if (/Firefox\//i.test(ua)) return "Firefox";
  return null;
}

export function deviceFromUserAgent(userAgent: string | null) {
  const ua = userAgent || "";
  if (/Mobile|Android|iPhone|iPad/i.test(ua)) return "mobile";
  if (/Macintosh|Windows|Linux/i.test(ua)) return "desktop";
  return null;
}

export function auditRequestContext(request?: Request | null): AuditRequestContext {
  const userAgent = request?.headers.get("user-agent") || null;
  return {
    ipAddress: requestIp(request),
    userAgent,
    browser: browserFromUserAgent(userAgent),
    deviceType: deviceFromUserAgent(userAgent),
  };
}

export async function insertErpAuditLog(
  admin: ServiceClient,
  user: User,
  input: ErpAuditInput,
  request?: Request | null,
) {
  const requestContext = auditRequestContext(request);
  const actor = auditActor(user);

  const { error } = await admin.from("erp_audit_logs").insert({
    organization_id: input.organizationId || null,
    company_id: input.companyId || null,
    site_id: input.siteId || null,
    module_code: input.moduleCode,
    entity_type: input.entityType,
    record_id: input.recordId || null,
    parent_entity_type: input.parentEntityType || null,
    parent_record_id: input.parentRecordId || null,
    action: normalizeAuditAction(input.action),
    description: input.description || null,
    old_values: input.oldValues ?? null,
    new_values: input.newValues ?? null,
    ip_address: requestContext.ipAddress,
    user_agent: requestContext.userAgent,
    browser: requestContext.browser,
    device_type: requestContext.deviceType,
    source: input.source || "system",
    import_batch_id: input.importBatchId || null,
    created_by: actor.userId,
    created_by_name: actor.userName,
    created_by_email: actor.userEmail,
  });

  if (error) {
    console.error("[erp_audit_logs] insert failed:", error.message);
  }
}
