import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  insertDeleteAudit,
  requireDeletePermission,
} from "@/lib/serverDeleteAudit";
import { requirePermission } from "@/lib/serverPermissions";
import {
  isInOrganizationScope,
  loadActorOrganizationScope,
  loadOrganizationScopeForUser,
} from "@/lib/serverOrganizationScope";

const MODULE_CODE = "payments";
const DOCUMENT_BUCKET = "payment-documents";

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

async function requireUser(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const token = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    return { error: "Missing auth token.", status: 401 };
  }

  const authClient = createClient(supabaseUrl, anonKey);
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(token);

  if (error) throw error;

  if (!user) {
    return { error: "User not found.", status: 401 };
  }

  return { user };
}

function roundAmount(value: FormDataEntryValue | null) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount) : 0;
}

function normalized(value: string) {
  return value.trim().toLowerCase();
}

function duplicateErrorMessage(error: any) {
  const message = String(error?.message || "");
  const details = String(error?.details || "");
  const constraint = String(error?.constraint || "");
  const haystack = `${message} ${details} ${constraint}`.toLowerCase();

  if (
    error?.code === "23505" &&
    haystack.includes("payments_unique_number_per_org")
  ) {
    return "Payment number already exists.";
  }

  if (
    error?.code === "23505" &&
    haystack.includes("payments_unique_utr_per_org_when_present")
  ) {
    return "UTR number already exists.";
  }

  return "";
}

function isBankTransferMode(mode: string) {
  return ["bank transfer", "neft", "rtgs", "imps", "upi"].includes(
    mode.trim().toLowerCase()
  );
}

async function readDeletionReason(request: Request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    return String(body.deletion_reason || body.deletionReason || "").trim();
  }

  if (
    contentType.includes("multipart/form-data") ||
    contentType.includes("application/x-www-form-urlencoded")
  ) {
    const formData = await request.formData();
    return String(
      formData.get("deletion_reason") || formData.get("deletionReason") || ""
    ).trim();
  }

  return "";
}

function normalizeStoragePath(value: string | null) {
  const raw = String(value || "").trim();

  if (!raw) return "";
  if (!raw.startsWith("http")) return raw.replace(/^\/+/, "");

  const marker = `/storage/v1/object/public/${DOCUMENT_BUCKET}/`;
  const markerIndex = raw.indexOf(marker);

  if (markerIndex >= 0) {
    return decodeURIComponent(raw.slice(markerIndex + marker.length));
  }

  return raw;
}

function isMissingRelationError(error: any) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    error?.code === "PGRST205" ||
    message.includes("could not find") ||
    message.includes("does not exist")
  );
}

async function loadPaymentDocuments(
  admin: ReturnType<typeof adminClient>,
  paymentId: string
) {
  const { data, error } = await admin
    .from("payment_documents")
    .select("*")
    .eq("payment_id", paymentId);

  if (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }

  return data || [];
}

