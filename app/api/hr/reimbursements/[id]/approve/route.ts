import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/serverPermissions";
import { syncApprovedReimbursementToDrive } from "../../_driveSync";
import {
  adminClient,
  amountValue,
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
    const auth = await requirePermission(request, MODULE_CODE, "approve");
    if ("response" in auth) return auth.response;

    const { id } = await context.params;
    const payload = await request.json().catch(() => ({}));
    const admin = adminClient();
    const result = await loadClaimForAccess(admin, auth, id);

    if ("error" in result) {
      return jsonError(result.error || "You do not have access to this reimbursement claim.", result.status || 403);
    }

    const { claim } = result;
    if (normalizeStatus(claim.status) !== "pending") {
      return jsonError("Only pending reimbursement claims can be approved.", 409);
    }

    if (claim.created_by && claim.created_by === auth.user.id) {
      return jsonError("Self-approval is not allowed.", 403);
    }

    const approvedAmount =
      payload.approved_amount === undefined || payload.approved_amount === null
        ? amountValue(claim.total_amount)
        : amountValue(payload.approved_amount);

    if (approvedAmount <= 0) {
      return jsonError("Approved amount must be greater than 0.", 400);
    }

    const { data, error } = await admin
      .from("reimbursement_claims")
      .update({
        approved_amount: approvedAmount,
        status: "approved",
        approval_status: "approved",
        approved_by: auth.user.id,
        approved_by_name: userName(auth),
        approved_by_email: auth.user.email || null,
        approved_at: new Date().toISOString(),
        rejected_by: null,
        rejected_by_name: null,
        rejected_by_email: null,
        rejected_at: null,
        rejection_reason: null,
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
      toStatus: "approved",
      action: "approved",
      remarks: null,
    });

    await syncApprovedReimbursementToDrive(admin, data);

    return NextResponse.json({ reimbursement: withComputedAmounts(data) });
  } catch (error: any) {
    return jsonError(error.message || "Failed to approve reimbursement.", 500);
  }
}
