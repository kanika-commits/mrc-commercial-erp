import type { User } from "@supabase/supabase-js";
import {
  auditActor,
  auditRequestContext,
  canonicalAuditAction,
  insertErpAuditLog,
  normalizeAuditAction,
  type CanonicalAuditAction,
  type ErpAuditAction,
  type ErpAuditSource,
} from "@/lib/serverAudit";
import { insertDeleteAudit } from "@/lib/serverDeleteAudit";

type ServiceClient = any;

export type AuditActionCategory =
  | "create"
  | "update"
  | "delete"
  | "workflow"
  | "security"
  | "document"
  | "import_export"
  | "session"
  | "system"
  | "other"
  | string;

export type CanonicalDeleteSnapshot = {
  documentType?: string | null;
  documentId?: string | null;
  documentNumber?: string | null;
  deletionReason?: string | null;
  recordSnapshot?: unknown;
  relatedSnapshot?: unknown;
  fileSnapshot?: unknown;
};

export type CanonicalAuditPayload = {
  organizationId?: string | null;
  companyId?: string | null;
  siteId?: string | null;
  moduleCode: string;
  entityType: string;
  recordId?: string | null;
  recordNumber?: string | null;
  parentEntityType?: string | null;
  parentRecordId?: string | null;
  action: CanonicalAuditAction | ErpAuditAction | string;
  actionCategory?: AuditActionCategory | null;
  activityLabel?: string | null;
  description?: string | null;
  workflowStage?: string | null;
  reason?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  relatedSnapshot?: unknown;
  fileSnapshot?: unknown;
  source?: ErpAuditSource;
  importBatchId?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
  deleteSnapshot?: CanonicalDeleteSnapshot | null;
};

export type CanonicalAuditResult = {
  storedAction: string;
  canonicalAction: string;
  deleteAuditId?: string | null;
};

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== "";
}

function withoutUndefined<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function metadataForPayload(payload: CanonicalAuditPayload, user: User, request?: Request | null) {
  const actor = auditActor(user);
  const requestContext = auditRequestContext(request);
  const canonicalAction = canonicalAuditAction(payload.action);
  const storedAction = normalizeAuditAction(payload.action);

  return withoutUndefined({
    canonical_action: canonicalAction,
    stored_action: storedAction,
    record_number: payload.recordNumber || undefined,
    action_category: payload.actionCategory || undefined,
    activity_label: payload.activityLabel || undefined,
    workflow_stage: payload.workflowStage || undefined,
    reason: payload.reason || undefined,
    request_id: payload.requestId || undefined,
    metadata: payload.metadata || undefined,
    related_snapshot: payload.relatedSnapshot ?? undefined,
    file_snapshot: payload.fileSnapshot ?? undefined,
    actor_user_id: actor.userId,
    actor_name: actor.userName,
    actor_email: actor.userEmail || undefined,
    browser: requestContext.browser || undefined,
    device_type: requestContext.deviceType || undefined,
    ip_address: requestContext.ipAddress || undefined,
    timestamp: new Date().toISOString(),
  });
}

function appendAuditMetadata(values: unknown, auditMetadata: Record<string, unknown>) {
  const hasMetadata = Object.values(auditMetadata).some(hasValue);
  if (!hasMetadata) return values;

  if (values && typeof values === "object" && !Array.isArray(values)) {
    return {
      ...(values as Record<string, unknown>),
      __audit: auditMetadata,
    };
  }

  return {
    value: values ?? null,
    __audit: auditMetadata,
  };
}

function descriptionForPayload(payload: CanonicalAuditPayload) {
  return payload.description || payload.activityLabel || payload.reason || null;
}

export async function recordAuditEvent(
  admin: ServiceClient,
  user: User,
  payload: CanonicalAuditPayload,
  request?: Request | null,
): Promise<CanonicalAuditResult> {
  const auditMetadata = metadataForPayload(payload, user, request);
  const canonicalAction = String(auditMetadata.canonical_action || canonicalAuditAction(payload.action));
  const storedAction = String(auditMetadata.stored_action || normalizeAuditAction(payload.action));

  await insertErpAuditLog(
    admin,
    user,
    {
      organizationId: payload.organizationId,
      companyId: payload.companyId,
      siteId: payload.siteId,
      moduleCode: payload.moduleCode,
      entityType: payload.entityType,
      recordId: payload.recordId,
      parentEntityType: payload.parentEntityType,
      parentRecordId: payload.parentRecordId,
      action: storedAction,
      description: descriptionForPayload(payload),
      oldValues: payload.oldValues,
      newValues: appendAuditMetadata(payload.newValues, auditMetadata),
      source: payload.source,
      importBatchId: payload.importBatchId,
    },
    request,
  );

  let deleteAuditId: string | null = null;
  if (payload.deleteSnapshot) {
    const snapshot = payload.deleteSnapshot;
    const deleteAudit = await insertDeleteAudit(admin, user, {
      organizationId: payload.organizationId,
      moduleCode: payload.moduleCode,
      documentType: snapshot.documentType || payload.entityType,
      documentId: snapshot.documentId || payload.recordId || "",
      documentNumber: snapshot.documentNumber || payload.recordNumber || null,
      deletionReason: snapshot.deletionReason || payload.reason || payload.description || "Audit snapshot recorded.",
      recordSnapshot: snapshot.recordSnapshot ?? payload.oldValues ?? null,
      relatedSnapshot: snapshot.relatedSnapshot ?? payload.relatedSnapshot ?? null,
      fileSnapshot: snapshot.fileSnapshot ?? payload.fileSnapshot ?? null,
    });
    deleteAuditId = deleteAudit?.id || null;
  }

  return { storedAction, canonicalAction, deleteAuditId };
}
