import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  insertDeleteAudit,
  requireDeletePermission,
} from "@/lib/serverDeleteAudit";
import { createWorkOrderDriveFolder } from "@/src/lib/googleDrive";

const MODULE_CODE = "work_orders";
const DOCUMENT_BUCKET = "work-order-documents";

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

async function fileToBase64(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  return buffer.toString("base64");
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

async function loadOptionalChildRows(
  admin: ReturnType<typeof adminClient>,
  table: string,
  workOrderId: string
) {
  const { data, error } = await admin
    .from(table)
    .select("*")
    .eq("work_order_id", workOrderId);

  if (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }

  return data || [];
}

async function generateWorkOrderNumber(
  admin: ReturnType<typeof adminClient>,
  companyCode: string,
  siteCode: string
) {
  const prefix = `${siteCode}/${companyCode}/`;

  const { data, error } = await admin
    .from("work_orders")
    .select("wo_number")
    .like("wo_number", `${prefix}%`);

  if (error) throw error;

  let nextNumber = 101;

  if (data && data.length > 0) {
    const numbers = data
      .map((row) => {
        const parts = String(row.wo_number || "").split("/");
        return Number(parts[parts.length - 1]);
      })
      .filter((value) => Number.isFinite(value) && value > 0);

    if (numbers.length > 0) {
      nextNumber = Math.max(...numbers) + 1;
    }
  }

  return `${prefix}${nextNumber}`;
}

async function cleanupWorkOrder(
  admin: ReturnType<typeof adminClient>,
  workOrderId?: string,
  filePath?: string
) {
  if (filePath) {
    await admin.storage.from("work-order-documents").remove([filePath]);
  }

  if (workOrderId) {
    await admin
      .from("work_order_documents")
      .delete()
      .eq("work_order_id", workOrderId);
    await admin
      .from("work_order_vendors")
      .delete()
      .eq("work_order_id", workOrderId);
    await admin.from("work_orders").delete().eq("id", workOrderId);
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
    const companyId = String(formData.get("company_id") || "").trim();
    const siteId = String(formData.get("site_id") || "").trim();
    const woNumber = String(formData.get("wo_number") || "").trim();
    const woDate = String(formData.get("wo_date") || "").trim();
    const woType = String(formData.get("wo_type") || "").trim();
    const woValue = Number(formData.get("wo_value") || 0);
    const gstPercent = Number(formData.get("gst_percent") || 0);
    const description = String(formData.get("description") || "").trim();
    const vendorId = String(formData.get("primary_vendor_id") || "").trim();
    const vendorRole = String(formData.get("primary_vendor_role") || "").trim();
    const file = formData.get("work_order_file");

    if (!companyId) {
      return NextResponse.json(
        { error: "Company is required." },
        { status: 400 }
      );
    }

    if (!siteId) {
      return NextResponse.json({ error: "Site is required." }, { status: 400 });
    }

    if (!woNumber) {
      return NextResponse.json(
        { error: "Work Order number is required." },
        { status: 400 }
      );
    }

    if (!woDate) {
      return NextResponse.json(
        { error: "WO Date is required." },
        { status: 400 }
      );
    }

    if (!woType) {
      return NextResponse.json(
        { error: "WO Type is required." },
        { status: 400 }
      );
    }

    if (!Number.isFinite(woValue) || woValue <= 0) {
      return NextResponse.json(
        { error: "WO Basic Value is required." },
        { status: 400 }
      );
    }

    if (!Number.isFinite(gstPercent) || gstPercent < 0) {
      return NextResponse.json(
        { error: "GST % is required." },
        { status: 400 }
      );
    }

    if (!vendorId) {
      return NextResponse.json(
        { error: "Primary vendor is required." },
        { status: 400 }
      );
    }

    if (!vendorRole) {
      return NextResponse.json(
        { error: "Vendor role is required." },
        { status: 400 }
      );
    }

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "Work Order file is required." },
        { status: 400 }
      );
    }

    const admin = adminClient();

    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id, organization_id, company_code")
      .eq("id", companyId)
      .maybeSingle();

    if (companyError) throw companyError;

    if (!company) {
      return NextResponse.json(
        { error: "Selected company was not found." },
        { status: 404 }
      );
    }

    const { data: site, error: siteError } = await admin
      .from("sites")
      .select("id, site_code")
      .eq("id", siteId)
      .maybeSingle();

    if (siteError) throw siteError;

    if (!site) {
      return NextResponse.json(
        { error: "Selected site was not found." },
        { status: 404 }
      );
    }

    if (!company.company_code) {
      return NextResponse.json(
        { error: "Selected company does not have company code." },
        { status: 400 }
      );
    }

    if (!site.site_code) {
      return NextResponse.json(
        { error: "Selected site does not have site code." },
        { status: 400 }
      );
    }

    const { data: vendor, error: vendorError } = await admin
      .from("vendors")
      .select("id, vendor_name")
      .eq("id", vendorId)
      .maybeSingle();

    if (vendorError) throw vendorError;

    if (!vendor) {
      return NextResponse.json(
        { error: "Selected vendor was not found." },
        { status: 404 }
      );
    }

    const organizationId = company.organization_id;
    const normalizedWONumber = woNumber.toLowerCase();

    const { data: duplicates, error: duplicateError } = await admin
      .from("work_orders")
      .select("id, wo_number")
      .eq("organization_id", organizationId)
      .ilike("wo_number", woNumber);

    if (duplicateError) throw duplicateError;

    const duplicate = (duplicates || []).find(
      (row) => String(row.wo_number || "").trim().toLowerCase() === normalizedWONumber
    );

    if (duplicate) {
      return NextResponse.json(
        { error: "Work Order number already exists." },
        { status: 409 }
      );
    }

    const userEmail = auth.user.email || "platform.owner@mrc.local";
    const userName =
      auth.user.user_metadata?.full_name ||
      auth.user.user_metadata?.name ||
      userEmail ||
      "Platform Owner";

    let createdWorkOrderId = "";
    try {
      const { data: workOrder, error: woError } = await admin
        .from("work_orders")
        .insert({
          organization_id: organizationId,
          company_id: companyId,
          site_id: siteId,
          wo_number: woNumber,
          wo_date: woDate,
          wo_type: woType,
          wo_value: woValue,
          gst_percent: gstPercent,
          description: description || null,
          status: "active",
          approval_status: "pending",
          created_by_name: userName,
          created_by_email: userEmail,
          created_at_user: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (woError) throw woError;

      createdWorkOrderId = workOrder.id;

      const { data: vendorLink, error: vendorLinkError } = await admin
        .from("work_order_vendors")
        .insert({
          organization_id: organizationId,
          work_order_id: workOrder.id,
          vendor_id: vendorId,
          vendor_role: vendorRole,
          is_primary: true,
        })
        .select("id")
        .single();

      if (vendorLinkError) throw vendorLinkError;

      if (!vendorLink?.id) {
        throw new Error("Work Order vendor link was not created.");
      }

      const { data: confirmedVendorLink, error: confirmVendorLinkError } =
        await admin
          .from("work_order_vendors")
          .select("id")
          .eq("work_order_id", workOrder.id)
          .eq("vendor_id", vendorId)
          .eq("is_primary", true)
          .maybeSingle();

      if (confirmVendorLinkError) throw confirmVendorLinkError;

      if (!confirmedVendorLink) {
        throw new Error("Work Order vendor link could not be verified.");
      }

      const driveFolder = await createWorkOrderDriveFolder(woNumber, {
        fileName: file.name,
        mimeType: file.type || "application/pdf",
        base64: await fileToBase64(file),
      });

      if (!driveFolder.work_order_file_id || !driveFolder.work_order_file_url) {
        throw new Error("Google Drive Work Order file was not created.");
      }

      const { data: document, error: documentError } = await admin
        .from("work_order_documents")
        .insert({
          organization_id: organizationId,
          work_order_id: workOrder.id,
          file_name: driveFolder.work_order_file_name || file.name,
          file_url: driveFolder.work_order_file_url,
          file_path: driveFolder.work_order_file_id,
          uploaded_at: new Date().toISOString(),
        })
        .select("id, file_name, file_path")
        .single();

      if (documentError) throw documentError;

      if (!document?.file_name || !document?.file_path) {
        throw new Error("Work Order file metadata was not saved.");
      }

      const { error: driveFolderError } = await admin
        .from("work_order_drive_folders")
        .upsert(
          {
            organization_id: organizationId,
            work_order_id: workOrder.id,
            drive_folder_id: driveFolder.folder_id,
            drive_folder_name: driveFolder.folder_name,
            ra_bills_folder_id: driveFolder.ra_bills_folder_id,
            invoices_folder_id: driveFolder.invoices_folder_id,
            debit_notes_folder_id: driveFolder.debit_notes_folder_id,
            contractor_docs_folder_id: driveFolder.contractor_docs_folder_id,
          },
          { onConflict: "work_order_id" }
        );

      if (driveFolderError) throw driveFolderError;

      return NextResponse.json({ workOrder });
    } catch (error) {
      await cleanupWorkOrder(admin, createdWorkOrderId);
      throw error;
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to create work order." },
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
    const workOrderId = searchParams.get("work_order_id")?.trim();
    const deletionReason = await readDeletionReason(request);

    if (!workOrderId) {
      return NextResponse.json(
        { error: "work_order_id is required." },
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

    const { data: workOrder, error: workOrderError } = await admin
      .from("work_orders")
      .select("*")
      .eq("id", workOrderId)
      .maybeSingle();

    if (workOrderError) throw workOrderError;

    if (!workOrder) {
      return NextResponse.json(
        { error: "Work Order was not found." },
        { status: 404 }
      );
    }

    const [
      raBillCount,
      debitNoteCount,
      invoiceCount,
      paymentCount,
      ledgerEntryCount,
      ledgerTransactionCount,
      accountLedgerCount,
    ] = await Promise.all([
      countDirectLinks(admin, "ra_bills", "work_order_id", workOrderId),
      countDirectLinks(admin, "debit_notes", "work_order_id", workOrderId),
      countDirectLinks(admin, "invoices", "work_order_id", workOrderId),
      countDirectLinks(admin, "payments", "work_order_id", workOrderId),
      countDirectLinks(admin, "ledger_entries", "work_order_id", workOrderId),
      countDirectLinks(admin, "ledger_transactions", "work_order_id", workOrderId),
      countDirectLinks(admin, "account_ledger", "work_order_id", workOrderId),
    ]);

    const ledgerCount =
      ledgerEntryCount + ledgerTransactionCount + accountLedgerCount;

    if (
      raBillCount > 0 ||
      debitNoteCount > 0 ||
      invoiceCount > 0 ||
      paymentCount > 0 ||
      ledgerCount > 0
    ) {
      return NextResponse.json(
        {
          error:
            "Cannot delete Work Order because linked RA Bills/Invoices/Payments/Debit Notes exist.",
          dependencies: {
            ra_bills: raBillCount,
            debit_notes: debitNoteCount,
            invoices: invoiceCount,
            payments: paymentCount,
            ledger_rows: ledgerCount,
          },
        },
        { status: 409 }
      );
    }

    const [documents, vendorLinks, fileRows] = await Promise.all([
      loadOptionalChildRows(admin, "work_order_documents", workOrderId),
      loadOptionalChildRows(admin, "work_order_vendors", workOrderId),
      loadOptionalChildRows(admin, "work_order_files", workOrderId),
    ]);

    const documentPaths = documents
      .map((document: any) =>
        normalizeStoragePath(document.file_path || document.file_url)
      )
      .filter(Boolean);
    const fileRowPaths = fileRows
      .map((file: any) => normalizeStoragePath(file.file_path || file.file_url))
      .filter(Boolean);
    const filePaths = Array.from(new Set([...documentPaths, ...fileRowPaths]));

    await insertDeleteAudit(admin, auth.user, {
      organizationId: workOrder.organization_id,
      moduleCode: MODULE_CODE,
      documentType: "Work Order",
      documentId: workOrder.id,
      documentNumber: workOrder.wo_number,
      deletionReason,
      recordSnapshot: workOrder,
      relatedSnapshot: {
        work_order_documents: documents,
        work_order_vendors: vendorLinks,
        work_order_files: fileRows,
      },
      fileSnapshot: {
        bucket: DOCUMENT_BUCKET,
        paths: filePaths,
      },
    });

    if (filePaths.length > 0) {
      const { error: storageError } = await admin.storage
        .from(DOCUMENT_BUCKET)
        .remove(filePaths);

      if (storageError && !isMissingRelationError(storageError)) {
        throw storageError;
      }
    }

    const childDeletes = [
      admin
        .from("work_order_documents")
        .delete()
        .eq("work_order_id", workOrderId),
      admin
        .from("work_order_vendors")
        .delete()
        .eq("work_order_id", workOrderId),
      admin.from("work_order_files").delete().eq("work_order_id", workOrderId),
    ];

    for (const result of await Promise.all(childDeletes)) {
      if (result.error && !isMissingRelationError(result.error)) {
        throw result.error;
      }
    }

    const { error: deleteError } = await admin
      .from("work_orders")
      .delete()
      .eq("id", workOrderId);

    if (deleteError) throw deleteError;

    return NextResponse.json({
      deleted: true,
      audit_logged: true,
      deleted_storage_files: filePaths.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to delete Work Order." },
      { status: 500 }
    );
  }
}
