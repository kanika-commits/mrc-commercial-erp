import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/serverPermissions";
import {
  adminClient,
  calculateTotalAmount,
  ensureEmployeeInScope,
  insertStatusHistory,
  isEditableClaim,
  jsonError,
  loadClaimForAccess,
  MODULE_CODE,
  normalizeStatus,
  userName,
  withComputedAmounts,
} from "../_shared";

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission(request, MODULE_CODE, "view");
    if ("response" in auth) return auth.response;

    const { id } = await context.params;
    const admin = adminClient();
    const result = await loadClaimForAccess(admin, auth, id);

    if ("error" in result) {
      return jsonError(result.error || "You do not have access to this reimbursement claim.", result.status || 403);
    }

    return NextResponse.json({ reimbursement: withComputedAmounts(result.claim) });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load reimbursement.", 500);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission(request, MODULE_CODE, "edit");
    if ("response" in auth) return auth.response;

    const { id } = await context.params;
    const payload = await request.json().catch(() => ({}));
    const admin = adminClient();
    const result = await loadClaimForAccess(admin, auth, id);

    if ("error" in result) {
      return jsonError(result.error || "You do not have access to this reimbursement claim.", result.status || 403);
    }

    const { claim } = result;
    if (!isEditableClaim(claim)) {
      return jsonError("Only draft or rejected reimbursement claims can be edited.", 409);
    }

    const employeeId = clean(payload.employee_id || claim.employee_id);
    const claimNumber = clean(payload.claim_number || claim.claim_number);
    const claimDate = clean(payload.claim_date || claim.claim_date);
    const claimType = clean(payload.claim_type) || null;
    const description = clean(payload.description) || null;
    const amount = Number(payload.amount ?? claim.amount ?? 0);
    const gstAmount = Number(payload.gst_amount ?? claim.gst_amount ?? 0);
    const totalAmount = calculateTotalAmount(amount, gstAmount);

    if (!employeeId) return jsonError("Employee is required.", 400);
    if (!claimNumber) return jsonError("Claim number is required.", 400);
    if (!claimDate) return jsonError("Claim date is required.", 400);
    if (!Number.isFinite(amount) || amount <= 0) {
      return jsonError("Claim amount must be greater than 0.", 400);
    }

    if (!Number.isFinite(gstAmount) || gstAmount < 0) {
      return jsonError("GST amount cannot be negative.", 400);
    }

    const employeeResult = await ensureEmployeeInScope(admin, auth, employeeId);
    if ("error" in employeeResult) {
      return jsonError(employeeResult.error || "Selected employee is not available.", employeeResult.status || 403);
    }

    const { employee } = employeeResult;
    const { data: duplicate, error: duplicateError } = await admin
      .from("reimbursement_claims")
      .select("id")
      .eq("organization_id", employee.organization_id)
      .ilike("claim_number", claimNumber)
      .neq("id", id)
      .neq("status", "deleted")
      .limit(1)
      .maybeSingle();

    if (duplicateError) throw duplicateError;
    if (duplicate) {
      return jsonError("Claim number already exists for this organization.", 409);
    }

    const previousStatus = normalizeStatus(claim.status);
    const nextStatus = previousStatus === "rejected" ? "draft" : "draft";
    const { data, error } = await admin
      .from("reimbursement_claims")
      .update({
        organization_id: employee.organization_id,
        company_id: employee.company_id,
        site_id: employee.site_id || null,
        employee_id: employee.id,
        claim_number: claimNumber,
        claim_date: claimDate,
        claim_type: claimType,
        description,
        amount,
        gst_amount: gstAmount,
        total_amount: totalAmount,
        status: nextStatus,
        approval_status: nextStatus,
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

    if (previousStatus !== nextStatus) {
      await insertStatusHistory(admin, auth, {
        organizationId: data.organization_id,
        claimId: data.id,
        fromStatus: claim.status,
        toStatus: nextStatus,
        action: "edited",
        remarks: "Rejected claim edited and moved back to draft.",
      });
    }

    return NextResponse.json({ reimbursement: withComputedAmounts(data) });
  } catch (error: any) {
    return jsonError(error.message || "Failed to update reimbursement.", 500);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission(request, MODULE_CODE, "delete");
    if ("response" in auth) return auth.response;

    const { id } = await context.params;
    const admin = adminClient();
    const result = await loadClaimForAccess(admin, auth, id);

    if ("error" in result) {
      return jsonError(result.error || "You do not have access to this reimbursement claim.", result.status || 403);
    }

    const { claim } = result;
    const status = normalizeStatus(claim.status);

    if (status === "approved" || status === "paid") {
      return jsonError("Approved or paid reimbursement claims cannot be deleted.", 409);
    }

    const { error } = await admin
      .from("reimbursement_claims")
      .update({
        status: "deleted",
        updated_by: auth.user.id,
        updated_by_name: userName(auth),
        updated_by_email: auth.user.email || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw error;

    await insertStatusHistory(admin, auth, {
      organizationId: claim.organization_id,
      claimId: claim.id,
      fromStatus: claim.status,
      toStatus: "deleted",
      action: "deleted",
      remarks: null,
    });

    return NextResponse.json({ deleted: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to delete reimbursement.", 500);
  }
}
