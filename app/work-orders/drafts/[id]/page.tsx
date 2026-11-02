"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function WorkOrderDraftDetailPage() {
  const params = useParams<{ id: string }>();
  const [draft, setDraft] = useState<any>(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Your session expired. Please log in again.");
      const headers = { Authorization: `Bearer ${session.access_token}` };
      const [draftResponse, pdfResponse] = await Promise.all([
        fetch(`/api/work-orders/drafts/${params.id}`, { headers }),
        fetch(`/api/work-orders/drafts/${params.id}/preview`, { headers }),
      ]);
      const payload = await draftResponse.json().catch(() => ({}));
      if (!draftResponse.ok) throw new Error(payload.error || "The Work Order draft could not be loaded.");
      if (!pdfResponse.ok) throw new Error("The Work Order draft PDF could not be loaded.");
      const url = URL.createObjectURL(await pdfResponse.blob());
      if (cancelled) return URL.revokeObjectURL(url);
      setDraft(payload);
      setPdfUrl(url);
    })().catch((reason) => { if (!cancelled) setError(reason.message || "The Work Order draft could not be loaded."); });
    return () => { cancelled = true; };
  }, [params.id]);

  return <main data-testid="work-order-draft-detail" className="mx-auto max-w-7xl space-y-5 p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><Link href="/work-orders" className="text-sm text-slate-600 hover:underline">Back to Work Orders</Link><h1 className="mt-2 text-3xl font-bold">{draft?.wo_number || "Work Order Draft"}</h1><p className="text-sm text-amber-700">Draft — Not submitted</p></div>
      <div className="flex gap-2"><Link href={`/work-orders/new/structured?draft=${params.id}`} className="rounded-lg border px-4 py-2 text-sm font-semibold">Edit Draft</Link><Link href={`/work-orders/new/structured?draft=${params.id}&submit=1`} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Submit for Approval</Link></div>
    </div>
    {error && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {pdfUrl ? <iframe data-testid="work-order-draft-pdf" title="Work Order draft PDF preview" src={pdfUrl} className="h-[78vh] w-full rounded-xl border bg-slate-100" /> : <p className="rounded-xl border bg-white p-8 text-sm text-slate-500">Loading saved draft PDF…</p>}
  </main>;
}
