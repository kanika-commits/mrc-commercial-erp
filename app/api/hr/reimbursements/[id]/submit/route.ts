import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/serverPermissions";
import {
  adminClient,
  insertStatusHistory,
  isEditableClaim,
  jsonError,
  loadClaimForAccess,
  MODULE_CODE,
  userName,
  withComputedAmounts,
} from "../../_shared";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission(request, MODULE_CODE, "submit");
    if ("response" in auth) return auth.response;

    const { id } = await context.params;
    const admin = adminClient();
    const result = await loadClaimForAccess(admin, auth, id);

    if ("error" in result) {
      return jsonError(result.error || "You do not have access to this reimbursement claim.", result.status || 403);
    }

    const { claim } = result;
    if (!isEditableClaim(claim)) {
      return jsonError("Only draft or rejected reimbursement claims can be submitted.", 409);
    }

    const { data, error } = await admin
      .from("reimbursement_claims")
      .update({
        status: "pending",
        approval_status: "pending",
        submitted_at: new Date().toISOString(),
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
      toStatus: "pending",
      action: "submitted",
      remarks: null,
    });

    return NextResponse.json({ reimbursement: withComputedAmounts(data) });
  } catch (error: any) {
    return jsonError(error.message || "Failed to submit reimbursement.", 500);
  }
}
