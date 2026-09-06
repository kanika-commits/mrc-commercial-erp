import { NextResponse } from "next/server";
import { adminClient, jsonError, requireProcurementAny, requireProcurementPermission, text } from "@/lib/serverProcurementAccess";
import { safeObjectKey } from "@/lib/storage/privateStorage";

const MODULE = "procurement_purchase_orders";
const BUCKET = "procurement-po-template-documents";
const MAX_BYTES = 20 * 1024 * 1024;
const MIMES = new Set(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);

export async function POST(request: Request) {
  try {
    const access = await requireProcurementAny(request, [{ moduleCode: MODULE, actionCode: "add" }, { moduleCode: MODULE, actionCode: "edit" }]);
    if ("response" in access) return access.response;
    const admin = adminClient();
    const body = await request.json().catch(() => ({}));
    const organizationId = text(body.organization_id);
    const companyId = text(body.company_id);
    const filename = text(body.filename);
    const mimeType = text(body.mime_type);
    const sizeBytes = Number(body.size_bytes || 0);
    if (!organizationId || !companyId || !filename || !MIMES.has(mimeType) || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_BYTES) return jsonError("A PDF or DOCX template source file up to 20 MB is required.", 400);
    if (!access.isGlobalAccess && !(access.organizations || []).includes(organizationId)) return jsonError("Template source is outside your organization access.", 403);
    if ((access.companies as string[] || []).length > 0 && !(access.companies as string[]).includes(companyId)) return jsonError("Selected company is outside your access.", 403);
    const company = await admin.from("companies").select("id,organization_id,status").eq("id", companyId).maybeSingle();
    if (company.error) throw company.error;
    if (!company.data || company.data.organization_id !== organizationId || company.data.status !== "active") return jsonError("Selected company is invalid or inactive.", 400);
    const path = safeObjectKey([organizationId, "pending", crypto.randomUUID(), filename]);
    const signed = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (signed.error) throw signed.error;
    return NextResponse.json({ bucket: BUCKET, path, token: signed.data?.token, signed_url: signed.data?.signedUrl });
  } catch (error: any) { return jsonError(error.message || "Could not prepare the template source upload.", 500); }
}

export async function GET(request: Request) {
  try {
    const access = await requireProcurementPermission(request, MODULE, "view");
    if ("response" in access) return access.response;
    const admin = adminClient();
    const versionId = text(new URL(request.url).searchParams.get("version_id"));
    if (!versionId) return jsonError("Template version is required.", 400);
    const version = await admin.from("procurement_purchase_order_template_versions").select("source_storage_bucket,source_storage_path,template:procurement_purchase_order_templates!inner(organization_id)").eq("id", versionId).maybeSingle();
    if (version.error) throw version.error;
    const organizationId = version.data?.template?.[0]?.organization_id;
    if (!version.data || !organizationId || (!access.isGlobalAccess && !(access.organizations || []).includes(organizationId))) return jsonError("Template source was not found.", 404);
    if (!version.data.source_storage_bucket || !version.data.source_storage_path) return jsonError("This template has no source file.", 404);
    const signed = await admin.storage.from(version.data.source_storage_bucket).createSignedUrl(version.data.source_storage_path, 600);
    if (signed.error) throw signed.error;
    return NextResponse.json({ signed_url: signed.data.signedUrl });
  } catch (error: any) { return jsonError(error.message || "Could not open the template source.", 500); }
}
