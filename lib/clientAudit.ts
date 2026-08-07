"use client";

import { supabase } from "@/lib/supabase";

type ClientAuditEvent = {
  eventType: "view_page" | "view_record" | "view_document" | "download_document" | "export" | "print";
  entityType: string;
  recordId?: string;
  documentId?: string;
  pageKey?: string;
  source?: string;
  context?: Record<string, unknown>;
};

const recentEvents = new Map<string, number>();
const DEDUPE_WINDOW_MS = 15_000;

export function recordClientAuditEvent(event: ClientAuditEvent) {
  if (typeof window === "undefined") return;
  const key = [event.eventType, event.entityType, event.recordId || "", event.documentId || "", event.pageKey || ""].join(":");
  const now = Date.now();
  const previous = recentEvents.get(key);
  if (previous && now - previous < DEDUPE_WINDOW_MS) return;
  recentEvents.set(key, now);
  for (const [entry, timestamp] of recentEvents) {
    if (now - timestamp >= DEDUPE_WINDOW_MS) recentEvents.delete(entry);
  }

  void (async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    await fetch("/api/audit/client-event", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: event.eventType,
        entity_type: event.entityType,
        record_id: event.recordId,
        document_id: event.documentId,
        page_key: event.pageKey,
        source: event.source,
        context: event.context,
      }),
      keepalive: true,
    });
  })().catch(() => undefined);
}
