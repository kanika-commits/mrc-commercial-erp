"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const REQUEST_TIMEOUT_MS = 20000;
const displayValue = (...values: unknown[]) => values.map((value) => String(value ?? "").trim()).find(Boolean) || "";
function requestWithTimeout(path: string, headers: HeadersInit) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(path, { headers, signal: controller.signal }).finally(() => window.clearTimeout(timer));
}

export default function WorkOrderDraftDetailPage() {
  const params = useParams<{ id: string }>();
  const draftId = params.id;
  const [draft, setDraft] = useState<any>(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [draftLoading, setDraftLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [error, setError] = useState("");
  const [pdfError, setPdfError] = useState("");

  const loadDraft = useCallback(async (cancelled: { current: boolean }) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Your session expired. Please log in again.");
    const response = await requestWithTimeout(`/api/work-orders/drafts/${encodeURIComponent(draftId)}`, { Authorization: `Bearer ${session.access_token}` });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The Work Order draft could not be loaded.");
    if (!cancelled.current) setDraft(payload);
  }, [draftId]);

  const loadPdf = useCallback(async (cancelled: { current: boolean } = { current: false }) => {
    setPdfLoading(true); setPdfError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Your session expired. Please log in again.");
      const response = await requestWithTimeout(`/api/work-orders/drafts/${encodeURIComponent(draftId)}/preview`, { Authorization: `Bearer ${session.access_token}` });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || "The Work Order draft PDF could not be loaded."); }
      if (!contentType.toLowerCase().includes("application/pdf")) throw new Error("The Work Order draft preview did not return a PDF.");
      const url = URL.createObjectURL(await response.blob());
      if (cancelled.current) return URL.revokeObjectURL(url);
      setPdfUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return url; });
    } catch (reason: any) {
      if (!cancelled.current) setPdfError(reason?.name === "AbortError" ? "The saved PDF took too long to load. Retry when ready." : reason.message || "The Work Order draft PDF could not be loaded.");
    } finally { if (!cancelled.current) setPdfLoading(false); }
  }, [draftId]);

  const loadPage = useCallback(() => {
    const cancelled = { current: false };
    setDraftLoading(true); setError("");
    void loadDraft(cancelled).catch((reason: any) => { if (!cancelled.current) setError(reason.message || "The Work Order draft could not be loaded."); }).finally(() => { if (!cancelled.current) setDraftLoading(false); });
    void loadPdf(cancelled);
    return () => { cancelled.current = true; };
  }, [loadDraft, loadPdf]);

  useEffect(() => loadPage(), [loadPage]);
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  const title = displayValue(draft?.wo_number, draft?.work_order_number) || "Work Order Draft";
  const vendor = displayValue(draft?.vendor_snapshot?.vendor_name, draft?.vendor_name, draft?.vendors?.vendor_name);
  const downloadName = `${String(draft?.wo_number || "work-order").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "work-order"}-draft.pdf`;
  return <main data-testid="work-order-draft-detail" className="mx-auto max-w-7xl space-y-5 p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><Link href="/work-orders" className="text-sm text-slate-600 hover:underline">Back to Work Orders</Link><h1 className="mt-2 text-3xl font-bold">{title}</h1><p className="text-sm text-slate-600">{vendor && `${vendor} · `}Draft — Not submitted</p></div><div className="flex flex-wrap gap-2"><Link href={`/work-orders/new/structured?draft=${encodeURIComponent(draftId)}`} className="rounded-lg border px-4 py-2 text-sm font-semibold">Edit Draft</Link><Link href={`/work-orders/new/structured?draft=${encodeURIComponent(draftId)}&submit=1`} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Submit for Approval</Link>{pdfUrl && <a href={pdfUrl} download={downloadName} target="_blank" rel="noreferrer" className="rounded-lg border px-4 py-2 text-sm font-semibold">View / Download Work Order PDF</a>}</div></div>
    {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert"><p>{error}</p><button type="button" onClick={loadPage} className="mt-3 rounded border border-red-300 bg-white px-3 py-2 font-semibold">Retry draft</button></div>}
    {!draftLoading && !error && pdfError && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800" role="alert"><p>{pdfError}</p><button type="button" onClick={() => void loadPdf()} className="mt-3 rounded border border-amber-300 bg-white px-3 py-2 font-semibold">Retry PDF</button></div>}
    {pdfUrl ? <section className="space-y-3"><iframe data-testid="work-order-draft-pdf" title="Work Order draft PDF preview" src={pdfUrl} className="h-[78vh] w-full rounded-xl border bg-slate-100" /><a href={pdfUrl} download={downloadName} className="inline-flex rounded border px-3 py-2 text-sm font-semibold">Download PDF</a></section> : pdfLoading ? <p className="rounded-xl border bg-white p-8 text-sm text-slate-500">Loading saved draft PDF…</p> : null}
  </main>;
}
