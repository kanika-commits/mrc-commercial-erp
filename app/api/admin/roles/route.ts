import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";

export async function GET(request: Request) {
  try {
    const permission = await requirePermission(request, "roles", "view");

    if ("response" in permission) {
      return permission.response;
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    if (!serviceRoleKey) {
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data, error } = await supabase
      .from("roles")
      .select("id, role_name, role_code, status, is_system_role, created_at")
      .order("created_at", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ roles: data || [] });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load roles." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const permission = await requirePermission(request, "roles", "add");

    if ("response" in permission) {
      return permission.response;
    }

    const payload = await request.json().catch(() => ({}));
    const roleName = String(payload.role_name || "").trim();
    const roleCode = String(payload.role_code || "").trim();

    if (!roleName) {
      return NextResponse.json(
        { error: "Role Name is required." },
        { status: 400 }
      );
    }

    if (!roleCode) {
      return NextResponse.json(
        { error: "Role Code is required." },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    if (!serviceRoleKey) {
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await supabase
      .from("roles")
      .insert({
        role_name: roleName,
        role_code: roleCode,
        status: "active",
        is_system_role: false,
      })
      .select("id")
      .single();

    if (error) throw error;

    return NextResponse.json({ role_id: data.id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to create role." },
      { status: 500 }
    );
  }
}
