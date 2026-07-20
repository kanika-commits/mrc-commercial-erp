import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/serverPermissions";
import {
  adminClient,
  insertStatusHistory,
  jsonError,
  loadClaimForAccess,
  MODULE_CODE,
  normalizeStatus,
  userName,
  withComputedAmounts,
} from "../../_shared";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission(request, MODULE_CODE, "reject");
    if ("response" in auth) return auth.response;

    const { id } = await context.params;
    const payload = await request.json().catch(() => ({}));
    const rejectionReason = String(payload.rejection_reason || payload.reason || "").trim();
    const admin = adminClient();
    const result = await loadClaimForAccess(admin, auth, id);

    if ("error" in result) {
      return jsonError(result.error || "You do not have access to this reimbursement claim.", result.status || 403);
    }

    const { claim } = result;
    if (normalizeStatus(claim.status) !== "pending") {
      return jsonError("Only pending reimbursement claims can be rejected.", 409);
    }

    if (rejectionReason.length < 10) {
      return jsonError("Rejection reason must be at least 10 characters.", 400);
    }

    const { data, error } = await admin
      .from("reimbursement_claims")
      .update({
        status: "rejected",
        approval_status: "rejected",
        rejected_by: auth.user.id,
        rejected_by_name: userName(auth),
        rejected_by_email: auth.user.email || null,
        rejected_at: new Date().toISOString(),
        rejection_reason: rejectionReason,
        updated_by: auth.user.id,
        updated_by_name: userName(auth),
        updated_by_email: auth.user.email || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;

    await insertStatusHistory(admin, auth, {
      organizationId: claim.organization_id,
      claimId: claim.id,
      fromStatus: claim.status,
      toStatus: "rejected",
      action: "rejected",
      remarks: rejectionReason,
    });

    return NextResponse.json({ reimbursement: withComputedAmounts(data) });
  } catch (error: any) {
    return jsonError(error.message || "Failed to reject reimbursement.", 500);
  }
}
