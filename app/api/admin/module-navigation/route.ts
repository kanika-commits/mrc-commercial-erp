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

    const [groups, modules] = await Promise.all([
      supabase
        .from("erp_module_groups")
        .select("id, module_code, module_name, route, sort_order, status")
        .eq("status", "active")
        .order("sort_order"),
      supabase
        .from("erp_modules")
        .select("id, module_group, module_code, module_name, route, sort_order, status")
        .eq("status", "active")
        .order("sort_order"),
    ]);

    if (groups.error) throw groups.error;
    if (modules.error) throw modules.error;

    return NextResponse.json({
      groups: groups.data || [],
      modules: modules.data || [],
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load module navigation." },
      { status: 500 }
    );
  }
}