export async function POST(request: Request) {
  try {
    const auth = await requirePermission(request, MODULE_CODE, "add");

    if ("response" in auth) {
      return auth.response;
    }

    const formData = await request.formData();
    const invoiceId = String(formData.get("invoice_id") || "").trim();
    const paymentDate = String(formData.get("payment_date") || "").trim();
    const paymentMode = String(formData.get("payment_mode") || "").trim();
    const companyBankAccountId = String(
      formData.get("company_bank_account_id") || ""
    ).trim();
    const totalPayment = roundAmount(formData.get("total_payment"));
    const tdsAmount = roundAmount(formData.get("tds_amount"));
    const transferredAmount = roundAmount(formData.get("transferred_amount"));
    const referenceNumber = String(
      formData.get("reference_number") || formData.get("utr_number") || ""
    ).trim();
    const remarks = String(formData.get("remarks") || "").trim();

    if (!invoiceId) {
      const paymentType = String(formData.get("payment_type") || "").trim();
      const companyId = String(formData.get("company_id") || "").trim();
      const workOrderId = String(formData.get("work_order_id") || "").trim();
      const vendorId = String(formData.get("vendor_id") || "").trim();
      const toCompanyBankAccountId = String(
        formData.get("to_company_bank_account_id") || ""
      ).trim();

      if (!paymentType) {
        return NextResponse.json(
          { error: "Payment Against is required." },
          { status: 400 }
        );
      }

      if (!paymentDate) {
        return NextResponse.json(
          { error: "Payment Date is required." },
          { status: 400 }
        );
      }

      if (!companyBankAccountId) {
        return NextResponse.json(
          { error: "From Account is required." },
          { status: 400 }
        );
      }

      if (totalPayment <= 0) {
        return NextResponse.json(
          { error: "Payment amount is required." },
          { status: 400 }
        );
      }

      if (tdsAmount < 0 || tdsAmount > totalPayment) {
        return NextResponse.json(
          { error: "TDS cannot exceed Total Payment." },
          { status: 400 }
        );
      }

      if (transferredAmount !== totalPayment - tdsAmount) {
        return NextResponse.json(
          { error: "Transferred Amount must equal Total Payment minus TDS." },
          { status: 400 }
        );
      }

      if (paymentType === "Work Order" && !workOrderId) {
        return NextResponse.json(
          { error: "Work Order is required." },
          { status: 400 }
        );
      }

      if (paymentType === "Work Order" && !vendorId) {
        return NextResponse.json(
          { error: "No vendor linked to selected Work Order." },
          { status: 400 }
        );
      }

      if (paymentType === "Purchase Order" && !vendorId) {
        return NextResponse.json(
          { error: "Vendor / Party is required." },
          { status: 400 }
        );
      }

      if (paymentType !== "Work Order" && !referenceNumber) {
        return NextResponse.json(
          { error: "Reference is required." },
          { status: 400 }
        );
      }

      if (
        paymentType === "Internal Transfer" &&
        toCompanyBankAccountId === companyBankAccountId
      ) {
        return NextResponse.json(
          { error: "From Account and To Account cannot be same." },
          { status: 400 }
        );
      }

      const admin = adminClient();
      const { data: account, error: accountError } = await admin
        .from("company_bank_accounts")
        .select("id, organization_id, company_id, status")
        .eq("id", companyBankAccountId)
        .maybeSingle();

      if (accountError) throw accountError;

      if (!account || String(account.status || "").toLowerCase() !== "active") {
        return NextResponse.json(
          { error: "Selected From Account was not found or inactive." },
          { status: 400 }
        );
      }

      const organizationScope = await loadActorOrganizationScope(admin, auth);

      if (!isInOrganizationScope(organizationScope, account.organization_id)) {
        return NextResponse.json(
          { error: "You do not have access to this organization." },
          { status: 403 }
        );
      }

      const { data: workOrder, error: workOrderError } = workOrderId
        ? await admin
            .from("work_orders")
            .select("id, organization_id, company_id, status, approval_status")
            .eq("id", workOrderId)
            .maybeSingle()
        : { data: null, error: null };

      if (workOrderError) throw workOrderError;

      if (workOrderId && !workOrder) {
        return NextResponse.json(
          { error: "Selected Work Order was not found." },
          { status: 404 }
        );
      }

      if (workOrder) {
        const workOrderStatus = String(workOrder.status || "")
          .trim()
          .toLowerCase();
        const workOrderApprovalStatus = String(workOrder.approval_status || "")
          .trim()
          .toLowerCase();

        if (
          workOrderStatus !== "active" ||
          !["pending", "approved"].includes(workOrderApprovalStatus)
        ) {
          return NextResponse.json(
            { error: "This Work Order is suspended and cannot accept new transactions." },
            { status: 400 }
          );
        }
      }

      if (
        workOrder &&
        !isInOrganizationScope(organizationScope, workOrder.organization_id)
      ) {
        return NextResponse.json(
          { error: "You do not have access to this organization." },
          { status: 403 }
        );
      }

      const organizationId =
        workOrder?.organization_id || account.organization_id;

      if (!organizationId) {
        return NextResponse.json(
          { error: "Organization could not be resolved for this payment." },
          { status: 400 }
        );
      }

      if (!isInOrganizationScope(organizationScope, organizationId)) {
        return NextResponse.json(
          { error: "You do not have access to this organization." },
          { status: 403 }
        );
      }

      if (account.organization_id !== organizationId) {
        return NextResponse.json(
          { error: "Selected account is not available for this organization." },
          { status: 403 }
        );
      }

      if (companyId) {
        const { data: company, error: companyError } = await admin
          .from("companies")
          .select("id, organization_id")
          .eq("id", companyId)
          .maybeSingle();

        if (companyError) throw companyError;

        if (!company || company.organization_id !== organizationId) {
          return NextResponse.json(
            { error: "Selected company is not available for this organization." },
            { status: 403 }
          );
        }
      }

      if (toCompanyBankAccountId) {
        const { data: toAccount, error: toAccountError } = await admin
          .from("company_bank_accounts")
          .select("id, organization_id, status")
          .eq("id", toCompanyBankAccountId)
          .maybeSingle();

        if (toAccountError) throw toAccountError;

        if (
          !toAccount ||
          String(toAccount.status || "").toLowerCase() !== "active" ||
          toAccount.organization_id !== organizationId
        ) {
          return NextResponse.json(
            { error: "Selected To Account is not available for this organization." },
            { status: 403 }
          );
        }
      }

      if (vendorId) {
        const { data: vendor, error: vendorError } = await admin
          .from("vendors")
          .select("id, organization_id")
          .eq("id", vendorId)
          .maybeSingle();

        if (vendorError) throw vendorError;

        if (!vendor) {
          return NextResponse.json(
            { error: "Selected vendor was not found." },
            { status: 404 }
          );
        }

        if (
          !isInOrganizationScope(organizationScope, vendor.organization_id) ||
          vendor.organization_id !== organizationId
        ) {
          return NextResponse.json(
            { error: "Selected vendor is not available for this organization." },
            { status: 403 }
          );
        }
      }

      const paymentNumber = String(formData.get("payment_number") || "").trim() || `PAY-${Date.now()}`;

      const { data: existingPayments, error: duplicateError } = await admin
        .from("payments")
        .select("id, payment_number, utr_number")
        .eq("organization_id", organizationId)
        .eq("is_deleted", false);

      if (duplicateError) throw duplicateError;

      const paymentNumberDuplicate = (existingPayments || []).find(
        (payment) =>
          normalized(String(payment.payment_number || "")) ===
          normalized(paymentNumber)
      );

      if (paymentNumberDuplicate) {
        return NextResponse.json(
          { error: "Payment number already exists." },
          { status: 409 }
        );
      }

      const userEmail = auth.user.email || "platform.owner@mrc.local";
      const userName =
        auth.user.user_metadata?.full_name ||
        auth.user.user_metadata?.name ||
        userEmail ||
        "Platform Owner";

      const { data: payment, error: paymentError } = await admin
        .from("payments")
        .insert({
          organization_id: organizationId,
          company_id: companyId || workOrder?.company_id || account.company_id || null,
          work_order_id: workOrderId || null,
          vendor_id: vendorId || null,
          invoice_id: null,
          payment_number: paymentNumber,
          payment_date: paymentDate,
          payment_type: paymentType,
          reference_number: referenceNumber || null,
          utr_number: referenceNumber || null,
          company_bank_account_id: companyBankAccountId,
          total_payment: totalPayment,
          tds_amount: tdsAmount,
          transferred_amount: transferredAmount,
          payment_amount: transferredAmount,
          payment_mode: paymentMode || "Bank Transfer",
          status: "Draft",
          remarks: remarks || null,
          created_by_name: userName,
          created_by_email: userEmail,
          created_at_user: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (paymentError) throw paymentError;

      return NextResponse.json({ id: payment.id });
    }

    if (!invoiceId) {
      return NextResponse.json(
        { error: "Invoice is required." },
        { status: 400 }
      );
    }

    if (!paymentDate) {
      return NextResponse.json(
        { error: "Payment Date is required." },
        { status: 400 }
      );
    }

    if (!paymentMode) {
      return NextResponse.json(
        { error: "Payment Mode is required." },
        { status: 400 }
      );
    }

    if (totalPayment <= 0) {
      return NextResponse.json(
        { error: "Payment amount is required." },
        { status: 400 }
      );
    }

    if (tdsAmount < 0 || tdsAmount > totalPayment) {
      return NextResponse.json(
        { error: "TDS cannot exceed Total Payment." },
        { status: 400 }
      );
    }

    if (transferredAmount !== totalPayment - tdsAmount) {
      return NextResponse.json(
        { error: "Transferred Amount must equal Total Payment minus TDS." },
        { status: 400 }
      );
    }

    if (isBankTransferMode(paymentMode) && !referenceNumber) {
      return NextResponse.json(
        { error: "UTR / Reference Number is required for bank transfers." },
        { status: 400 }
      );
    }

    const admin = adminClient();

    const { data: invoice, error: invoiceError } = await admin
      .from("invoices")
      .select(
        `
          id,
          organization_id,
          work_order_id,
          vendor_id,
          invoice_number,
          invoice_amount,
          itc_status
        `
      )
      .eq("id", invoiceId)
      .maybeSingle();

    if (invoiceError) throw invoiceError;

    if (!invoice) {
      return NextResponse.json(
        { error: "Selected invoice was not found." },
        { status: 404 }
      );
    }

    const organizationScope = await loadActorOrganizationScope(admin, auth);

    if (!isInOrganizationScope(organizationScope, invoice.organization_id)) {
      return NextResponse.json(
        { error: "You do not have access to this organization." },
        { status: 403 }
      );
    }

    if (companyBankAccountId) {
      const { data: account, error: accountError } = await admin
        .from("company_bank_accounts")
        .select("id, organization_id, status")
        .eq("id", companyBankAccountId)
        .maybeSingle();

      if (accountError) throw accountError;

      if (!account || String(account.status || "").toLowerCase() !== "active") {
        return NextResponse.json(
          { error: "Selected From Account was not found or inactive." },
          { status: 400 }
        );
      }

      if (
        !isInOrganizationScope(organizationScope, account.organization_id) ||
        account.organization_id !== invoice.organization_id
      ) {
        return NextResponse.json(
          { error: "Selected account is not available for this organization." },
          { status: 403 }
        );
      }
    }

    if (String(invoice.itc_status || "").toLowerCase() !== "claimed") {
      return NextResponse.json(
        { error: "Only invoices with ITC status Claimed can be paid." },
        { status: 400 }
      );
    }

    const { data: workOrder, error: workOrderError } = invoice.work_order_id
      ? await admin
          .from("work_orders")
          .select("id, company_id, status, approval_status")
          .eq("id", invoice.work_order_id)
          .maybeSingle()
      : { data: null, error: null };

    if (workOrderError) throw workOrderError;

    if (workOrder) {
      const workOrderStatus = String(workOrder.status || "")
        .trim()
        .toLowerCase();
      const workOrderApprovalStatus = String(workOrder.approval_status || "")
        .trim()
        .toLowerCase();

      if (
        workOrderStatus !== "active" ||
        !["pending", "approved"].includes(workOrderApprovalStatus)
      ) {
        return NextResponse.json(
          { error: "This Work Order is suspended and cannot accept new transactions." },
          { status: 400 }
        );
      }
    }

    const { data: previousPayments, error: paymentsError } = await admin
      .from("payments")
      .select("total_payment, payment_amount")
      .eq("invoice_id", invoiceId)
      .eq("is_deleted", false);

    if (paymentsError) throw paymentsError;

    const previousTotal = (previousPayments || []).reduce(
      (sum, payment) =>
        sum + Number(payment.total_payment || payment.payment_amount || 0),
      0
    );
    const invoiceAmount = Number(invoice.invoice_amount || 0);
    const balance = Math.max(invoiceAmount - previousTotal, 0);

    if (totalPayment > balance) {
      return NextResponse.json(
        {
          error: `Payment exceeds invoice balance. Balance payable is ${balance}.`,
        },
        { status: 400 }
      );
    }

    const userEmail = auth.user.email || "platform.owner@mrc.local";
    const userName =
      auth.user.user_metadata?.full_name ||
      auth.user.user_metadata?.name ||
      userEmail ||
      "Platform Owner";

    const paymentNumber = `PAY/${Date.now()}`;

    const { data: existingPayments, error: duplicateError } = await admin
      .from("payments")
      .select("id, payment_number, utr_number")
      .eq("organization_id", invoice.organization_id)
      .eq("is_deleted", false);

    if (duplicateError) throw duplicateError;

    const paymentNumberDuplicate = (existingPayments || []).find(
      (payment) =>
        normalized(String(payment.payment_number || "")) ===
        normalized(paymentNumber)
    );

    if (paymentNumberDuplicate) {
      return NextResponse.json(
        { error: "Payment number already exists." },
        { status: 409 }
      );
    }

    if (referenceNumber) {
      const utrDuplicate = (existingPayments || []).find(
        (payment) =>
          normalized(String(payment.utr_number || "")) ===
          normalized(referenceNumber)
      );

      if (utrDuplicate) {
        return NextResponse.json(
          { error: "UTR number already exists." },
          { status: 409 }
        );
      }
    }

    const { data: payment, error: paymentError } = await admin
      .from("payments")
      .insert({
        organization_id: invoice.organization_id,
        company_id: workOrder?.company_id || null,
        work_order_id: invoice.work_order_id,
        vendor_id: invoice.vendor_id,
        invoice_id: invoice.id,
        payment_number: paymentNumber,
        payment_date: paymentDate,
        payment_type: "Invoice",
        reference_number: referenceNumber || null,
        utr_number: referenceNumber || null,
        company_bank_account_id: companyBankAccountId || null,
        total_payment: totalPayment,
        tds_amount: tdsAmount,
        transferred_amount: transferredAmount,
        payment_amount: transferredAmount,
        payment_mode: paymentMode,
        status: "Completed",
        remarks: remarks || null,
        created_by_name: userName,
        created_by_email: userEmail,
        created_at_user: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (paymentError) throw paymentError;

    return NextResponse.json({ id: payment.id });
  } catch (error: any) {
    const friendlyDuplicate = duplicateErrorMessage(error);

    if (friendlyDuplicate) {
      return NextResponse.json({ error: friendlyDuplicate }, { status: 409 });
    }

    return NextResponse.json(
      { error: error.message || "Failed to create payment." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireUser(request);

    if ("error" in auth) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      );
    }

    const { searchParams } = new URL(request.url);
    const paymentId = searchParams.get("payment_id")?.trim();
    const deletionReason = await readDeletionReason(request);

    if (!paymentId) {
      return NextResponse.json(
        { error: "payment_id is required." },
        { status: 400 }
      );
    }

    if (deletionReason.length < 10) {
      return NextResponse.json(
        { error: "Deletion reason must be at least 10 characters." },
        { status: 400 }
      );
    }

    const admin = adminClient();
    const permission = await requireDeletePermission(
      admin,
      auth.user,
      MODULE_CODE
    );

    if ("error" in permission) {
      return NextResponse.json(
        { error: permission.error },
        { status: permission.status }
      );
    }

    const { data: payment, error: paymentError } = await admin
      .from("payments")
      .select("*")
      .eq("id", paymentId)
      .maybeSingle();

    if (paymentError) throw paymentError;

    if (!payment) {
      return NextResponse.json(
        { error: "Payment was not found." },
        { status: 404 }
      );
    }

    const organizationScope = await loadOrganizationScopeForUser(
      admin,
      auth.user.id
    );

    if (!isInOrganizationScope(organizationScope, payment.organization_id)) {
      return NextResponse.json(
        { error: "You do not have access to this organization." },
        { status: 403 }
      );
    }

    const documents = await loadPaymentDocuments(admin, paymentId);
    const filePaths = Array.from(
      new Set(
        documents
          .map((document: any) =>
            normalizeStoragePath(document.file_path || document.file_url)
          )
          .filter(Boolean)
      )
    );

    await insertDeleteAudit(admin, auth.user, {
      organizationId: payment.organization_id,
      moduleCode: MODULE_CODE,
      documentType: "Payment",
      documentId: payment.id,
      documentNumber:
        payment.payment_number || payment.reference_number || payment.utr_number,
      deletionReason,
      recordSnapshot: payment,
      relatedSnapshot: documents.length
        ? {
            payment_documents: documents,
          }
        : null,
      fileSnapshot: filePaths.length
        ? {
            bucket: DOCUMENT_BUCKET,
            paths: filePaths,
          }
        : null,
    });

    if (filePaths.length > 0) {
      const { error: storageError } = await admin.storage
        .from(DOCUMENT_BUCKET)
        .remove(filePaths);

      if (storageError && !isMissingRelationError(storageError)) {
        throw storageError;
      }
    }

    if (documents.length > 0) {
      const { error: documentDeleteError } = await admin
        .from("payment_documents")
        .delete()
        .eq("payment_id", paymentId);

      if (documentDeleteError && !isMissingRelationError(documentDeleteError)) {
        throw documentDeleteError;
      }
    }

    const { error: deleteError } = await admin
      .from("payments")
      .delete()
      .eq("id", paymentId);

    if (deleteError) throw deleteError;

    return NextResponse.json({
      deleted: true,
      audit_logged: true,
      deleted_storage_files: filePaths.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to delete payment." },
      { status: 500 }
    );
  }
}
