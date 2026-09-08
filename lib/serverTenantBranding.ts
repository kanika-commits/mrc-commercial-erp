import { createClient } from "@supabase/supabase-js";

export const TENANT_BRANDING_BUCKET = "tenant-branding-assets";

export function createBrandingAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function resolveCurrentOrganization(admin: any) {
  const { data, error } = await admin.from("organizations").select("id, name, status").eq("status", "active").limit(2);
  if (error) throw error;
  if (!data?.length) throw new Error("No active organization is configured.");
  if (data.length > 1) throw new Error("Branding requires an explicit deployment organization.");
  return data[0];
}
