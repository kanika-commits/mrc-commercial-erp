import { after, NextResponse } from "next/server";
import { adminClient, applyCompanySiteAccess, applyOrganizationAccess, jsonError, requireProcurementPermission } from "@/lib/serverProcurementAccess";
import { approvalIsAtOrAfterArchiveFeatureEnable, archiveApprovedPo, ensureOfficialPoArtifact, readOfficialPoArchiveFeatureEnabledAt } from "@/lib/procurement/poOfficialArtifact.server";
import { renderApprovedPurchaseOrderBasePdf } from "@/lib/procurement/poPdfBaseGeneration.server";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const auth = await requireProcurementPermission(request, "procurement_purchase_orders", "approve");
    if ("response" in auth) return auth.response;
    const admin = adminClient();
    let query: any = applyOrganizationAccess(admin.from("procurement_purchase_orders").select("id,organization_id,status,approved_at").eq("id", id).maybeSingle(), auth);
    query = query && applyCompanySiteAccess(query, auth);
    if (!query) return jsonError("Purchase Order was not found.", 404);
    const { data: po, error } = await query;
    if (error) throw error;
    if (!po) return jsonError("Purchase Order was not found.", 404);
    if (!["approved", "issued"].includes(po.status)) return jsonError("Only approved or issued Purchase Orders can be archived.", 409);
    const { data: foundArtifacts, error: artifactError } = await admin.from("procurement_purchase_order_artifacts")
      .select("id,artifact_status").eq("organization_id", po.organization_id)
      .eq("purchase_order_id", po.id).eq("artifact_type", "official_po").eq("archive_origin", "approval").limit(2);
    if (artifactError) throw artifactError;
    if (foundArtifacts?.length > 1) return jsonError("Ambiguous normal official PDF archives exist for this Purchase Order.", 409);
    let artifact = foundArtifacts?.[0] || null;
    if (!artifact) {
      const featureEnabledAt = await readOfficialPoArchiveFeatureEnabledAt(admin);
      if (!approvalIsAtOrAfterArchiveFeatureEnable(po.approved_at, featureEnabledAt)) {
        return jsonError("No approval archive record exists for this legacy revision. Legacy approvals are not automatically backfilled.", 409);
      }
      artifact = await ensureOfficialPoArtifact(admin, {
        organizationId: po.organization_id,
        purchaseOrderId: po.id,
        generatedBy: auth.user.id,
        archiveOrigin: "reconstruction",
      });
    }
    if (!["pending", "failed"].includes(artifact.artifact_status)) return jsonError("Only pending or failed official PDF archives can be retried.", 409);

    after(async () => {
      try {
        await archiveApprovedPo(admin, {
          organizationId: po.organization_id,
          purchaseOrderId: po.id,
          generatedBy: auth.user.id,
          retry: true,
          render: () => renderApprovedPurchaseOrderBasePdf(admin, po.organization_id, po.id),
        });
      } catch (archiveError) {
        console.error("Official Purchase Order PDF archive retry failed", { purchaseOrderId: po.id, organizationId: po.organization_id, error: archiveError });
      }
    });
    return NextResponse.json({ accepted: true, artifact_status: artifact.artifact_status }, { status: 202 });
  } catch (error: any) {
    console.error("Could not queue official Purchase Order PDF archive retry", error);
    return jsonError(error.message || "Could not queue the official Purchase Order PDF archive retry.", 500);
  }
}
