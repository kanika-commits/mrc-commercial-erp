import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { optimizeUploadFile } from "@/lib/fileOptimization";
import {
  createDriveSubfolder,
  createWorkOrderDriveFolder,
  uploadDriveFile,
} from "@/src/lib/googleDrive";

const MODULE_CODE = "work_orders";

const CHANGE_CONFIG = {
  rate_terms_revision: {
    prefix: "R",
    folderName: "Revisions",
    label: "Rate/Terms Revision",
  },
  additional_work: {
    prefix: "AR",
    folderName: "Additional Work",
    label: "Additional Work",
  },
} as const;

type ChangeType = keyof typeof CHANGE_CONFIG;

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

async function requireEditPermission(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const token = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    return { error: "Missing auth token.", status: 401 } as const;
  }

  const authClient = createClient(supabaseUrl, anonKey);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser(token);

  if (userError) throw userError;

  if (!user) {
    return { error: "User not found.", status: 401 } as const;
  }

  const { data: userRoles, error: userRolesError } = await admin
    .from("user_roles")
    .select("role_id")
    .eq("user_id", user.id);

  if (userRolesError) throw userRolesError;

  const roleIds = (userRoles || []).map((row) => row.role_id).filter(Boolean);

  const { data: userPermissions, error: userPermissionError } = await admin
    .from("user_permissions")
    .select("module_code, action_code, allowed")
    .eq("user_id", user.id);

  if (userPermissionError) throw userPermissionError;

  let roleCodes: string[] = [];
  let rolePermissions: any[] = [];

  if (roleIds.length > 0) {
    const [
      { data: roles, error: rolesError },
      { data: permissions, error: permissionsError },
    ] = await Promise.all([
      admin.from("roles").select("role_code").in("id", roleIds),
      admin
        .from("role_permissions")
        .select("module_code, action_code, allowed")
        .in("role_id", roleIds),
    ]);

    if (rolesError) throw rolesError;
    if (permissionsError) throw permissionsError;

    roleCodes = (roles || []).map((role) => role.role_code).filter(Boolean);
    rolePermissions = permissions || [];
  }

  if (roleCodes.includes("platform_owner") || roleCodes.includes("super_admin")) {
    return { user } as const;
  }

  const allowed = [...rolePermissions, ...(userPermissions || [])].some(
    (permission) =>
      permission.allowed === true &&
      ((permission.module_code === "*" && permission.action_code === "*") ||
        (permission.module_code === MODULE_CODE && permission.action_code === "edit"))
  );

  if (!allowed) {
    return {
      error: "You do not have permission to edit Work Orders.",
      status: 403,
    } as const;
  }

  return { user } as const;
}

async function fileToOptimizedDrivePayload(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const optimized = await optimizeUploadFile(
    buffer,
    file.type || "application/octet-stream",
    file.name
  );

  return {
    fileName: optimized.fileName,
    mimeType: optimized.mimeType,
    base64: optimized.buffer.toString("base64"),
  };
}

