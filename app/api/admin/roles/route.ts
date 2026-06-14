import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  try {
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
