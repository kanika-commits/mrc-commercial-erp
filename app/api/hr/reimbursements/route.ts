import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/serverPermissions";
import {
  adminClient,
  calculateTotalAmount,
  ensureEmployeeInScope,
  insertStatusHistory,
  jsonError,
  MODULE_CODE,
  scopedClaimsQuery,
  userName,
  withComputedAmounts,
} from "./_shared";

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, MODULE_CODE, "view");
    if ("response" in auth) return auth.response;

    const { searchParams } = new URL(request.url);
    const employeeId = clean(searchParams.get("employee_id"));
    const status = clean(searchParams.get("status")).toLowerCase();
    const approvalStatus = clean(searchParams.get("approval_status")).toLowerCase();
    const admin = adminClient();
    const { query } = await scopedClaimsQuery(admin, auth);

    if (!query) {
      return NextResponse.json({ reimbursements: [] });
    }

    let scopedQuery = query;
    if (employeeId) scopedQuery = scopedQuery.eq("employee_id", employeeId);
    if (status) scopedQuery = scopedQuery.eq("status", status);
    if (approvalStatus) scopedQuery = scopedQuery.eq("approval_status", approvalStatus);

    const { data, error } = await scopedQuery;
    if (error) throw error;

    return NextResponse.json({
      reimbursements: (data || []).map(withComputedAmounts),
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load reimbursements.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requirePermission(request, MODULE_CODE, "add");
    if ("response" in auth) return auth.response;

    const payload = await request.json().catch(() => ({}));
    const admin = adminClient();
    const employeeId = clean(payload.employee_id);
    const claimNumber = clean(payload.claim_number);
    const claimDate = clean(payload.claim_date);
    const claimType = clean(payload.claim_type) || null;
    const description = clean(payload.description) || null;
    const amount = Number(payload.amount || 0);
    const gstAmount = Number(payload.gst_amount || 0);
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
      .neq("status", "deleted")
      .limit(1)
      .maybeSingle();

    if (duplicateError) throw duplicateError;
    if (duplicate) {
      return jsonError("Claim number already exists for this organization.", 409);
    }

    const { data, error } = await admin
      .from("reimbursement_claims")
      .insert({
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
        approved_amount: null,
        status: "draft",
        approval_status: "draft",
        created_by: auth.user.id,
        created_by_name: userName(auth),
        created_by_email: auth.user.email || null,
      })
      .select("*")
      .single();

    if (error) throw error;

    await insertStatusHistory(admin, auth, {
      organizationId: data.organization_id,
      claimId: data.id,
      fromStatus: null,
      toStatus: "draft",
      action: "created",
      remarks: null,
    });

    return NextResponse.json({ reimbursement: withComputedAmounts(data) });
  } catch (error: any) {
    return jsonError(error.message || "Failed to create reimbursement.", 500);
  }
}
