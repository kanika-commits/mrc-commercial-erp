import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { optimizeUploadFile } from "@/lib/fileOptimization";
import { requirePermission } from "@/lib/serverPermissions";
import {
  isInOrganizationScope,
  loadActorOrganizationScope,
} from "@/lib/serverOrganizationScope";


const MODULE_CODE = "ra_bills";
const DOCUMENT_BUCKET = "ra-bill-documents";

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

function normalized(value: string) {
  return value.trim().toLowerCase();
}

function safeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function duplicateErrorMessage(error: any) {
  const message = String(error?.message || "");
  const details = String(error?.details || "");
  const constraint = String(error?.constraint || "");
  const haystack = `${message} ${details} ${constraint}`.toLowerCase();

  if (
    error?.code === "23505" &&
    haystack.includes("ra_bills_unique_number_per_wo")
  ) {
    return "RA Bill number already exists for this Work Order.";
  }

  return "";
}

async function cleanupRABill(
  admin: ReturnType<typeof adminClient>,
  raBillId?: string,
  uploadedPaths: string[] = []
) {
  if (uploadedPaths.length > 0) {
    await admin.storage.from(DOCUMENT_BUCKET).remove(uploadedPaths);
  }

  if (raBillId) {
    await admin.from("ra_bill_documents").delete().eq("ra_bill_id", raBillId);
    await admin.from("ra_bills").delete().eq("id", raBillId);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requirePermission(request, MODULE_CODE, "add");

    if ("response" in auth) {
      return auth.response;
    }

    const formData = await request.formData();
    const workOrderId = String(formData.get("work_order_id") || "").trim();
    const vendorId = String(formData.get("vendor_id") || "").trim();
    const raNumber = String(formData.get("ra_number") || "").trim();
    const raDate = String(formData.get("ra_date") || "").trim();
    const valueOfWorkDone = Number(formData.get("value_of_work_done") || 0);
    const securityAmount = Number(formData.get("security_amount") || 0);
    const gstRate = Number(formData.get("gst_rate") || 0);
    const gstAmount = Number(formData.get("gst_amount") || 0);
    const netAmount = Number(formData.get("net_amount") || 0);
    const remarks = String(formData.get("remarks") || "").trim();
    const files = formData
      .getAll("attachments")
      .filter((item): item is File => item instanceof File && item.size > 0);

    if (!workOrderId) {
      return NextResponse.json(
        { error: "Work Order is required." },
        { status: 400 }
      );
    }

    if (!vendorId) {
      return NextResponse.json(
        { error: "Vendor is required." },
        { status: 400 }
      );
    }

    if (!raNumber) {
      return NextResponse.json(
        { error: "RA Bill Number is required." },
        { status: 400 }
      );
    }

    if (!raDate) {
      return NextResponse.json(
        { error: "RA Date is required." },
        { status: 400 }
      );
    }

    if (!Number.isFinite(valueOfWorkDone) || valueOfWorkDone <= 0) {
      return NextResponse.json(
        { error: "Value of work done is required." },
        { status: 400 }
      );
    }

    if (files.length === 0) {
      return NextResponse.json(
        { error: "At least one RA Bill attachment is required." },
        { status: 400 }
      );
    }

    const admin = adminClient();

    const { data: workOrder, error: workOrderError } = await admin
      .from("work_orders")
      .select("id, organization_id, status, approval_status")
      .eq("id", workOrderId)
      .maybeSingle();

    if (workOrderError) throw workOrderError;

    if (!workOrder) {
      return NextResponse.json(
        { error: "Selected Work Order was not found." },
        { status: 404 }
      );
    }

    const workOrderStatus = String(workOrder.status || "").trim().toLowerCase();
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

    const organizationScope = await loadActorOrganizationScope(admin, auth);

    if (!isInOrganizationScope(organizationScope, workOrder.organization_id)) {
      return NextResponse.json(
        { error: "You do not have access to this organization." },
        { status: 403 }
      );
    }

    const { data: vendorLink, error: vendorLinkError } = await admin
      .from("work_order_vendors")
      .select("id")
      .eq("work_order_id", workOrderId)
      .eq("vendor_id", vendorId)
      .maybeSingle();

    if (vendorLinkError) throw vendorLinkError;

    if (!vendorLink) {
      return NextResponse.json(
        { error: "Selected vendor is not linked to this Work Order." },
        { status: 400 }
      );
    }

    const { data: existingRaBills, error: duplicateError } = await admin
      .from("ra_bills")
      .select("id, ra_number, approval_status")
      .eq("work_order_id", workOrderId);

    if (duplicateError) throw duplicateError;

    const duplicate = (existingRaBills || []).find(
  (bill) =>
    normalized(String(bill.ra_number || "")) === normalized(raNumber) &&
    normalized(String(bill.approval_status || "")) !== "rejected"
);

    if (duplicate) {
      return NextResponse.json(
        { error: "RA Bill number already exists for this Work Order." },
        { status: 409 }
      );
    }

    const userEmail = auth.user.email || "platform.owner@mrc.local";
    const userName =
      auth.user.user_metadata?.full_name ||
      auth.user.user_metadata?.name ||
      userEmail ||
      "Platform Owner";

    let raBillId = "";
    const uploadedPaths: string[] = [];

    try {
      const { data: raBill, error: raBillError } = await admin
        .from("ra_bills")
        .insert({
          organization_id: workOrder.organization_id,
          work_order_id: workOrderId,
          vendor_id: vendorId,
          ra_number: raNumber,
          ra_date: raDate,
          gross_amount: valueOfWorkDone,
          recovery_amount: Number.isFinite(securityAmount) ? securityAmount : 0,
          retention_amount: 0,
          gst_rate: Number.isFinite(gstRate) ? gstRate : 0,
          gst_amount: Number.isFinite(gstAmount) ? gstAmount : 0,
          net_amount: Number.isFinite(netAmount) ? netAmount : 0,
          status: "Draft",
          approval_status: "Pending",
          remarks: remarks || null,
          created_by_name: userName,
          created_by_email: userEmail,
        })
        .select("id")
        .single();

      if (raBillError) throw raBillError;

      raBillId = raBill.id;

      for (const file of files) {
        const fileBuffer = Buffer.from(await file.arrayBuffer());
        const optimizedFile = await optimizeUploadFile(
          fileBuffer,
          file.type || "application/octet-stream",
          file.name
        );
        const storagePath = `${workOrder.organization_id}/pending/${raBill.id}/${Date.now()}-${safeFileName(
          file.name
        )}`;

        const { error: uploadError } = await admin.storage
          .from(DOCUMENT_BUCKET)
          .upload(storagePath, optimizedFile.buffer, {
            contentType: optimizedFile.mimeType || "application/octet-stream",
            upsert: false,
          });

        if (uploadError) throw uploadError;

        uploadedPaths.push(storagePath);

        const { error: documentError } = await admin
          .from("ra_bill_documents")
          .insert({
            organization_id: workOrder.organization_id,
            ra_bill_id: raBill.id,
            file_name: file.name,
            file_url: storagePath,
            file_path: storagePath,
            uploaded_at: new Date().toISOString(),
          });

        if (documentError) throw documentError;
      }

      return NextResponse.json({ id: raBill.id });
    } catch (error) {
      await cleanupRABill(admin, raBillId, uploadedPaths);
      throw error;
    }
  } catch (error: any) {
    const friendlyDuplicate = duplicateErrorMessage(error);

    if (friendlyDuplicate) {
      return NextResponse.json({ error: friendlyDuplicate }, { status: 409 });
    }

    return NextResponse.json(
      { error: error.message || "Failed to create RA Bill." },
      { status: 500 }
    );
  }
}
