import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createPrivateStorageAdapter, safeObjectKey } from "@/lib/storage/privateStorage";
import {
  actorCanEditAttendanceDate,
  getActiveHistoricalAttendanceAccess,
  actorFields,
  applyCompanySiteScope,
  audit,
  isGlobalOrSuperAdmin,
  jsonError,
  LABOUR_DOCUMENT_BUCKET,
  loadLabourEditLockBlocker,
  loadMusterSiteHrBlocker,
  originatingAttendanceSystem,
  requireLabourPermission,
  validateLabourCompanySiteIndependent,
} from "@/app/api/labour/_shared";
import { isoDate } from "@/lib/labour/operations";
import { hasActiveSiteHrAssignment } from "@/lib/serverSiteHr";
import { normalizeText } from "@/lib/labour/constants";

const MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024;

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

async function checksum(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function loadPeriod(access: any, input: { organizationId: string; companyId: string; siteId: string; attendanceDate: string }) {
  let query = access.admin
    .from("labour_attendance_periods")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("period_month", `${input.attendanceDate.slice(0, 7)}-01`)
    .eq("originating_attendance_system", "standard")
    .order("contractor_profile_id", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(1);
  query = applyCompanySiteScope(query, access.assignments);
  if (!query) return null;
  const { data, error } = await query;
  if (error) throw error;
  return data?.[0] || null;
}

function dateStatus(period: any, attendanceDate: string) {
  return period?.summary?.date_statuses?.[attendanceDate]?.status || "draft";
}

function canMutateDateDocument(period: any, attendanceDate: string) {
  return ["draft", "reopened"].includes(dateStatus(period, attendanceDate));
}

async function resolveContext(access: any, input: { organizationId?: string | null; companyId?: string | null; siteId?: string | null; attendanceDate?: string | null; requireSiteHr?: boolean }) {
  const attendanceDate = isoDate(input.attendanceDate);
  if (!input.companyId || !input.siteId || !attendanceDate) return { error: "Company, site and attendance date are required.", status: 400 } as const;
  const scopeCheck = await validateLabourCompanySiteIndependent(access, input.organizationId || null, input.companyId, input.siteId);
  if ("error" in scopeCheck) return { error: scopeCheck.error || "Selected company/site is not available.", status: 403 } as const;
  const organizationId = scopeCheck.organizationId;
  if (input.requireSiteHr !== false) {
    const blocker = await loadMusterSiteHrBlocker(access, { organizationId, companyId: input.companyId, siteId: input.siteId });
    if (blocker) return { error: blocker, status: 403 } as const;
  }
  const period = await loadPeriod(access, { organizationId, companyId: input.companyId, siteId: input.siteId, attendanceDate });
  if (period && originatingAttendanceSystem(period.originating_attendance_system) !== "standard") {
    return { error: "This attendance period is not a Standard Attendance register.", status: 403 } as const;
  }
  return { organizationId, companyId: input.companyId, siteId: input.siteId, attendanceDate, period } as const;
}

async function loadActiveDocument(access: any, periodId: string, attendanceDate: string) {
  const { data, error } = await access.admin
    .from("labour_attendance_date_documents")
    .select("*")
    .eq("period_id", periodId)
    .eq("attendance_date", attendanceDate)
    .eq("is_active", true)
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function publicDocument(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    file_name: row.original_file_name,
    mime_type: row.mime_type,
    file_size: row.size_bytes,
    uploaded_at: row.uploaded_at,
    uploaded_by_name: row.uploaded_by_name,
    uploaded_by_email: row.uploaded_by_email,
  };
}

export async function GET(request: Request) {
  try {
    let access = await requireLabourPermission(request, "labour_attendance", "view");
    if ("response" in access) access = await requireLabourPermission(request, "labour_daily_submission", "view");
    if ("response" in access) return access.response;
    const { searchParams } = new URL(request.url);
    const resolved = await resolveContext(access, {
      organizationId: text(searchParams.get("organization_id")),
      companyId: text(searchParams.get("company_id")),
      siteId: text(searchParams.get("site_id")),
      attendanceDate: text(searchParams.get("attendance_date")),
      requireSiteHr: false,
    });
    if ("error" in resolved) return jsonError(resolved.error || "Invalid attendance document request.", resolved.status || 400);
    if (!resolved.period) return NextResponse.json({ document: null });
    const document = await loadActiveDocument(access, resolved.period.id, resolved.attendanceDate);
    if (text(searchParams.get("open")) === "true") {
      if (!document) return jsonError("Supporting PDF not found.", 404);
      const url = await createPrivateStorageAdapter(access.admin).createSignedReadUrl({ bucket: document.storage_bucket, key: document.storage_key });
      return NextResponse.json({ url, document: publicDocument(document) });
    }
    return NextResponse.json({ document: publicDocument(document) });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load attendance supporting PDF.", 500);
  }
}

export async function POST(request: Request) {
  let stored: { bucket: string; key: string } | null = null;
  let deactivatedDocumentId: string | null = null;
  let replacementInserted = false;
  try {
    const access = await requireLabourPermission(request, "labour_attendance", "edit");
    if ("response" in access) return access.response;
    const formData = await request.formData();
    const file = formData.get("file");
    const resolved = await resolveContext(access, {
      organizationId: text(formData.get("organization_id")),
      companyId: text(formData.get("company_id")),
      siteId: text(formData.get("site_id")),
      attendanceDate: text(formData.get("attendance_date")),
    });
    if ("error" in resolved) return jsonError(resolved.error || "Invalid attendance document request.", resolved.status || 400);
    if (!(file instanceof File)) return jsonError("PDF file is required.");
    if (file.type !== "application/pdf") return jsonError("Only PDF files are allowed.");
    if (file.size > MAX_PDF_SIZE_BYTES) return jsonError("PDF must be 10 MB or smaller.");
    if (!resolved.period) return jsonError("Load attendance before uploading a supporting PDF.", 404);
    if (!canMutateDateDocument(resolved.period, resolved.attendanceDate)) return jsonError("Supporting PDF can be changed only while this date is Draft or Sent Back.", 403);
    const historicalAccess = await getActiveHistoricalAttendanceAccess(access, { organizationId: resolved.organizationId, siteId: resolved.siteId, attendanceDate: resolved.attendanceDate, attendanceType: "labour" });
    const dateAccess = actorCanEditAttendanceDate(
      access,
      resolved.attendanceDate,
      text(formData.get("backdated_reason")),
      { reopened: dateStatus(resolved.period, resolved.attendanceDate) === "reopened", historicallyOpened: Boolean(historicalAccess) && dateStatus(resolved.period, resolved.attendanceDate) !== "reopened" },
    );
    if ("error" in dateAccess) return jsonError(dateAccess.error || "You cannot edit attendance for this date.", 403);
    if (!isGlobalOrSuperAdmin(access) && !(await hasActiveSiteHrAssignment(access.admin, { organizationId: resolved.organizationId, companyId: resolved.companyId, siteId: resolved.siteId, userId: access.auth.user.id }))) {
      return jsonError("You are not assigned as Site HR for this site.", 403);
    }
    const lockBlocker = await loadLabourEditLockBlocker(access, {
      organizationId: resolved.organizationId,
      companyId: resolved.companyId,
      siteId: resolved.siteId,
      contractorProfileId: null,
      attendanceDate: resolved.attendanceDate,
    });
    if (lockBlocker) return jsonError(lockBlocker, 403);

    const activeDocument = await loadActiveDocument(access, resolved.period.id, resolved.attendanceDate);
    const key = safeObjectKey([
      resolved.organizationId,
      resolved.siteId,
      "standard-attendance",
      resolved.attendanceDate,
      resolved.period.id,
      `${Date.now()}-${file.name}`,
    ]);
    const adapter = createPrivateStorageAdapter(access.admin);
    const object = await adapter.upload({ bucket: LABOUR_DOCUMENT_BUCKET, key, file, checksum: await checksum(file) });
    stored = { bucket: object.bucket, key: object.key };
    if (activeDocument) {
      const { error: deactivateError } = await access.admin
        .from("labour_attendance_date_documents")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", activeDocument.id);
      if (deactivateError) throw deactivateError;
      deactivatedDocumentId = activeDocument.id;
    }
    const insertPayload = {
      organization_id: resolved.organizationId,
      company_id: resolved.companyId,
      site_id: resolved.siteId,
      period_id: resolved.period.id,
      attendance_date: resolved.attendanceDate,
      storage_provider: object.provider,
      storage_bucket: object.bucket,
      storage_key: object.key,
      original_file_name: object.originalFileName,
      mime_type: object.mimeType,
      size_bytes: object.sizeBytes,
      checksum: object.checksum,
      is_active: true,
      ...actorFields(access.auth, "uploaded"),
    };
    const { data, error } = await access.admin.from("labour_attendance_date_documents").insert(insertPayload).select("*").single();
    if (error) throw error;
    replacementInserted = true;
    if (activeDocument) {
      const { error: replaceError } = await access.admin
        .from("labour_attendance_date_documents")
        .update({ replaced_by_document_id: data.id, updated_at: new Date().toISOString() })
        .eq("id", activeDocument.id);
      if (replaceError) throw replaceError;
      await adapter.delete({ bucket: activeDocument.storage_bucket, key: activeDocument.storage_key });
    }
    stored = null;
    await audit(access, request, {
      moduleCode: "labour_attendance",
      action: activeDocument ? "document_replace" : "document_upload",
      entityType: "labour_attendance_date_document",
      recordId: data.id,
      parentEntityType: "labour_attendance_period",
      parentRecordId: resolved.period.id,
      organizationId: resolved.organizationId,
      companyId: resolved.companyId,
      siteId: resolved.siteId,
      description: `${activeDocument ? "Replaced" : "Uploaded"} supporting PDF for labour attendance ${resolved.attendanceDate}.`,
      newValues: { attendance_date: resolved.attendanceDate, file_name: object.originalFileName },
    } as any);
    return NextResponse.json({ document: publicDocument(data) });
  } catch (error: any) {
    if (stored) {
      try {
        const access = await requireLabourPermission(request, "labour_attendance", "edit");
        if (!("response" in access)) await createPrivateStorageAdapter(access.admin).delete(stored);
      } catch {}
    }
    if (deactivatedDocumentId && !replacementInserted) {
      try {
        const access = await requireLabourPermission(request, "labour_attendance", "edit");
        if (!("response" in access)) {
          await access.admin
            .from("labour_attendance_date_documents")
            .update({ is_active: true, updated_at: new Date().toISOString() })
            .eq("id", deactivatedDocumentId);
        }
      } catch {}
    }
    return jsonError(error.message || "Failed to upload attendance supporting PDF.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_attendance", "edit");
    if ("response" in access) return access.response;
    const { searchParams } = new URL(request.url);
    const resolved = await resolveContext(access, {
      organizationId: text(searchParams.get("organization_id")),
      companyId: text(searchParams.get("company_id")),
      siteId: text(searchParams.get("site_id")),
      attendanceDate: text(searchParams.get("attendance_date")),
    });
    if ("error" in resolved) return jsonError(resolved.error || "Invalid attendance document request.", resolved.status || 400);
    if (!resolved.period) return jsonError("Attendance register not found.", 404);
    if (!canMutateDateDocument(resolved.period, resolved.attendanceDate)) return jsonError("Supporting PDF can be removed only while this date is Draft or Sent Back.", 403);
    const dateAccess = actorCanEditAttendanceDate(
      access,
      resolved.attendanceDate,
      text(searchParams.get("backdated_reason")),
      { reopened: dateStatus(resolved.period, resolved.attendanceDate) === "reopened" },
    );
    if ("error" in dateAccess) return jsonError(dateAccess.error || "You cannot edit attendance for this date.", 403);
    if (!isGlobalOrSuperAdmin(access) && !(await hasActiveSiteHrAssignment(access.admin, { organizationId: resolved.organizationId, companyId: resolved.companyId, siteId: resolved.siteId, userId: access.auth.user.id }))) {
      return jsonError("You are not assigned as Site HR for this site.", 403);
    }
    const lockBlocker = await loadLabourEditLockBlocker(access, {
      organizationId: resolved.organizationId,
      companyId: resolved.companyId,
      siteId: resolved.siteId,
      contractorProfileId: null,
      attendanceDate: resolved.attendanceDate,
    });
    if (lockBlocker) return jsonError(lockBlocker, 403);
    const document = await loadActiveDocument(access, resolved.period.id, resolved.attendanceDate);
    if (!document) return jsonError("Supporting PDF not found.", 404);
    await createPrivateStorageAdapter(access.admin).delete({ bucket: document.storage_bucket, key: document.storage_key });
    const { error } = await access.admin
      .from("labour_attendance_date_documents")
      .update({
        is_active: false,
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_by: access.auth.user.id,
        deleted_by_name: access.auth.user.user_metadata?.full_name || access.auth.user.user_metadata?.name || access.auth.user.email || "Unknown User",
        deleted_by_email: access.auth.user.email || null,
      })
      .eq("id", document.id);
    if (error) throw error;
    await audit(access, request, {
      moduleCode: "labour_attendance",
      action: "document_delete",
      entityType: "labour_attendance_date_document",
      recordId: document.id,
      parentEntityType: "labour_attendance_period",
      parentRecordId: resolved.period.id,
      organizationId: resolved.organizationId,
      companyId: resolved.companyId,
      siteId: resolved.siteId,
      description: `Removed supporting PDF for labour attendance ${resolved.attendanceDate}.`,
      oldValues: { attendance_date: resolved.attendanceDate, file_name: document.original_file_name },
    } as any);
    return NextResponse.json({ deleted: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to remove attendance supporting PDF.", 500);
  }
}