async function getOrCreateDriveFolder(
  admin: ReturnType<typeof adminClient>,
  workOrder: any
) {
  const { data: existing, error: existingError } = await admin
    .from("work_order_drive_folders")
    .select("*")
    .eq("work_order_id", workOrder.id)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing?.drive_folder_id) return existing;

  const driveFolder = await createWorkOrderDriveFolder(workOrder.wo_number);

  const { data: saved, error: saveError } = await admin
    .from("work_order_drive_folders")
    .upsert(
      {
        organization_id: workOrder.organization_id,
        work_order_id: workOrder.id,
        drive_folder_id: driveFolder.folder_id,
        drive_folder_name: driveFolder.folder_name,
        ra_bills_folder_id: driveFolder.ra_bills_folder_id,
        invoices_folder_id: driveFolder.invoices_folder_id,
        debit_notes_folder_id: driveFolder.debit_notes_folder_id,
        contractor_docs_folder_id: driveFolder.contractor_docs_folder_id,
      },
      { onConflict: "work_order_id" }
    )
    .select("*")
    .single();

  if (saveError) throw saveError;
  return saved;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const access = await requireEditPermission(request);

    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const formData = await request.formData();
    const changeType = String(formData.get("change_type") || "").trim() as ChangeType;
    const changeDate = String(formData.get("change_date") || "").trim();
    const applicableDate = String(formData.get("applicable_date") || "").trim();
    const additionalWorkValue = Number(formData.get("additional_work_value") || 0);
    const gstPercentRaw = String(formData.get("gst_percent") || "").trim();
    const gstPercent = Number(gstPercentRaw || 0);
    const description = String(formData.get("description") || "").trim();
    const file = formData.get("file");

    if (!CHANGE_CONFIG[changeType]) {
      return NextResponse.json(
        { error: "Invalid Work Order change type." },
        { status: 400 }
      );
    }

    if (!changeDate) {
      return NextResponse.json(
        { error: "Change date is required." },
        { status: 400 }
      );
    }

    if (!description) {
      return NextResponse.json(
        { error: "Description is required." },
        { status: 400 }
      );
    }

    if (changeType === "rate_terms_revision" && !applicableDate) {
      return NextResponse.json(
        { error: "New rates/terms applicable date is required." },
        { status: 400 }
      );
    }

    if (
      changeType === "additional_work" &&
      (!Number.isFinite(additionalWorkValue) || additionalWorkValue <= 0)
    ) {
      return NextResponse.json(
        { error: "Value of Additional Work must be greater than 0." },
        { status: 400 }
      );
    }

    if (
      changeType === "additional_work" &&
      (!gstPercentRaw || !Number.isFinite(gstPercent) || gstPercent < 0)
    ) {
      return NextResponse.json(
        { error: "GST Rate % must be 0 or greater." },
        { status: 400 }
      );
    }

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "Upload file is required." },
        { status: 400 }
      );
    }

    const admin = adminClient();
    const { data: workOrder, error: workOrderError } = await admin
      .from("work_orders")
      .select("id, organization_id, wo_number, approval_status, wo_value, gst_percent")
      .eq("id", id)
      .maybeSingle();

    if (workOrderError) throw workOrderError;

    if (!workOrder) {
      return NextResponse.json(
        { error: "Work Order was not found." },
        { status: 404 }
      );
    }

    if (String(workOrder.approval_status || "").toLowerCase() !== "approved") {
      return NextResponse.json(
        { error: "Post-approval changes are allowed only for approved Work Orders." },
        { status: 400 }
      );
    }

    const { count, error: countError } = await admin
      .from("work_order_changes")
      .select("id", { count: "exact", head: true })
      .eq("work_order_id", id)
      .eq("change_type", changeType);

    if (countError) throw countError;

    const changeNumber = `${CHANGE_CONFIG[changeType].prefix}${(count || 0) + 1}`;
    const originalWoBasicValue = Number(workOrder.wo_value || 0);
    const { data: existingAdditionalWorks, error: additionalWorksError } = await admin
      .from("work_order_changes")
      .select("additional_work_value, gst_amount")
      .eq("work_order_id", id)
      .eq("change_type", "additional_work");

    if (additionalWorksError) throw additionalWorksError;

    const existingAdditionalWorkTotal = (existingAdditionalWorks || []).reduce(
      (sum, row) => sum + Number(row.additional_work_value || 0),
      0
    );
    const existingAdditionalGstTotal = (existingAdditionalWorks || []).reduce(
      (sum, row) => sum + Number(row.gst_amount || 0),
      0
    );
    const originalGstPercent = Number(workOrder.gst_percent ?? 18);
    const originalGstAmount =
      (originalWoBasicValue * (Number.isFinite(originalGstPercent) ? originalGstPercent : 0)) /
      100;
    const gstAmount =
      changeType === "additional_work" ? (additionalWorkValue * gstPercent) / 100 : null;
    const updatedWoBasicValue =
      changeType === "additional_work"
        ? originalWoBasicValue + existingAdditionalWorkTotal + additionalWorkValue
        : null;
    const updatedTotalWoValue =
      changeType === "additional_work"
        ? updatedWoBasicValue! + originalGstAmount + existingAdditionalGstTotal + Number(gstAmount || 0)
        : null;
    const driveFolder = await getOrCreateDriveFolder(admin, workOrder);
    const subfolder = await createDriveSubfolder({
      parentFolderId: driveFolder.drive_folder_id,
      folderName: CHANGE_CONFIG[changeType].folderName,
    });
    const optimizedFile = await fileToOptimizedDrivePayload(file);
    const uploadedFile = await uploadDriveFile({
      targetFolderId: subfolder.folder_id,
      fileName: optimizedFile.fileName,
      mimeType: optimizedFile.mimeType,
      base64: optimizedFile.base64,
    });

    const { data: change, error: insertError } = await admin
      .from("work_order_changes")
      .insert({
        organization_id: workOrder.organization_id,
        work_order_id: id,
        change_type: changeType,
        change_number: changeNumber,
        change_date: changeDate,
        applicable_date: changeType === "rate_terms_revision" ? applicableDate : null,
        additional_work_value:
          changeType === "additional_work" ? additionalWorkValue : null,
        gst_percent: changeType === "additional_work" ? gstPercent : null,
        gst_amount: gstAmount,
        updated_wo_basic_value: updatedWoBasicValue,
        updated_total_wo_value: updatedTotalWoValue,
        description,
        file_id: uploadedFile.file_id,
        file_url: uploadedFile.file_url,
        file_name: uploadedFile.file_name || optimizedFile.fileName,
        file_mime_type: optimizedFile.mimeType,
        created_by: access.user.id,
      })
      .select("*")
      .single();

    if (insertError) throw insertError;

    return NextResponse.json({ change });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to save Work Order change." },
      { status: 500 }
    );
  }
}
