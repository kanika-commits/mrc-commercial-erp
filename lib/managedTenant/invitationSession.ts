import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function loadManagedInvitationSession(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { response: NextResponse.json({ error: "Missing auth token." }, { status: 401 }) } as const;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Missing Supabase public configuration.");

  const client = createClient(url, anonKey);
  const { data, error } = await client.auth.getUser(token);
  if (error) throw error;
  if (!data.user?.id || !data.user.email) {
    return { response: NextResponse.json({ error: "Authenticated user not found." }, { status: 401 }) } as const;
  }

  return { userId: data.user.id, email: data.user.email } as const;
}
