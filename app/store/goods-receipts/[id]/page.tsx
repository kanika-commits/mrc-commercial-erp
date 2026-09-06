"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import AlertMessage from "@/components/AlertMessage";
import { apiFetch } from "@/components/hr/hrClient";
import GoodsReceiptWorkflowSections from "@/components/procurement/GoodsReceiptWorkflowSections";

function quantityInputValue(value: unknown): string | number {
  return value === "" || value === undefined || value === null || Number(value) === 0 ? "" : String(value);
}

function itemReceiptState(item: any, finalized: boolean) {
  const acceptedAfter = Number(item.previously_accepted_quantity || 0) + (finalized ? Number(item.accepted_quantity || 0) : 0);
  const remainingAfter = Math.max(Number(item.ordered_quantity_snapshot || 0) - acceptedAfter, 0);
  return { acceptedAfter, remainingAfter, status: remainingAfter <= 0 ? "Received All" : acceptedAfter > 0 ? "Partially Received" : "Not Received" };
}

function lineError(item: any) {
  const values = ["received_quantity", "accepted_quantity", "rejected_quantity", "hold_quantity"].map((key) => Number(item[key] || 0));
  const [received, accepted, rejected] = values;
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return "Quantities must be non-negative numbers.";
  if (received !== values[1] + values[2] + values[3]) return "Received quantity must equal Accepted + Rejected + Pending Inspection.";
  if (accepted > Number(item.remaining_quantity_snapshot || 0)) return "Accepted quantity cannot exceed the remaining PO quantity.";
  if (rejected > 0 && !String(item.rejection_reason || "").trim()) return "Enter a rejection reason before finalizing this receipt.";
  return "";
}

function draftItems(items: any[]) {
  return items.map((item: any) => {
    const draft = { ...item, received_quantity: Number(item.received_quantity || 0), accepted_quantity: Number(item.accepted_quantity || 0), rejected_quantity: Number(item.rejected_quantity || 0), hold_quantity: Number(item.hold_quantity || 0) };
    delete draft.remarks;
    delete draft.weight_reconciliation_remarks;
    delete draft.weight_reconciliation_status;
    delete draft.received_quantity_kg;
    delete draft.weighbridge_net_kg;
    delete draft.weight_difference_kg;
    return draft;
  });
}

