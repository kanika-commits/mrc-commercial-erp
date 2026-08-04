import { NextResponse } from "next/server";
import crypto from "node:crypto";
import sharp from "sharp";
import { createPrivateStorageAdapter, safeObjectKey } from "@/lib/storage/privateStorage";
import { actorFields, audit, jsonError, LABOUR_DOCUMENT_BUCKET, loadLabourEditLockBlocker, requireLabourPermission } from "@/app/api/labour/_shared";
import { normalizeText } from "@/lib/labour/constants";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";

const PHOTO_TYPES = ["normal_work", "work_before", "work_after", "overtime_start", "overtime_completion", "other_evidence"] as const;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

function isPhotoType(value: unknown): value is (typeof PHOTO_TYPES)[number] {
  return PHOTO_TYPES.includes(String(value || "") as any);
}

async function checksum(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function escapeSvg(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatEvidenceDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00+05:30`);
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function formatEvidenceDateTime(value?: string | null) {
  const date = value ? new Date(value) : new Date();
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(date);
}

async function createWatermarkedEvidence(input: {
  file: File;
  context: any;
  capturedAt?: string | null;
}) {
  const buffer = Buffer.from(await input.file.arrayBuffer());
  const image = sharp(buffer).rotate();
  const metadata = await image.metadata();
  const width = Math.max(Number(metadata.width || 1200), 1);
  const height = Math.max(Number(metadata.height || 800), 1);
  const watermarkHeight = Math.min(Math.max(Math.round(height * 0.18), 132), 220);
  const fontSize = Math.max(Math.round(width * 0.026), 22);
  const lines = [
    `${formatEvidenceDate(input.context.work_date)} · ${formatEvidenceDateTime(input.capturedAt)}`,
    input.context.site_name || "Site not recorded",
    input.context.contractor_name || "Contractor not recorded",
    `Engineer: ${input.context.assigned_engineer_name || "Not assigned"}`,
  ];
  const svg = `
    <svg width="${width}" height="${watermarkHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="rgba(15, 23, 42, 0.72)" />
      ${lines.map((line, index) => `<text x="28" y="${38 + index * (fontSize + 8)}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="${index === 0 ? 700 : 600}" fill="#fff">${escapeSvg(line)}</text>`).join("")}
    </svg>`;
  return image
    .composite([{ input: Buffer.from(svg), left: 0, top: Math.max(height - watermarkHeight, 0) }])
    .jpeg({ quality: 88 })
    .toBuffer();
}

async function loadReferencedEntity(access: any, referenceType: string, referenceId: string) {
  if (referenceType === "work_log") {
    const { data, error } = await access.admin
      .from("labour_daily_work_logs")
      .select("*, companies(company_name), sites(site_name), labour_contractor_profiles(id, contractor_code, vendors(vendor_name))")
      .eq("id", referenceId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const { data: assignment, error: assignmentError } = await access.admin
      .from("labour_daily_work_engineer_assignments")
      .select("engineer_user_id, profiles(id, email, full_name)")
      .eq("organization_id", data.organization_id)
      .eq("company_id", data.company_id)
      .eq("site_id", data.site_id)
      .eq("work_date", data.work_date)
      .eq("contractor_profile_id", data.contractor_profile_id)
      .eq("status", "active")
      .maybeSingle();
    if (assignmentError) throw assignmentError;
    const profile = Array.isArray(assignment?.profiles) ? assignment.profiles[0] : assignment?.profiles;
    const contractor = Array.isArray(data.labour_contractor_profiles) ? data.labour_contractor_profiles[0] : data.labour_contractor_profiles;
    return {
      entity: data,
      organization_id: data.organization_id,
      company_id: data.company_id,
      site_id: data.site_id,
      work_date: data.work_date,
      company_name: data.companies?.company_name,
      site_name: data.sites?.site_name,
      contractor_profile_id: data.contractor_profile_id,
      contractor_name: contractor?.vendors?.vendor_name || contractor?.contractor_code || null,
      assigned_engineer_user_id: assignment?.engineer_user_id || null,
      assigned_engineer_name: profile?.full_name || profile?.email || null,
      assigned_engineer_email: profile?.email || null,
      work_log_id: data.id,
      work_group_id: data.work_group_id,
      overtime_request_id: null,
      locked: data.status === "locked",
      allowedPhotoTypes: ["work_before", "work_after", "normal_work", "other_evidence"],
    };
  }
  if (referenceType === "overtime") {
    const { data, error } = await access.admin
      .from("labour_overtime_requests")
      .select("*, labour_attendance(attendance_date), sites(site_name)")
      .eq("id", referenceId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      entity: data,
      organization_id: data.organization_id,
      company_id: data.company_id,
      site_id: data.site_id,
      work_date: data.labour_attendance?.attendance_date || null,
      site_name: data.sites?.site_name,
      work_log_id: data.work_log_id,
      work_group_id: data.work_group_id,
      overtime_request_id: data.id,
      locked: data.status === "locked",
      allowedPhotoTypes: ["overtime_start", "overtime_completion", "other_evidence"],
    };
  }
  if (referenceType === "attendance") {
    const { data, error } = await access.admin
      .from("labour_attendance")
      .select("*, sites(site_name)")
      .eq("id", referenceId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      entity: data,
      organization_id: data.organization_id,
      company_id: data.company_id,
      site_id: data.site_id,
      work_date: data.attendance_date,
      site_name: data.sites?.site_name,
      work_log_id: null,
      work_group_id: null,
      overtime_request_id: null,
      locked: false,
      allowedPhotoTypes: ["overtime_start", "overtime_completion"],
    };
  }
  if (referenceType === "work_group") {
    const { data, error } = await access.admin
      .from("labour_work_groups")
      .select("*, sites(site_name)")
      .eq("id", referenceId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      entity: data,
      organization_id: data.organization_id,
      company_id: data.company_id,
      site_id: data.site_id,
      work_date: data.work_date,
      site_name: data.sites?.site_name,
      work_log_id: null,
      work_group_id: data.id,
      overtime_request_id: null,
      locked: data.status === "locked",
      allowedPhotoTypes: ["normal_work", "other_evidence"],
    };
  }
  return null;
}

function isScoped(access: any, entity: any) {
  if (!entity) return false;
  if (access.organizationScope !== null && !access.organizationScope.includes(entity.organization_id)) return false;
  if (access.assignments.companyIds?.length && !access.assignments.companyIds.includes(entity.company_id)) return false;
  if (access.assignments.siteIds?.length && !access.assignments.siteIds.includes(entity.site_id)) return false;
  if (access.assignments.companyIds && access.assignments.siteIds && !access.assignments.companyIds.length && !access.assignments.siteIds.length) return false;
  return true;
}

export async function GET(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_photo_evidence", "view");
    if ("response" in access) return access.response;
    const { searchParams } = new URL(request.url);
    const referenceType = text(searchParams.get("reference_type"));
    const referenceId = text(searchParams.get("reference_id"));
    let query = access.admin
      .from("labour_photo_evidence")
      .select("id, organization_id, company_id, site_id, work_date, reference_type, reference_id, work_group_id, work_log_id, overtime_request_id, photo_type, version, is_active, original_file_name, mime_type, size_bytes, checksum, server_received_at, captured_at, captured_by, captured_by_name, captured_by_email, capture_source, uploaded_by_name, uploaded_by_email, remarks, replacement_reason")
      .order("server_received_at", { ascending: false });
    const scoped = applyOrganizationScope(query, access.organizationScope);
    if (!scoped) return NextResponse.json({ photos: [] });
    query = scoped;
    if (referenceType) query = query.eq("reference_type", referenceType);
    if (referenceId) query = query.eq("reference_id", referenceId);
    const { data, error } = await query;
    if (error) throw error;
    const photos = (data || []).filter((photo: any) => isScoped(access, photo));
    return NextResponse.json({ photos });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load photo evidence.", 500);
  }
}

export async function POST(request: Request) {
  let stored: { bucket: string; key: string } | null = null;
  let storedWatermarked: { bucket: string; key: string } | null = null;
  try {
    const formData = await request.formData();
    const replacePhotoId = text(formData.get("replace_photo_id"));
    const access = await requireLabourPermission(request, "labour_photo_evidence", replacePhotoId ? "edit" : "upload");
    if ("response" in access) return access.response;
    const file = formData.get("file");
    const referenceType = text(formData.get("reference_type"));
    const referenceId = text(formData.get("reference_id"));
    const photoType = text(formData.get("photo_type"));
    const replacementReason = text(formData.get("replacement_reason"));
    const captureSource = text(formData.get("capture_source"));
    const capturedAt = text(formData.get("captured_at"));
    if (!(file instanceof File)) return jsonError("Photo file is required.");
    if (!IMAGE_TYPES.includes(file.type)) return jsonError("Only JPG, PNG or WEBP photos are allowed.");
    if (file.size > 5 * 1024 * 1024) return jsonError("Photo must be 5 MB or smaller.");
    if (!referenceType || !referenceId) return jsonError("Photo reference is required.");
    if (!isPhotoType(photoType)) return jsonError("Valid photo type is required.");
    if (replacePhotoId && !replacementReason) return jsonError("Replacement reason is required.");

    const ref = await loadReferencedEntity(access, referenceType, referenceId);
    if (!ref || !isScoped(access, ref)) return jsonError("Referenced labour record not found.", 404);
    if (ref.locked) return jsonError("Locked evidence cannot be changed.", 403);
    if (ref.work_date && ref.company_id && ref.site_id) {
      const lockBlocker = await loadLabourEditLockBlocker(access, { organizationId: ref.organization_id, companyId: ref.company_id, siteId: ref.site_id, attendanceDate: ref.work_date });
      if (lockBlocker) return jsonError(lockBlocker, 403);
    }
    if (!ref.allowedPhotoTypes.includes(photoType)) return jsonError("Photo type is not valid for this record.");
    if (referenceType === "work_log" && ["work_before", "work_after"].includes(photoType)) {
      if (captureSource !== "constructiq_camera_v1") return jsonError("Camera capture is required for verified work evidence on this device.");
      if (!capturedAt || Number.isNaN(Date.parse(capturedAt))) return jsonError("Valid camera capture time is required.");
    }

    let replacedPhoto: any = null;
    if (replacePhotoId) {
      const { data, error } = await access.admin.from("labour_photo_evidence").select("*").eq("id", replacePhotoId).eq("reference_type", referenceType).eq("reference_id", referenceId).maybeSingle();
      if (error) throw error;
      if (!data || !isScoped(access, data)) return jsonError("Photo evidence not found.", 404);
      if (!data.is_active) return jsonError("Only the active photo version can be replaced.");
      replacedPhoto = data;
    }

    const fileChecksum = await checksum(file);
    const { data: duplicates, error: duplicateError } = await access.admin
      .from("labour_photo_evidence")
      .select("id, work_date, site_id, reference_type, reference_id")
      .eq("checksum", fileChecksum)
      .neq("reference_id", referenceId)
      .limit(5);
    if (duplicateError) throw duplicateError;
    const duplicateWarning = (duplicates || []).some((photo: any) => isScoped(access, photo))
      ? "Identical photo checksum has been used on another labour evidence record."
      : null;

    const adapter = createPrivateStorageAdapter(access.admin);
    const key = safeObjectKey([ref.organization_id, ref.site_id, ref.work_date, referenceType, referenceId, photoType, `${Date.now()}-${file.name}`]);
    const object = await adapter.upload({ bucket: LABOUR_DOCUMENT_BUCKET, key, file, checksum: fileChecksum });
    stored = { bucket: object.bucket, key: object.key };
    let watermarkedObject: { bucket: string; key: string; mimeType: string; sizeBytes: number; checksum: string } | null = null;
    const { data: activeRows, error: activeError } = await access.admin
      .from("labour_photo_evidence")
      .select("id, version")
      .eq("reference_type", referenceType)
      .eq("reference_id", referenceId)
      .eq("photo_type", photoType)
      .eq("is_active", true);
    if (activeError) throw activeError;
    const nextVersion = Math.max(0, ...(activeRows || []).map((row: any) => Number(row.version || 0))) + 1;
    const serverReceivedAt = new Date().toISOString();
    const evidenceContext = referenceType === "work_log" ? {
      server_received_at: serverReceivedAt,
      work_date: ref.work_date,
      company_id: ref.company_id,
      company_name: ref.company_name || null,
      site_id: ref.site_id,
      site_name: ref.site_name || null,
      contractor_profile_id: ref.contractor_profile_id || null,
      contractor_name: ref.contractor_name || null,
      assigned_engineer_user_id: ref.assigned_engineer_user_id || null,
      assigned_engineer_name: ref.assigned_engineer_name || null,
      assigned_engineer_email: ref.assigned_engineer_email || null,
      work_log_id: ref.work_log_id,
    } : null;
    if (evidenceContext && captureSource === "constructiq_camera_v1") {
      const watermarkedBuffer = await createWatermarkedEvidence({ file, context: evidenceContext, capturedAt });
      const watermarkedChecksum = crypto.createHash("sha256").update(watermarkedBuffer).digest("hex");
      const watermarkedKey = safeObjectKey([ref.organization_id, ref.site_id, ref.work_date, referenceType, referenceId, photoType, `${Date.now()}-watermarked.jpg`]);
      const { error: watermarkedUploadError } = await access.admin.storage
        .from(LABOUR_DOCUMENT_BUCKET)
        .upload(watermarkedKey, watermarkedBuffer, { contentType: "image/jpeg", upsert: false });
      if (watermarkedUploadError) throw watermarkedUploadError;
      watermarkedObject = {
        bucket: LABOUR_DOCUMENT_BUCKET,
        key: watermarkedKey,
        mimeType: "image/jpeg",
        sizeBytes: watermarkedBuffer.length,
        checksum: watermarkedChecksum,
      };
      storedWatermarked = { bucket: LABOUR_DOCUMENT_BUCKET, key: watermarkedKey };
    }
    const insertPayload = {
      organization_id: ref.organization_id,
      company_id: ref.company_id,
      site_id: ref.site_id,
      work_date: ref.work_date,
      evidence_date: ref.work_date,
      reference_type: referenceType,
      reference_id: referenceId,
      work_group_id: ref.work_group_id,
      work_log_id: ref.work_log_id,
      overtime_request_id: ref.overtime_request_id,
      photo_type: photoType,
      version: nextVersion,
      is_active: true,
      replaced_by_photo_id: null,
      storage_provider: object.provider,
      storage_bucket: object.bucket,
      storage_key: object.key,
      original_file_name: object.originalFileName,
      mime_type: object.mimeType,
      size_bytes: object.sizeBytes,
      checksum: object.checksum,
      server_received_at: serverReceivedAt,
      captured_at: capturedAt || null,
      captured_by: ["work_before", "work_after"].includes(photoType) ? access.auth.user.id : null,
      captured_by_name: ["work_before", "work_after"].includes(photoType) ? (access.auth.user.user_metadata?.full_name || access.auth.user.user_metadata?.name || access.auth.user.email || "Unknown User") : null,
      captured_by_email: ["work_before", "work_after"].includes(photoType) ? (access.auth.user.email || null) : null,
      capture_source: captureSource || null,
      verification_metadata: evidenceContext
        ? {
            flow: captureSource || "upload",
            original_preserved: true,
            original_storage_key: object.key,
            watermark_generated: Boolean(watermarkedObject),
            watermarked_storage_key: watermarkedObject?.key || null,
            watermarked_mime_type: watermarkedObject?.mimeType || null,
            watermarked_size_bytes: watermarkedObject?.sizeBytes || null,
            watermarked_checksum: watermarkedObject?.checksum || null,
            evidence_context: evidenceContext,
          }
        : ["work_before", "work_after"].includes(photoType) ? { flow: "constructiq_camera_v1", stamped: true } : null,
      remarks: text(formData.get("remarks")),
      replacement_reason: replacementReason,
      ...actorFields(access.auth, "uploaded"),
    };
    const { data: inserted, error: insertError } = await access.admin.from("labour_photo_evidence").insert(insertPayload).select("id").single();
    if (insertError) throw insertError;
    storedWatermarked = null;
    const rowsToDeactivate = replacePhotoId ? [replacePhotoId] : (activeRows || []).map((row: any) => row.id);
    if (rowsToDeactivate.length) {
      const { error: deactivateError } = await access.admin
        .from("labour_photo_evidence")
        .update({ is_active: false, replaced_by_photo_id: inserted.id })
        .in("id", rowsToDeactivate);
      if (deactivateError) throw deactivateError;
    }
    stored = null;
    await audit(access, request, {
      moduleCode: "labour_photo_evidence",
      action: replacePhotoId ? "update" : "create",
      entityType: "labour_photo_evidence",
      recordId: inserted.id,
      parentEntityType: referenceType,
      parentRecordId: referenceId,
      organizationId: ref.organization_id,
      companyId: ref.company_id,
      siteId: ref.site_id,
      description: duplicateWarning ? `Uploaded ${photoType} with duplicate checksum warning.` : `Uploaded ${photoType}.`,
      oldValues: replacedPhoto ? { id: replacedPhoto.id, version: replacedPhoto.version, reason: replacementReason } : null,
      newValues: { ...insertPayload, duplicate_warning: duplicateWarning },
    } as any);
    return NextResponse.json({ photo_id: inserted.id, warning: duplicateWarning });
  } catch (error: any) {
    if (stored) {
      try {
        const access = await requireLabourPermission(request, "labour_photo_evidence", "upload");
        if (!("response" in access)) await createPrivateStorageAdapter(access.admin).delete(stored);
      } catch {}
    }
    if (storedWatermarked) {
      try {
        const access = await requireLabourPermission(request, "labour_photo_evidence", "upload");
        if (!("response" in access)) await createPrivateStorageAdapter(access.admin).delete(storedWatermarked);
      } catch {}
    }
    return jsonError(error.message || "Failed to upload photo evidence.", 500);
  }
}
