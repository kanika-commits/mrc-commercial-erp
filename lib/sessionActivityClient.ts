import { supabase } from "@/lib/supabase";

const SESSION_STORAGE_KEY = "constructiq_session_activity_id";

function randomSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getSessionActivityId() {
  if (typeof window === "undefined") return "";
  let sessionId = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!sessionId) {
    sessionId = randomSessionId();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  }
  return sessionId;
}

export function clearSessionActivityId() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

async function authToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || "";
}

async function postSessionActivity(endpoint: string) {
  const token = await authToken();
  const sessionId = getSessionActivityId();
  if (!token || !sessionId) return false;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ session_id: sessionId }),
  });
  return response.ok;
}

export async function startSessionActivity() {
  return postSessionActivity("/api/auth/session/start");
}

export async function heartbeatSessionActivity() {
  return postSessionActivity("/api/auth/session/heartbeat");
}

export async function logoutSessionActivity() {
  try {
    await postSessionActivity("/api/auth/session/logout");
  } finally {
    clearSessionActivityId();
  }
}
