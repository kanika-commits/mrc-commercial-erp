"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/components/hr/hrClient";
import { getWorkOrderPilotDraft } from "@/lib/workOrderPilotDraft.client";

export default function WorkOrderPilotPreviewPage() {
  const router = useRouter();
  const [draft] = useState(() => getWorkOrderPilotDraft());
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!draft) router.replace("/work-orders/new/structured");
  }, [draft, router]);

  async function submitForApproval() {
    if (!draft) return;
    setSaving(true);
    setMessage("");
    try {
      const submitForm = new FormData();
      const previewParts = draft.previewUrl.match(/^data:application\/pdf;base64,(.+)$/);
      if (!previewParts?.[1]) throw new Error("The reviewed Work Order PDF preview is missing. Return to the form and generate a fresh preview.");
      submitForm.append("payload", JSON.stringify({ ...draft.payload, creation_request_id: draft.creationRequestId }));
      submitForm.append("reviewed_pdf_base64", previewParts[1]);
      draft.supportingDocuments.forEach((file) => submitForm.append("supporting_documents", file, file.name));
      const result = await apiFetch("/api/work-orders/create", { method: "POST", body: submitForm });
      router.push(`/work-orders/${result.workOrder.id}`);
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  if (!draft) return <section className="mx-auto max-w-7xl rounded-2xl border bg-white p-6">Loading preview…</section>;

  return <section className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-sky-700">Work Orders</p><h1 className="text-3xl font-bold">Work Order PDF Preview</h1><p className="mt-1 text-sm text-slate-500">Preview only. No database record has been created.</p></div>
      <button type="button" onClick={() => router.push("/work-orders/new/structured?from=preview")} className="rounded-xl border px-4 py-2 text-sm font-semibold">Back to Edit</button>
    </header>
    <section className="space-y-4 rounded-2xl border bg-white p-5">
      <iframe title="Work Order PDF preview" src={draft.previewUrl} className="h-[82vh] w-full rounded-lg border" />
      {message && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{message}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => router.push("/work-orders/new/structured?from=preview")} className="rounded-xl border px-5 py-3 font-semibold">Back to Edit</button>
        <button type="button" onClick={() => void submitForApproval()} disabled={saving} className="rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white disabled:opacity-50">{saving ? "Submitting…" : "Submit Work Order for Approval"}</button>
      </div>
    </section>
  </section>;
}
