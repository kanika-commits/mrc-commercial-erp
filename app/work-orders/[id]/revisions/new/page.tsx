"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function PilotRevisionPage() {
  const params = useParams(); const router = useRouter(); const id = params.id as string;
  const [message, setMessage] = useState("");
  useEffect(() => { (async () => { const session = (await supabase.auth.getSession()).data.session; const response = await fetch(`/api/work-orders/${id}/revisions`, { headers: { Authorization: `Bearer ${session?.access_token || ""}` } }); const result = await response.json(); if (!response.ok) { setMessage(result.error || "Unable to open revision."); return; } const revision = result.revisions?.find((row: any) => row.status === "draft") || result.revisions?.at(-1); if (revision) { router.replace(`/work-orders/new/structured?revision=${encodeURIComponent(revision.id)}&work_order=${encodeURIComponent(id)}`); return; } const create = await fetch(`/api/work-orders/${id}/revisions`, { method: "POST", headers: { Authorization: `Bearer ${session?.access_token || ""}`, "Content-Type": "application/json" }, body: JSON.stringify({ applicable_date: new Date().toISOString().slice(0, 10), creation_request_id: crypto.randomUUID() }) }); const created = await create.json(); if (!create.ok) setMessage(created.error || "Unable to create revision draft."); else router.replace(`/work-orders/new/structured?revision=${encodeURIComponent(created.revision.id)}&work_order=${encodeURIComponent(id)}`); })().catch(error => setMessage(error.message || "Pilot revision schema is unavailable.")); }, [id, router]);
  return <main className="mx-auto max-w-5xl p-8">{message && <p className="text-sm text-red-700">{message}</p>}</main>;
}
