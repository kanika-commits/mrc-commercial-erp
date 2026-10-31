import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadPermissionContext } from "@/lib/serverPermissions";

export function platformAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase server configuration.");
  return createClient(url, key);
}

export async function requirePlatformOwner(request: Request) {
  const context = await loadPermissionContext(request);
  if ("response" in context) return context;
  if (!context.roleCodes.includes("platform_owner")) {
    return { response: NextResponse.json({ error: "Platform Owner access required." }, { status: 403 }) } as const;
  }
  return context;
}
