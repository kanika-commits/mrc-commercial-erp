import { NextResponse } from "next/server";
import { createPrivateStorageAdapter } from "@/lib/storage/privateStorage";
import { audit, jsonError, loadLabourEditLockBlocker, requireLabourPermission } from "@/app/api/labour/_shared";
import { normalizeText } from "@/lib/labour/constants";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

function isScoped(access: any, photo: any) {
  if (!photo) return false;
  if (access.organizationScope !== null && !access.organizationScope.includes(photo.organization_id)) return false;
  if (access.assignments.companyIds?.length && !access.assignments.companyIds.includes(photo.company_id)) return false;
  if (access.assignments.siteIds?.length && !access.assignments.siteIds.includes(photo.site_id)) return false;
  if (access.assignments.companyIds && access.assignments.siteIds && !access.assignments.companyIds.length && !access.assignments.siteIds.length) return false;
  return true;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, "labour_photo_evidence", "view");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const { data: photo, error } = await access.admin.from("labour_photo_evidence").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!isScoped(access, photo)) return jsonError("Photo evidence not found.", 404);
    const watermarkedKey = photo.verification_metadata?.watermarked_storage_key || photo.verification_metadata?.watermarked?.storage_key || null;
    const url = await createPrivateStorageAdapter(access.admin).createSignedReadUrl({ bucket: photo.storage_bucket, key: watermarkedKey || photo.storage_key });
    return NextResponse.json({ url, photo: { id: photo.id, photo_type: photo.photo_type, version: photo.version, server_received_at: photo.server_received_at, uploaded_by_name: photo.uploaded_by_name, uploaded_by_email: photo.uploaded_by_email, work_date: photo.work_date } });
  } catch (error: any) {
    return jsonError(error.message || "Failed to open photo evidence.", 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, "labour_photo_evidence", "delete");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const reason = text(new URL(request.url).searchParams.get("reason"));
    const { data: photo, error } = await access.admin.from("labour_photo_evidence").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!isScoped(access, photo)) return jsonError("Photo evidence not found.", 404);
    const { data: lockedWorkLog, error: workLogError } = photo.reference_type === "work_log"
      ? await access.admin.from("labour_daily_work_logs").select("status").eq("id", photo.reference_id).maybeSingle()
      : { data: null, error: null };
    if (workLogError) throw workLogError;
    const { data: lockedOt, error: otError } = photo.reference_type === "overtime"
      ? await access.admin.from("labour_overtime_requests").select("status").eq("id", photo.reference_id).maybeSingle()
      : { data: null, error: null };
    if (otError) throw otError;
    if (lockedWorkLog?.status === "locked" || lockedOt?.status === "locked") return jsonError("Locked evidence cannot be deleted.", 403);
    if (photo.work_date && photo.company_id && photo.site_id) {
      const lockBlocker = await loadLabourEditLockBlocker(access, { organizationId: photo.organization_id, companyId: photo.company_id, siteId: photo.site_id, attendanceDate: photo.work_date });
      if (lockBlocker) return jsonError(lockBlocker, 403);
    }

    const { error: deleteError } = await access.admin.from("labour_photo_evidence").delete().eq("id", id);
    if (deleteError) throw deleteError;
    try {
      await createPrivateStorageAdapter(access.admin).delete({ bucket: photo.storage_bucket, key: photo.storage_key });
    } catch {}
    await audit(access, request, {
      moduleCode: "labour_photo_evidence",
      action: "delete",
      entityType: "labour_photo_evidence",
      recordId: id,
      parentEntityType: photo.reference_type,
      parentRecordId: photo.reference_id,
      organizationId: photo.organization_id,
      companyId: photo.company_id,
      siteId: photo.site_id,
      description: "Deleted labour photo evidence.",
      oldValues: { photo_type: photo.photo_type, version: photo.version, reason },
    } as any);
    return NextResponse.json({ deleted: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to delete photo evidence.", 500);
  }
}
