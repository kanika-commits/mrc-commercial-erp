import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  insertDeleteAudit,
  requireDeletePermission,
} from "@/lib/serverDeleteAudit";

const DOCUMENT_BUCKET = "invoice-documents";
const MODULE_CODE = "invoices";

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

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
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

async function countDirectLinks(
  admin: ReturnType<typeof adminClient>,
  table: string,
  column: string,
  id: string
) {
  const { count, error } = await admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, id);

  if (error) {
    if (isMissingRelationError(error)) return 0;
    throw error;
  }

  return count || 0;
}

async function cleanupInvoice(
  admin: ReturnType<typeof adminClient>,
  invoiceId?: string,
  uploadedPath?: string
) {
  if (uploadedPath) {
    await admin.storage.from(DOCUMENT_BUCKET).remove([uploadedPath]);
  }

  if (invoiceId) {
    await admin.from("invoice_documents").delete().eq("invoice_id", invoiceId);
    await admin.from("invoices").delete().eq("id", invoiceId);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireUser(request);

    if ("error" in auth) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      );
    }

    const formData = await request.formData();
    const workOrderId = String(formData.get("work_order_id") || "").trim();
    const vendorId = String(formData.get("vendor_id") || "").trim();
    const invoiceNumber = String(formData.get("invoice_number") || "").trim();
    const invoiceDate = String(formData.get("invoice_date") || "").trim();
    const taxableAmount = Number(formData.get("taxable_amount") || 0);
    const gstRate = Number(formData.get("gst_rate") || 0);
    const gstAmount = Number(formData.get("gst_amount") || 0);
    const invoiceAmount = Number(formData.get("invoice_amount") || 0);
    const remarks = String(formData.get("remarks") || "").trim();
    const file = formData.get("invoice_file");

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

    if (!invoiceNumber) {
      return NextResponse.json(
        { error: "Vendor Invoice Number is required." },
        { status: 400 }
      );
    }

    if (!invoiceDate) {
      return NextResponse.json(
        { error: "Invoice Date is required." },
        { status: 400 }
      );
    }

    if (!Number.isFinite(taxableAmount) || taxableAmount <= 0) {
      return NextResponse.json(
        { error: "Taxable amount is required." },
        { status: 400 }
      );
    }

    if (!Number.isFinite(gstRate) || gstRate < 0) {
      return NextResponse.json(
        { error: "GST rate is required." },
        { status: 400 }
      );
    }

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "Invoice PDF is required." },
        { status: 400 }
      );
    }

    if (file.type && file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Only PDF file is allowed for invoice." },
        { status: 400 }
      );
    }

    const admin = adminClient();

    const { data: workOrder, error: workOrderError } = await admin
      .from("work_orders")
      .select("id, organization_id")
      .eq("id", workOrderId)
      .maybeSingle();

    if (workOrderError) throw workOrderError;

    if (!workOrder) {
      return NextResponse.json(
        { error: "Selected Work Order was not found." },
        { status: 404 }
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

    const userEmail = auth.user.email || "platform.owner@mrc.local";
    const userName =
      auth.user.user_metadata?.full_name ||
      auth.user.user_metadata?.name ||
      userEmail ||
      "Platform Owner";

    const roundedTaxable = Math.round(taxableAmount);
    const roundedGst = Number.isFinite(gstAmount)
      ? Math.round(gstAmount)
      : Math.round((roundedTaxable * gstRate) / 100);
    const roundedInvoiceAmount = Number.isFinite(invoiceAmount)
      ? Math.round(invoiceAmount)
      : roundedTaxable + roundedGst;

    let invoiceId = "";
    let uploadedPath = "";

    try {
      const { data: invoice, error: invoiceError } = await admin
        .from("invoices")
        .insert({
          organization_id: workOrder.organization_id,
          work_order_id: workOrderId,
          vendor_id: vendorId,
          invoice_number: invoiceNumber,
          invoice_date: invoiceDate,
          taxable_amount: roundedTaxable,
          gst_rate: Number.isFinite(gstRate) ? gstRate : 0,
          gst_amount: roundedGst,
          invoice_amount: roundedInvoiceAmount,
          status: "Submitted",
          approval_status: "Pending",
          itc_status: "Pending",
          remarks: remarks || null,
          created_by_name: userName,
          created_by_email: userEmail,
        })
        .select("id")
        .single();

      if (invoiceError) throw invoiceError;

      invoiceId = invoice.id;

      const filePath = `${workOrder.organization_id}/invoices/${
        invoice.id
      }/${Date.now()}_${safeFileName(file.name)}`;

      const { error: uploadError } = await admin.storage
        .from(DOCUMENT_BUCKET)
        .upload(filePath, file, { upsert: false });

      if (uploadError) throw uploadError;

      uploadedPath = filePath;

      const { error: documentError } = await admin
        .from("invoice_documents")
        .insert({
          organization_id: workOrder.organization_id,
          invoice_id: invoice.id,
          file_name: file.name,
          file_url: filePath,
        });

      if (documentError) throw documentError;

      return NextResponse.json({ id: invoice.id });
    } catch (error) {
      await cleanupInvoice(admin, invoiceId, uploadedPath);
      throw error;
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to create invoice." },
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
    const invoiceId = searchParams.get("invoice_id")?.trim();
    const deletionReason = await readDeletionReason(request);

    if (!invoiceId) {
      return NextResponse.json(
        { error: "invoice_id is required." },
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

    const { data: invoice, error: invoiceError } = await admin
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .maybeSingle();

    if (invoiceError) throw invoiceError;

    if (!invoice) {
      return NextResponse.json(
        { error: "Invoice was not found." },
        { status: 404 }
      );
    }

    const paymentCount = await countDirectLinks(
      admin,
      "payments",
      "invoice_id",
      invoiceId
    );

    if (paymentCount > 0) {
      return NextResponse.json(
        {
          error: "Cannot delete Invoice because linked payments exist.",
          dependencies: {
            payments: paymentCount,
          },
        },
        { status: 409 }
      );
    }

    const { data: documents, error: documentsError } = await admin
      .from("invoice_documents")
      .select("*")
      .eq("invoice_id", invoiceId);

    if (documentsError) throw documentsError;

    const paths = Array.from(
      new Set(
        (documents || [])
          .map((document) => normalizeStoragePath(document.file_url))
          .filter(Boolean)
      )
    );

    await insertDeleteAudit(admin, auth.user, {
      organizationId: invoice.organization_id,
      moduleCode: MODULE_CODE,
      documentType: "Invoice",
      documentId: invoice.id,
      documentNumber: invoice.invoice_number,
      deletionReason,
      recordSnapshot: invoice,
      relatedSnapshot: {
        invoice_documents: documents || [],
      },
      fileSnapshot: {
        bucket: DOCUMENT_BUCKET,
        paths,
      },
    });

    if (paths.length > 0) {
      const { error: storageError } = await admin.storage
        .from(DOCUMENT_BUCKET)
        .remove(paths);

      if (storageError) throw storageError;
    }

    const { error: documentDeleteError } = await admin
      .from("invoice_documents")
      .delete()
      .eq("invoice_id", invoiceId);

    if (documentDeleteError) throw documentDeleteError;

    const { error: deleteError } = await admin
      .from("invoices")
      .delete()
      .eq("id", invoiceId);

    if (deleteError) throw deleteError;

    return NextResponse.json({
      deleted: true,
      deleted_storage_files: paths.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to delete invoice." },
      { status: 500 }
    );
  }
}
