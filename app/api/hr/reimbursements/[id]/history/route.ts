import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/serverPermissions";
import {
  adminClient,
  jsonError,
  loadClaimForAccess,
  MODULE_CODE,
} from "../../_shared";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission(request, MODULE_CODE, "view");
    if ("response" in auth) return auth.response;

    const { id } = await context.params;
    const admin = adminClient();
    const claimResult = await loadClaimForAccess(admin, auth, id);

    if ("error" in claimResult) {
      return jsonError(claimResult.error || "You do not have access to this reimbursement claim.", claimResult.status || 403);
    }

    const { data, error } = await admin
      .from("reimbursement_status_history")
      .select("id, reimbursement_claim_id, from_status, to_status, action, remarks, changed_by, changed_by_name, changed_by_email, changed_at")
      .eq("reimbursement_claim_id", id)
      .order("changed_at", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ history: data || [] });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load reimbursement history.", 500);
  }
}
