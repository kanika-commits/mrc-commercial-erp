"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import { apiFetch } from "@/components/hr/hrClient";

type ItemForm = {
  item_header: string;
  description: string;
  unit: string;
  mode_of_measurement: string;
};

type ItemRow = ItemForm & { id: string; status?: string | null };

const emptyForm: ItemForm = { item_header: "", description: "", unit: "", mode_of_measurement: "" };

export default function EditWorkOrderItemMasterPage() {
  const { access, loading: accessLoading } = useAccessContext();
  const params = useParams();
  const router = useRouter();
  const id = String(params.id || "");
  const [form, setForm] = useState<ItemForm>(emptyForm);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const canEdit = Boolean(access?.roleCodes.includes("platform_owner") || can(access?.permissions || [], "procurement_items", "edit"));
  const accessDenied = Boolean(access && !canEdit);

  const loadItem = useCallback(async () => {
    try {
      const result = await apiFetch("/api/work-orders/item-masters") as { items?: ItemRow[] };
      const item = (result.items || []).find((candidate) => candidate.id === id);
      if (!item) throw new Error("Item was not found in your organization.");
      setForm({
        item_header: item.item_header || "",
        description: item.description || "",
        unit: item.unit || "",
        mode_of_measurement: item.mode_of_measurement || "",
      });
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Could not load Work Order Item Master.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (accessLoading || !access || !canEdit || !id) return;
    const timer = window.setTimeout(() => void loadItem(), 0);
    return () => window.clearTimeout(timer);
  }, [accessLoading, access, canEdit, id, loadItem]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    if (!form.item_header.trim() || !form.unit.trim() || !form.mode_of_measurement.trim()) {
      setMessage("Item Header, Unit, and Mode of Measurement are required.");
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/api/work-orders/item-masters", { method: "PATCH", body: JSON.stringify({ id, ...form }) });
      router.push("/work-orders/item-masters");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Could not update Work Order Item Master.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-gray-500">Loading Work Order Item Master...</p>;

  return <section className="max-w-3xl space-y-6"><header><p className="text-xs font-semibold uppercase text-emerald-700">Work Orders</p><h1 className="text-3xl font-bold">Edit Work Order Item Master</h1><p className="mt-1 text-sm text-slate-500">Changes apply to future Work Orders only; existing Work Order snapshots remain unchanged.</p></header>{(message || accessDenied) && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{message || "You do not have permission to edit Work Order Item Masters."}</div>}{canEdit && <form onSubmit={save} className="grid gap-4 rounded-2xl border bg-white p-6"><label className="text-sm font-semibold">Item Header<input required value={form.item_header} onChange={event => setForm({ ...form, item_header: event.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 font-normal" /></label><label className="text-sm font-semibold">Description<input value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 font-normal" /></label><label className="text-sm font-semibold">Unit<input required value={form.unit} onChange={event => setForm({ ...form, unit: event.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 font-normal" /></label><label className="text-sm font-semibold">Mode of Measurement<input required value={form.mode_of_measurement} onChange={event => setForm({ ...form, mode_of_measurement: event.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 font-normal" /></label><div className="flex justify-end gap-3"><Link href="/work-orders/item-masters" className="rounded-xl border px-4 py-2 text-sm font-semibold">Cancel</Link><button type="submit" disabled={saving} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save Changes"}</button></div></form>}</section>;
}
