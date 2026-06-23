import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const permission = await requirePermission(request, "organizations", "edit");

    if ("response" in permission) {
      return permission.response;
    }

    const { id } = await params;
    const payload = await request.json().catch(() => ({}));
    const name = String(payload.name || "").trim();
    const code = String(payload.code || "").trim();
    const status = String(payload.status || "active").trim() || "active";

    if (!name) {
      return NextResponse.json(
        { error: "Organization name is required." },
        { status: 400 }
      );
    }

    if (!code) {
      return NextResponse.json(
        { error: "Organization code is required." },
        { status: 400 }
      );
    }

    const admin = adminClient();
    const { error } = await admin
      .from("organizations")
      .update({ name, code, status })
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ organization_id: id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to update organization." },
      { status: 500 }
    );
  }
}
