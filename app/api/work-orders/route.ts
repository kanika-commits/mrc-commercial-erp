import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
    const woDate = String(formData.get("wo_date") || "").trim();
    const woType = String(formData.get("wo_type") || "").trim();
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
    const generatedWONumber = await generateWorkOrderNumber(
      admin,
      company.company_code,
      site.site_code
    );

    const { data: duplicate, error: duplicateError } = await admin
      .from("work_orders")
      .select("id, wo_number")
      .eq("organization_id", organizationId)
      .eq("wo_number", generatedWONumber)
      .maybeSingle();

    if (duplicateError) throw duplicateError;

    if (duplicate) {
      return NextResponse.json(
        { error: "Generated Work Order number already exists. Please save again." },
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
    let uploadedFilePath = "";

    try {
      const { data: workOrder, error: woError } = await admin
        .from("work_orders")
        .insert({
          organization_id: organizationId,
          company_id: companyId,
          site_id: siteId,
          wo_number: generatedWONumber,
          wo_date: woDate,
          wo_type: woType,
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

      const cleanName = safeFileName(file.name);
      const filePath = `work-orders/${workOrder.id}/${Date.now()}-${cleanName}`;

      const { error: uploadError } = await admin.storage
        .from("work-order-documents")
        .upload(filePath, file, { upsert: false });

      if (uploadError) throw uploadError;

      uploadedFilePath = filePath;

      const { data: publicUrlData } = admin.storage
        .from("work_order_documents")
        .getPublicUrl(filePath);

      const { error: documentError } = await admin
        .from("work_order_documents")
        .insert({
          organization_id: organizationId,
          work_order_id: workOrder.id,
          file_name: file.name,
          file_url: publicUrlData.publicUrl,
          file_path: filePath,
        });

      if (documentError) throw documentError;

      return NextResponse.json({ workOrder });
    } catch (error) {
      await cleanupWorkOrder(admin, createdWorkOrderId, uploadedFilePath);
      throw error;
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to create work order." },
      { status: 500 }
    );
  }
}
