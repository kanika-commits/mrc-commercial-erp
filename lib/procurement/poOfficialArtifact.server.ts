import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const OFFICIAL_PO_BUCKET = "procurement-rfq-quotation-documents";

export async function readOfficialPoArchiveFeatureEnabledAt(admin: SupabaseClient) {
  const { data, error } = await admin.from("procurement_purchase_order_artifact_archive_config")
    .select("feature_enabled_at").eq("singleton", true).single();
  if (error) throw error;
  if (!data?.feature_enabled_at || !Number.isFinite(Date.parse(data.feature_enabled_at))) {
    throw new Error("Official Purchase Order archive feature-enable timestamp is unavailable.");
  }
  return data.feature_enabled_at as string;
}

export function approvalIsAtOrAfterArchiveFeatureEnable(approvedAt: string | null | undefined, featureEnabledAt: string) {
  if (!approvedAt) return false;
  const approvalTime = Date.parse(approvedAt);
  const enabledTime = Date.parse(featureEnabledAt);
  return Number.isFinite(approvalTime) && Number.isFinite(enabledTime) && approvalTime >= enabledTime;
}

type ArtifactRow = {
  id: string;
  organization_id: string;
  purchase_order_id: string;
  artifact_status: string;
  archive_origin: string;
  storage_bucket: string;
  storage_key: string;
  sha256: string | null;
  size_bytes: number | null;
  attempt_token: string | null;
};

async function verifiedArtifact(admin: SupabaseClient, artifact: any, input: { organizationId: string; purchaseOrderId: string }) {
  if (!artifact || artifact.organization_id !== input.organizationId || artifact.purchase_order_id !== input.purchaseOrderId || artifact.artifact_type !== "official_po" || artifact.artifact_status !== "archived" || !artifact.sha256 || !artifact.size_bytes) throw new Error("Current official Purchase Order artifact failed ownership or integrity validation.");
  const downloaded = await admin.storage.from(artifact.storage_bucket).download(artifact.storage_key);
  if (downloaded.error || !downloaded.data) throw downloaded.error || new Error("Current official Purchase Order PDF is unavailable.");
  const bytes = Buffer.from(await downloaded.data.arrayBuffer());
  if (bytes.byteLength !== Number(artifact.size_bytes) || sha256(bytes) !== artifact.sha256) throw new Error("Current official Purchase Order PDF failed its integrity check.");
  return { bytes, pageCount: Number(artifact.page_count), footerRenderedHeight: Number(artifact.footer_rendered_height || 0), artifactId: artifact.id };
}