export default function GoodsReceiptDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [grn, setGrn] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState("Saved");
  const [receivedProvenance, setReceivedProvenance] = useState<Record<string, any>>({});
  const [blockingDocumentMismatch, setBlockingDocumentMismatch] = useState(false);
  const hydrated = useRef(false);
  const saveSequence = useRef(0);

  async function load() {
    try {
      const next = (await apiFetch(`/api/procurement/goods-receipts/${id}`)).grn;
      setGrn(next);
      hydrated.current = true;
      setSaveState("Saved");
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  useEffect(() => { void load(); }, [id]);
  useEffect(() => {
    if (!grn || !hydrated.current || grn.status !== "draft") return;
    const sequence = ++saveSequence.current;
    setSaveState("Saving");
    const timer = window.setTimeout(async () => {
      try {
        await saveDraft(draftItems(grn.items || []));
        if (sequence === saveSequence.current) setSaveState("Saved");
      } catch {
        if (sequence === saveSequence.current) setSaveState("Save failed");
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [grn]);

  function updateItem(itemId: string, key: string, value: string) {
    if (key === "received_quantity" && receivedProvenance[itemId] && String(value) !== String(receivedProvenance[itemId].suggestedValue)) {
      setReceivedProvenance((current) => ({ ...current, [itemId]: { ...current[itemId], source: "manual", dirty: true } }));
    }
    setGrn((current: any) => ({ ...current, items: current.items.map((item: any) => item.id === itemId ? { ...item, [key]: value } : item) }));
  }

  async function saveDraft(items = draftItems(grn.items || [])) {
    await apiFetch(`/api/procurement/goods-receipts/${id}`, { method: "PUT", body: JSON.stringify({ ...grn, items }) });
    await Promise.all(Object.entries(receivedProvenance).map(([itemId, provenance]: [string, any]) => {
      const item = items.find((candidate: any) => candidate.id === itemId);
      if (!item || !provenance.source) return Promise.resolve();
      return apiFetch(`/api/procurement/goods-receipts/${id}/verified-values`, { method: "POST", body: JSON.stringify({ field_name: "received_quantity", final_value: String(item.received_quantity), source_type: provenance.source === "manual" ? "manual" : "ocr", original_extracted_value: provenance.suggestedValue, document_id: provenance.documentId }) });
    }));
  }

  async function save() {
    setSaving(true);
    try {
      await saveDraft();
      setMessage("Draft saved successfully.");
      await load();
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function finalize() {
    const invalid = (grn?.items || []).filter((item: any) => lineError(item));
    if (invalid.length) {
      setMessage(`${invalid.length} receipt line${invalid.length === 1 ? "" : "s"} need correction before finalization.`);
      return;
    }
    if (blockingDocumentMismatch) {
      setMessage("Delivery Challan materials do not match the Purchase Order. Remove or replace the document, or enter the received quantity manually after verification.");
      return;
    }
    setSaving(true);
    try {
      await saveDraft();
      await apiFetch(`/api/procurement/goods-receipts/${id}`, { method: "POST", body: JSON.stringify({ action: "finalize" }) });
      setMessage("Receipt finalized successfully.");
      await load();
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  if (!grn) return <p className="text-sm text-slate-500">{message || "Loading receipt workflow..."}</p>;

  const locked = grn.status !== "draft";
  const finalized = grn.status === "finalized";

  return <section className="space-y-6">
    <Link href="/store/goods-receipts" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950"><ArrowLeft className="h-4 w-4" />Back to Purchase Order Tracking</Link>
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase text-emerald-700">Record Receipt</p><h1 className="mt-1 text-3xl font-bold">{grn.grn_number}</h1><p className="text-sm text-slate-500">Purchase Order {grn.purchase_order?.po_number || "-"} - {grn.company?.company_name || "-"} - {grn.site?.site_name || "-"}</p></div><div className="text-right"><span className="rounded-full border px-3 py-1 text-xs font-semibold">{locked ? "Finalized" : "Draft"}</span><p className="mt-2 text-xs text-slate-500">{saveState}</p></div></header>
    <AlertMessage type={saveState === "Save failed" ? "error" : "warning"} message={message} onClose={() => setMessage("")} />
    <GoodsReceiptWorkflowSections grn={grn} onChange={setGrn} disabled={locked} onReceivedSuggestions={(suggestions) => setReceivedProvenance((current) => ({ ...Object.fromEntries(Object.entries(current).filter(([, provenance]: [string, any]) => provenance.source === "manual")), ...suggestions }))} onDocumentMismatch={(_mismatch, blockingMismatch) => setBlockingDocumentMismatch(blockingMismatch)}>
      <div className="mt-4 hidden max-w-full overflow-x-auto md:block">
        <table className="w-full min-w-[1250px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase"><tr>{["Material", "Specification", "Make / Brand", "UOM", "PO Qty", "Previously Accepted", "Remaining to Accept", "Receipt Status", "Received Now", "Accepted Now", "Rejected Now", "Hold / Pending Inspection", "Rejection Reason"].map((heading) => <th key={heading} className="p-3">{heading}</th>)}</tr></thead><tbody className="divide-y">{(grn.items || []).map((item: any) => { const state = itemReceiptState(item, finalized); const suggestion = receivedProvenance[item.id]; return <tr key={item.id} className={`align-top ${state.status === "Received All" ? "bg-emerald-50/40" : ""}`}><td className="p-3 font-semibold">{item.item_name_snapshot}</td><td className="p-3">{item.specification_snapshot || "-"}</td><td className="p-3">{item.make_snapshot || "-"}</td><td className="p-3">{item.uom_snapshot || "-"}</td><td className="p-3">{item.ordered_quantity_snapshot}</td><td className="p-3">{item.previously_accepted_quantity}</td><td className="p-3">{state.remainingAfter}</td><td className="whitespace-nowrap p-3"><span className={`whitespace-nowrap rounded-full border px-2 py-1 text-xs font-semibold ${state.status === "Received All" ? "border-emerald-200 bg-emerald-100 text-emerald-800" : state.status === "Partially Received" ? "border-amber-200 bg-amber-100 text-amber-800" : "border-slate-200 bg-slate-100 text-slate-700"}`}>{state.status}</span></td>{["received_quantity", "accepted_quantity", "rejected_quantity", "hold_quantity"].map((key) => <td key={key} className="p-3"><input disabled={locked || item.remaining_quantity_snapshot <= 0} type="number" min="0" step="0.001" value={quantityInputValue(item[key])} onChange={(event) => updateItem(item.id, key, event.target.value)} className="h-9 w-28 rounded border px-2" />{key === "received_quantity" && suggestion?.overRemaining && <p className="mt-1 max-w-32 text-xs font-normal text-amber-700">Document quantity exceeds remaining PO quantity. Verify manually.</p>}{key === "received_quantity" && suggestion?.ambiguous && <p className="mt-1 max-w-32 text-xs font-normal text-amber-700">Conflicting document quantities. Enter manually.</p>}{key === "received_quantity" && suggestion && !suggestion.overRemaining && !suggestion.ambiguous && !suggestion.dirty && <p className="mt-1 text-xs font-normal text-emerald-700">Suggested from {suggestion.source === "invoice" ? "Invoice" : "Delivery Challan"}</p>}{key === "received_quantity" && !finalized && lineError(item) && <p className="mt-1 max-w-56 text-xs font-normal text-red-700">{lineError(item)}</p>}</td>)}<td className="p-3"><input disabled={locked || Number(item.rejected_quantity || 0) <= 0} value={item.rejection_reason || ""} onChange={(event) => updateItem(item.id, "rejection_reason", event.target.value)} className="h-9 w-44 rounded border px-2" /></td></tr>; })}</tbody></table>
      </div>
      <div className="mt-4 space-y-4 md:hidden">{(grn.items || []).map((item: any) => { const state = itemReceiptState(item, finalized); const suggestion = receivedProvenance[item.id]; return <section key={item.id} className="rounded-lg border bg-slate-50 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{item.item_name_snapshot}</h3><p className="mt-1 text-xs text-slate-500">{item.specification_snapshot || "-"} - {item.make_snapshot || "-"} - {item.uom_snapshot || "-"}</p></div><span className={`whitespace-nowrap rounded-full border px-2 py-1 text-xs font-semibold ${state.status === "Received All" ? "border-emerald-200 bg-emerald-100 text-emerald-800" : state.status === "Partially Received" ? "border-amber-200 bg-amber-100 text-amber-800" : "border-slate-200 bg-slate-100 text-slate-700"}`}>{state.status}</span></div><div className="mt-3 grid grid-cols-3 gap-2 text-xs"><p>PO Qty<br /><strong>{item.ordered_quantity_snapshot}</strong></p><p>Accepted<br /><strong>{item.previously_accepted_quantity}</strong></p><p>Remaining<br /><strong>{state.remainingAfter}</strong></p></div><div className="mt-4 grid grid-cols-2 gap-3">{["received_quantity", "accepted_quantity", "rejected_quantity", "hold_quantity"].map((key) => <label key={key} className="text-xs font-semibold">{key === "received_quantity" ? "Received Now" : key === "accepted_quantity" ? "Accepted Now" : key === "rejected_quantity" ? "Rejected Now" : "Hold"}<input disabled={locked || item.remaining_quantity_snapshot <= 0} type="number" min="0" step="0.001" value={quantityInputValue(item[key])} onChange={(event) => updateItem(item.id, key, event.target.value)} className="mt-1 h-10 w-full rounded border bg-white px-2" />{key === "received_quantity" && suggestion?.overRemaining && <p className="mt-1 font-normal text-amber-700">Document quantity exceeds remaining PO quantity. Verify manually.</p>}{key === "received_quantity" && suggestion?.ambiguous && <p className="mt-1 font-normal text-amber-700">Conflicting document quantities. Enter manually.</p>}{key === "received_quantity" && suggestion && !suggestion.overRemaining && !suggestion.ambiguous && !suggestion.dirty && <p className="mt-1 font-normal text-emerald-700">Suggested from {suggestion.source === "invoice" ? "Invoice" : "Delivery Challan"}</p>}{key === "received_quantity" && !finalized && lineError(item) && <p className="mt-1 font-normal text-red-700">{lineError(item)}</p>}</label>)}</div><label className="mt-3 block text-xs font-semibold">Rejection Reason<input disabled={locked || Number(item.rejected_quantity || 0) <= 0} value={item.rejection_reason || ""} onChange={(event) => updateItem(item.id, "rejection_reason", event.target.value)} className="mt-1 h-10 w-full rounded border bg-white px-2" /></label></section>; })}</div>
    </GoodsReceiptWorkflowSections>
    {!locked && <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-white/95 p-3 shadow-lg backdrop-blur"><button disabled={saving} onClick={() => void save()} className="rounded border px-4 py-2 text-sm font-semibold">Save Draft</button><button disabled={saving} onClick={() => void finalize()} className="rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Finalize Receipt</button><span className="text-xs text-slate-500">{saveState}</span></div>}
  </section>;
}
