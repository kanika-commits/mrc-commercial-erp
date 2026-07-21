import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadActiveAccountContext } from "@/lib/serverAccountAccess";

export async function GET(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    }

    if (!serviceRoleKey) {
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
    }

    const authClient = createClient(supabaseUrl, anonKey);
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser(token);

    if (userError) throw userError;

    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 401 });
    }

    const accountContext = await loadActiveAccountContext(adminClient, user);

    if ("response" in accountContext) {
      return accountContext.response;
    }

    return NextResponse.json(accountContext);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load user access." },
      { status: 500 }
    );
  }
}