export async function resolveCurrentOfficialPoArtifact(admin: SupabaseClient, input: { organizationId: string; purchaseOrderId: string }) {
  const pointer = await admin.from("procurement_purchase_order_artifact_current").select("artifact_id").eq("organization_id", input.organizationId).eq("purchase_order_id", input.purchaseOrderId).maybeSingle();
  if (pointer.error) throw pointer.error;
  if (pointer.data) {
    const result = await admin.from("procurement_purchase_order_artifacts").select("*").eq("id", pointer.data.artifact_id).maybeSingle();
    if (result.error) throw result.error;
    return verifiedArtifact(admin, result.data, input);
  }
  const legacy = await admin.from("procurement_purchase_order_artifacts").select("*").eq("organization_id", input.organizationId).eq("purchase_order_id", input.purchaseOrderId).eq("artifact_type", "official_po").eq("artifact_status", "archived").eq("archive_origin", "approval").limit(2);
  if (legacy.error) throw legacy.error;
  if (!legacy.data?.length) return null;
  if (legacy.data.length !== 1) throw new Error("Ambiguous legacy official Purchase Order artifacts.");
  return verifiedArtifact(admin, legacy.data[0], input);
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function ensureOfficialPoArtifact(admin: SupabaseClient, input: {
  organizationId: string;
  purchaseOrderId: string;
  generatedBy: string | null;
  archiveOrigin?: "approval" | "reconstruction";
}) {
  const { data: existing, error: lookupError } = await admin
    .from("procurement_purchase_order_artifacts")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("purchase_order_id", input.purchaseOrderId)
    .eq("artifact_type", "official_po").eq("archive_origin", input.archiveOrigin || "approval").limit(2);
  if (lookupError) throw lookupError;
  if (existing?.length > 1) throw new Error("Ambiguous normal Purchase Order archive artifacts.");
  if (existing?.[0]) return existing[0] as ArtifactRow;

  const artifactId = randomUUID();
  const key = `${input.organizationId}/purchase-orders/${input.purchaseOrderId}/generated/${artifactId}/official-po.pdf`;
  const { data, error } = await admin.from("procurement_purchase_order_artifacts").insert({
    id: artifactId,
    organization_id: input.organizationId,
    purchase_order_id: input.purchaseOrderId,
    artifact_type: "official_po",
    artifact_status: "pending",
    archive_origin: input.archiveOrigin || "approval",
    storage_bucket: OFFICIAL_PO_BUCKET,
    storage_key: key,
    generated_by: input.generatedBy,
  }).select("*").single();
  if (!error) return data as ArtifactRow;
  // The approval transition trigger may have created the row concurrently.
  const concurrent = await admin.from("procurement_purchase_order_artifacts").select("*")
    .eq("organization_id", input.organizationId).eq("purchase_order_id", input.purchaseOrderId)
    .eq("artifact_type", "official_po").eq("archive_origin", input.archiveOrigin || "approval").limit(2);
  if (concurrent.error) throw concurrent.error;
  if (concurrent.data?.length === 1) return concurrent.data[0] as ArtifactRow;
  throw error;
}

export async function archiveApprovedPo(admin: SupabaseClient, input: {
  organizationId: string;
  purchaseOrderId: string;
  generatedBy: string | null;
  render: () => Promise<{ bytes: Buffer; pageCount: number; footerRenderedHeight: number }>;
  retry?: boolean;
}) {
  const artifact = input.retry
    ? await (async () => {
      const { data, error } = await admin.from("procurement_purchase_order_artifacts").select("*")
        .eq("organization_id", input.organizationId).eq("purchase_order_id", input.purchaseOrderId)
      .eq("artifact_type", "official_po").eq("archive_origin", "approval").limit(2);
      if (error) throw error;
      if (!data?.length) throw new Error("No approval archive record exists for this Purchase Order revision; legacy approvals are not auto-backfilled.");
      if (data.length > 1) throw new Error("Ambiguous approval archive records exist for this Purchase Order revision.");
      return data[0] as ArtifactRow;
    })()
    : await ensureOfficialPoArtifact(admin, input);
  if (artifact.artifact_status === "archived") return artifact;
  if (input.retry && !["pending", "failed"].includes(artifact.artifact_status)) {
    throw new Error("Only pending or failed official PO archives can be retried.");
  }

  const attemptToken = randomUUID();
  const claimQuery = admin.from("procurement_purchase_order_artifacts").update({
    artifact_status: "archiving",
    archive_origin: artifact.archive_origin,
    attempt_token: attemptToken,
    attempt_started_at: new Date().toISOString(),
    failure_message: null,
  }).eq("id", artifact.id).eq("organization_id", input.organizationId)
    .in("artifact_status", input.retry ? ["pending", "failed"] : ["pending", "failed"])
    .select("id").maybeSingle();
  const { data: claimed, error: claimError } = await claimQuery;
  if (claimError) throw claimError;
  if (!claimed) return artifact;

  try {
    if (artifact.sha256 && artifact.size_bytes) {
      const priorObject = await admin.storage.from(artifact.storage_bucket).download(artifact.storage_key);
      if (!priorObject.error && priorObject.data) {
        const priorBytes = Buffer.from(await priorObject.data.arrayBuffer());
        if (priorBytes.byteLength !== Number(artifact.size_bytes) || sha256(priorBytes) !== artifact.sha256) {
          throw new Error("An immutable object already exists at the archive key with different content.");
        }
        const { data: archived, error: archiveError } = await admin.from("procurement_purchase_order_artifacts").update({
          artifact_status: "archived",
          archived_at: new Date().toISOString(),
          attempt_token: null,
        }).eq("id", artifact.id).eq("attempt_token", attemptToken).select("*").single();
        if (archiveError) throw archiveError;
        return archived;
      }
      if (priorObject.error && String(priorObject.error.statusCode || "") !== "404" && !/not found|does not exist/i.test(priorObject.error.message || "")) throw priorObject.error;
    }

    const rendered = await input.render();
    const bytes = Buffer.from(rendered.bytes);
    const digest = sha256(bytes);
    const { error: metadataError } = await admin.from("procurement_purchase_order_artifacts").update({
      sha256: digest,
      size_bytes: bytes.byteLength,
      page_count: rendered.pageCount,
      footer_rendered_height: rendered.footerRenderedHeight,
      generated_at: new Date().toISOString(),
    }).eq("id", artifact.id).eq("attempt_token", attemptToken);
    if (metadataError) throw metadataError;

    const upload = await admin.storage.from(artifact.storage_bucket).upload(artifact.storage_key, bytes, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (upload.error) {
      // A prior interrupted attempt may have uploaded the immutable key. Adopt it
      // only when its bytes match the digest just recorded for this artifact.
      const existing = await admin.storage.from(artifact.storage_bucket).download(artifact.storage_key);
      if (existing.error || !existing.data) throw upload.error;
      const existingBytes = Buffer.from(await existing.data.arrayBuffer());
      if (existingBytes.byteLength !== bytes.byteLength || sha256(existingBytes) !== digest) {
        throw new Error("An immutable object already exists at the archive key with different content.");
      }
    }

    const verified = await admin.storage.from(artifact.storage_bucket).download(artifact.storage_key);
    if (verified.error || !verified.data) throw verified.error || new Error("Uploaded official PO PDF could not be verified.");
    const verifiedBytes = Buffer.from(await verified.data.arrayBuffer());
    if (verifiedBytes.byteLength !== bytes.byteLength || sha256(verifiedBytes) !== digest) {
      throw new Error("Uploaded official PO PDF failed its SHA-256 verification.");
    }
    const { data: archived, error: archiveError } = await admin.from("procurement_purchase_order_artifacts").update({
      artifact_status: "archived",
      archived_at: new Date().toISOString(),
      attempt_token: null,
    }).eq("id", artifact.id).eq("attempt_token", attemptToken).select("*").single();
    if (archiveError) throw archiveError;
    return archived;
  } catch (error: any) {
    const message = String(error?.message || "Official PO PDF archiving failed.").slice(0, 2000);
    const { error: markError } = await admin.from("procurement_purchase_order_artifacts").update({
      artifact_status: "failed",
      failure_message: message,
      attempt_token: null,
    }).eq("id", artifact.id).eq("attempt_token", attemptToken);
    if (markError) console.error("Failed to record official PO archive failure", { purchaseOrderId: input.purchaseOrderId, error: markError.message });
    throw error;
  }
}

export async function readVerifiedOfficialPo(admin: SupabaseClient, input: { organizationId: string; purchaseOrderId: string }) {
  return resolveCurrentOfficialPoArtifact(admin, input);
}
