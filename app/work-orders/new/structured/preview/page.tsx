"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/components/hr/hrClient";
import { supabase } from "@/lib/supabase";
import { getWorkOrderPilotDraft } from "@/lib/workOrderPilotDraft.client";

export default function WorkOrderPilotPreviewPage() {
  const router = useRouter();
  const [draft] = useState(() => getWorkOrderPilotDraft());
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [availability, setAvailability] = useState<{ state: "idle" | "loading" | "available" | "blocked" | "error"; message: string }>({ state: "idle", message: "" });
  const searchParams = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const revisionId = searchParams.get("revision");
  const revisionWorkOrderId = searchParams.get("work_order");
  const draftId = searchParams.get("draft") || draft?.draftId || "";
  const [revisionPreviewUrl, setRevisionPreviewUrl] = useState("");

  useEffect(() => {
    if (revisionId || !draft?.payload?.vendor_id || !draft?.payload?.wo_type) {
      setAvailability({ state: "idle", message: "" });
      return;
    }
    let cancelled = false;
    setAvailability({ state: "loading", message: "Checking Work Order availability…" });
    apiFetch(`/api/work-orders/pilot/availability?vendor_id=${encodeURIComponent(draft.payload.vendor_id)}&wo_type=${encodeURIComponent(draft.payload.wo_type)}`)
      .then((result: any) => {
        if (cancelled) return;
        if (result?.available === false) setAvailability({ state: "blocked", message: result.message || "This vendor already has an active Work Order of this type. Create a revision instead." });
        else setAvailability({ state: "available", message: "" });
      })
      .catch((error: any) => {
        if (!cancelled) setAvailability({ state: "error", message: error.message || "Availability could not be verified. Try again before continuing." });
      });
    return () => { cancelled = true; };
  }, [draft, revisionId]);

  useEffect(() => {
    if (!revisionId || !revisionWorkOrderId) return;
    (async () => {
      const session = (await supabase.auth.getSession()).data.session;
      const response = await fetch(`/api/work-orders/${revisionWorkOrderId}/revisions/${revisionId}/preview`, { method: "POST", headers: { Authorization: `Bearer ${session?.access_token || ""}` } });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Could not load revised PDF preview.");
      setRevisionPreviewUrl(URL.createObjectURL(await response.blob()));
    })().catch((error: any) => setMessage(error.message));
  }, [revisionId, revisionWorkOrderId]);

  useEffect(() => {
    if (!draft && !revisionId) router.replace("/work-orders/new/structured");
  }, [draft, revisionId, router]);

  async function submitForApproval() {
    if (revisionId && revisionWorkOrderId) {
      setSaving(true); setMessage("");
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const response = await fetch(`/api/work-orders/${revisionWorkOrderId}/revisions/${revisionId}`, { method: "POST", headers: { Authorization: `Bearer ${session?.access_token || ""}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "submit" }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not submit revision for approval.");
        setMessage("Revision submitted for approval.");
        router.replace("/forms/work-orders");
      } catch (error: any) { setMessage(error.message); } finally { setSaving(false); }
      return;
    }
    if (!draft) return;
    if (availability.state !== "available") {
      setMessage(availability.state === "loading" ? "Checking Work Order availability…" : availability.message || "Availability could not be verified. Try again before continuing.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const previewParts = draft.previewUrl.match(/^data:application\/pdf;base64,(.+)$/);
      if (!previewParts?.[1]) throw new Error("The reviewed Work Order PDF preview is missing. Return to the form and generate a fresh preview.");
      if (!draftId) throw new Error("The Work Order draft was not saved. Return to the form and generate a fresh preview.");
      const result = await apiFetch(`/api/work-orders/drafts/${encodeURIComponent(draftId)}`, { method: "PATCH", body: JSON.stringify({ action: "submit", payload: { ...draft.payload, creation_request_id: draft.creationRequestId }, reviewed_pdf_base64: previewParts[1] }) });
      router.push(`/forms/work-orders`);
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  if (!draft && !revisionId) return <section className="mx-auto max-w-7xl rounded-2xl border bg-white p-6">Loading preview…</section>;

  return <section className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-sky-700">Work Orders</p><h1 className="text-3xl font-bold">{revisionId ? "Revised Work Order PDF Preview" : "Work Order PDF Preview"}</h1><p className="mt-1 text-sm text-slate-500">{revisionId ? "This is the exact PDF artifact that will be submitted for approval." : "This preview is backed by a saved draft. It has not been submitted or approved."}</p></div>
      <button type="button" onClick={() => router.push(draftId ? `/work-orders/new/structured?draft=${encodeURIComponent(draftId)}&from=preview` : "/work-orders/new/structured?from=preview")} className="rounded-xl border px-4 py-2 text-sm font-semibold">Back to Edit</button>
    </header>
    <section className="space-y-4 rounded-2xl border bg-white p-5">
      <iframe title="Work Order PDF preview" src={revisionPreviewUrl || draft?.previewUrl || "about:blank"} className="h-[82vh] w-full rounded-lg border" />
      {!revisionId && availability.state === "loading" && <p role="status" className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">Checking Work Order availability…</p>}
      {!revisionId && (availability.state === "blocked" || availability.state === "error") && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{availability.message || "Availability could not be verified. Try again before continuing."}</p>}
      {message && <p role="alert" className={`rounded-lg border p-3 text-sm ${message.toLowerCase().includes("submitted") ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>{message}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => router.push(revisionId ? `/work-orders/new/structured?revision=${revisionId}&work_order=${revisionWorkOrderId}` : draftId ? `/work-orders/new/structured?draft=${encodeURIComponent(draftId)}&from=preview` : "/work-orders/new/structured?from=preview")} className="rounded-xl border px-5 py-3 font-semibold">Back to Edit</button>
        <button type="button" onClick={() => void submitForApproval()} disabled={saving || Boolean(revisionId && !revisionPreviewUrl) || (!revisionId && availability.state !== "available")} className="rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white disabled:opacity-50">{saving ? "Submitting…" : revisionId ? "Submit for approval" : "Submit Work Order for Approval"}</button>
      </div>
    </section>
  </section>;
}
