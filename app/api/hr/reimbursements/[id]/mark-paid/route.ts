import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/serverPermissions";
import {
  adminClient,
  insertStatusHistory,
  isInOrganizationScope,
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
    const auth = await requirePermission(request, MODULE_CODE, "mark_paid");
    if ("response" in auth) return auth.response;

    const { id } = await context.params;
    const payload = await request.json().catch(() => ({}));
    const paymentId = String(payload.payment_id || "").trim() || null;
    const admin = adminClient();
    const result = await loadClaimForAccess(admin, auth, id);

    if ("error" in result) {
      return jsonError(result.error || "You do not have access to this reimbursement claim.", result.status || 403);
    }

    const { claim, organizationScope } = result;
    if (normalizeStatus(claim.status) !== "approved") {
      return jsonError("Only approved reimbursement claims can be marked paid.", 409);
    }

    if (paymentId) {
      const { data: payment, error: paymentError } = await admin
        .from("payments")
        .select("id, organization_id")
        .eq("id", paymentId)
        .maybeSingle();

      if (paymentError) throw paymentError;

      if (!payment) {
        return jsonError("Payment was not found.", 404);
      }

      if (
        payment.organization_id !== claim.organization_id ||
        !isInOrganizationScope(organizationScope, payment.organization_id)
      ) {
        return jsonError("Payment is not available for this organization.", 403);
      }
    }

    const { data, error } = await admin
      .from("reimbursement_claims")
      .update({
        status: "paid",
        approval_status: "paid",
        payment_id: paymentId,
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
      toStatus: "paid",
      action: "marked_paid",
      remarks: paymentId ? `payment_id:${paymentId}` : null,
    });

    return NextResponse.json({ reimbursement: withComputedAmounts(data) });
  } catch (error: any) {
    return jsonError(error.message || "Failed to mark reimbursement paid.", 500);
  }
}
