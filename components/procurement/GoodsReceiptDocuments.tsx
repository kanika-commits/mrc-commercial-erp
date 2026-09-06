"use client";

import { useEffect, useState } from "react";
import { apiFetch, getAccessToken } from "@/components/hr/hrClient";

export default function GoodsReceiptDocuments({ grnId, status }: { grnId: string; status: string }) {
  const [docs, setDocs] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setDocs((await apiFetch(`/api/procurement/goods-receipts/${grnId}/documents`)).documents || []); }
    catch (error: any) { setMessage(error.message); }
  }

  useEffect(() => { void load(); }, [grnId]);

  async function upload(file: File) {
    setBusy(true); setMessage("");
    try {
      const token = await getAccessToken(); const body = new FormData(); body.set("file", file); body.set("document_type", "other");
      const response = await fetch(`/api/procurement/goods-receipts/${grnId}/documents`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Failed to upload document.");
      await load(); setMessage(`${file.name} uploaded successfully.`);
    } catch (error: any) { setMessage(`${file.name}: ${error.message || "Failed to upload document."}`); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    try { await apiFetch(`/api/procurement/goods-receipts/${grnId}/documents?document_id=${id}`, { method: "DELETE" }); setDocs((current) => current.filter((doc) => doc.id !== id)); }
    catch (error: any) { setMessage(error.message); }
  }

  return <section className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Supporting Documents</h2><p className="mt-1 text-xs text-slate-500">Challan, delivery, inspection and receiving evidence.</p></div>{status === "draft" && <label className="cursor-pointer rounded border px-3 py-2 text-sm font-semibold">{busy ? "Uploading..." : "Add Files"}<input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.txt" className="sr-only" disabled={busy} onChange={(event) => { const files = Array.from(event.target.files || []); event.currentTarget.value = ""; void (async () => { for (const file of files) await upload(file); })(); }} /></label>}</div>{message && <p className="mt-3 text-sm text-amber-800">{message}</p>}{docs.length === 0 ? <p className="mt-4 text-sm text-slate-500">No supporting documents uploaded.</p> : <div className="mt-4 divide-y">{docs.map((doc) => <div key={doc.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><a href={doc.signed_url} target="_blank" rel="noreferrer" className="font-semibold underline">{doc.original_file_name}</a><div className="flex gap-3"><a href={doc.signed_url} target="_blank" rel="noreferrer" className="text-xs font-semibold">View / Download</a>{status === "draft" && <button type="button" onClick={() => void remove(doc.id)} className="text-xs font-semibold text-red-700">Delete</button>}</div></div>)}</div>}</section>;
}
