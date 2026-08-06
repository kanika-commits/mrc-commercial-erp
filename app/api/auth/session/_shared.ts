import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadActiveAccountContext } from "@/lib/serverAccountAccess";

export const HEARTBEAT_MIN_WRITE_INTERVAL_MS = 60 * 1000;

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function requestIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || null;
  return request.headers.get("x-real-ip") || null;
}

function browserFromUserAgent(userAgent: string | null) {
  const ua = userAgent || "";
  if (/Edg\//i.test(ua)) return "Edge";
  if (/Chrome\//i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return "Safari";
  if (/Firefox\//i.test(ua)) return "Firefox";
  return null;
}

function deviceFromUserAgent(userAgent: string | null) {
  const ua = userAgent || "";
  if (/Mobile|Android|iPhone|iPad/i.test(ua)) return "mobile";
  if (/Macintosh|Windows|Linux/i.test(ua)) return "desktop";
  return null;
}

export function validateSessionId(value: unknown) {
  const sessionId = String(value || "").trim();
  if (!/^[a-zA-Z0-9._:-]{12,120}$/.test(sessionId)) {
    throw new Error("Invalid session id.");
  }
  return sessionId;
}

export async function sessionRequestContext(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return { response: jsonError("Missing auth token.", 401) } as const;
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");

  const authClient = createClient(supabaseUrl, anonKey);
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: { user }, error } = await authClient.auth.getUser(token);
  if (error) throw error;
  if (!user) return { response: jsonError("User not found.", 401) } as const;

  const account = await loadActiveAccountContext(admin, user);
  if ("response" in account) return account;

  const userAgent = request.headers.get("user-agent");
  return {
    admin,
    user,
    account,
    metadata: {
      browser: browserFromUserAgent(userAgent),
      device_type: deviceFromUserAgent(userAgent),
      ip_address: requestIp(request),
      user_agent: userAgent,
      organization_id: account.isGlobalAccess ? null : account.organizations[0] || null,
    },
  } as const;
}
