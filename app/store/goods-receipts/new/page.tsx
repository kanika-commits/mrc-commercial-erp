"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import AlertMessage from "@/components/AlertMessage";
import { apiFetch } from "@/components/hr/hrClient";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function draftFor(order: any) {
  return (order?.grns || [])
    .filter((receipt: any) => receipt.status === "draft")
    .sort((a: any, b: any) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
}

export default function NewGoodsReceiptPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedPo = searchParams.get("purchase_order_id") || "";
  const [orders, setOrders] = useState<any[]>([]);
  const [selectedPo, setSelectedPo] = useState(requestedPo);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(Boolean(requestedPo));
  const startedRef = useRef(false);

  const selectedOrder = useMemo(() => orders.find((order) => order.id === selectedPo), [orders, selectedPo]);

  async function startReceipt(orderId: string, loadedOrders = orders) {
    if (!orderId || startedRef.current) return;
    startedRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      const order = loadedOrders.find((item) => item.id === orderId);
      const existingDraft = draftFor(order);
      if (existingDraft?.id) {
        router.replace(`/store/goods-receipts/${existingDraft.id}`);
        return;
      }
      const date = today();
      const result = await apiFetch("/api/procurement/goods-receipts", {
        method: "POST",
        body: JSON.stringify({ purchase_order_id: orderId, grn_date: date, received_date: date, items: [] }),
      });
      router.replace(`/store/goods-receipts/${result.id}`);
    } catch (error: any) {
      startedRef.current = false;
      setBusy(false);
      setMessage(error.message || "Failed to start receipt workflow.");
    }
  }

  useEffect(() => {
    let mounted = true;
    apiFetch("/api/procurement/goods-receipts")
      .then((result) => {
        if (!mounted) return;
        const nextOrders = result.purchase_orders || [];
        setOrders(nextOrders);
        if (!requestedPo) {
          setBusy(false);
          return;
        }
        const order = nextOrders.find((item: any) => item.id === requestedPo);
        if (!order) {
          setBusy(false);
          setMessage("Selected Purchase Order is not available for receipt tracking.");
          return;
        }
        setSelectedPo(requestedPo);
        void startReceipt(requestedPo, nextOrders);
      })
      .catch((error) => {
        if (!mounted) return;
        setBusy(false);
        setMessage(error.message || "Failed to load Purchase Orders.");
      });
    return () => { mounted = false; };
  }, [requestedPo]);

  return <section className="mx-auto max-w-4xl space-y-6">
    <Link href={selectedPo ? `/store/goods-receipts/purchase-orders/${selectedPo}` : "/store/goods-receipts"} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950"><ArrowLeft className="h-4 w-4" />Back to Purchase Order Tracking</Link>
    <header>
      <p className="text-xs font-semibold uppercase text-emerald-700">Purchase Order Tracking</p>
      <h1 className="mt-1 text-3xl font-bold text-slate-950">Record Receipt</h1>
      <p className="mt-1 text-sm text-slate-500">Start a draft receipt, then continue in the guided receiving workflow.</p>
    </header>
    <AlertMessage type="error" message={message} onClose={() => setMessage("")} />
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      {busy ? <div className="flex items-center gap-3 text-sm font-semibold text-slate-700"><Loader2 className="h-5 w-5 animate-spin text-emerald-700" />Opening the receiving workflow...</div> : <div className="space-y-4">
        <label className="block text-sm font-semibold">Approved / Issued Purchase Order
          <select value={selectedPo} onChange={(event) => { setSelectedPo(event.target.value); setMessage(""); }} className="mt-1 h-10 w-full rounded border px-3">
            <option value="">Select Purchase Order</option>
            {orders.map((order) => <option key={order.id} value={order.id}>{order.po_number} - {order.vendor_name_snapshot} - {order.site?.site_name}</option>)}
          </select>
        </label>
        {selectedOrder && <div className="rounded-lg border bg-slate-50 p-4 text-sm text-slate-700">
          <p className="font-semibold text-slate-950">{selectedOrder.po_number}</p>
          <p>{selectedOrder.company?.company_name || "-"} - {selectedOrder.site?.site_name || "-"} - {selectedOrder.vendor_name_snapshot || "-"}</p>
          {draftFor(selectedOrder) && <p className="mt-2 text-sky-700">A draft receipt already exists. Continue that receipt to avoid duplicates.</p>}
        </div>}
        <button type="button" disabled={!selectedPo} onClick={() => void startReceipt(selectedPo)} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><Plus className="h-4 w-4" />Open Receiving Workflow</button>
      </div>}
    </section>
  </section>;
}
