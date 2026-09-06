"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, getAccessToken } from "@/components/hr/hrClient";
import { useAccessContext } from "@/components/AccessContext";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { parsePurchaseOrderStandardTerms } from "@/lib/procurement/standardTerms";

function display(value: unknown) {
  return value === null || value === undefined || String(value).trim() === "" ? "—" : String(value);
}

function money(value: unknown) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function date(value: unknown) {
  const raw = String(value || "");
  if (!raw) return "—";
  const parts = raw.slice(0, 10).split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : raw;
}

function Field({ label, value }: { label: string; value: unknown }) {
  return <div><dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</dt><dd className="mt-1 text-sm text-slate-800">{display(value)}</dd></div>;
}

function AddressBlock({ title, address, contactLabel }: { title: string; address: any; contactLabel: string }) {
  const contact = address?.contact || address?.delivery_contact || {};
  return <section>
    <h2 className="border-b border-slate-300 pb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-700">{title}</h2>
    <dl className="mt-3 grid gap-3 text-sm">
      <Field label="Company" value={address?.company_name || address?.company} />
      <Field label="GSTIN" value={address?.gstin} />
      <Field label="Address" value={address?.address || [address?.address_line1, address?.address_line2, address?.city, address?.state, address?.pincode].filter(Boolean).join(", ")} />
      <Field label={contactLabel} value={contact?.contact_name || address?.contact_name} />
      <Field label="Mobile" value={contact?.mobile || address?.mobile} />
      <Field label="Email" value={contact?.email || address?.email} />
    </dl>
  </section>;
}

export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { access } = useAccessContext();
  const [row, setRow] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [packagePdfUrl, setPackagePdfUrl] = useState<string | null>(null);
  const [packagePdfLoading, setPackagePdfLoading] = useState(false);
  const [packageRefresh, setPackageRefresh] = useState(0);
  const [documents, setDocuments] = useState<any[]>([]);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [form, setForm] = useState({ po_date: "", delivery: {}, commercial: {}, standard_terms: "" });
  const [additionalCharges, setAdditionalCharges] = useState<Array<{ name: string; amount: string }>>([]);
  const [reasonAction, setReasonAction] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [approvalReview, setApprovalReview] = useState(false);

  async function load() {
    try {
      const [result, documentResult] = await Promise.all([
        apiFetch(`/api/procurement/purchase-orders/${id}`),
        apiFetch(`/api/procurement/purchase-orders/${id}/documents`),
      ]);
      setRow(result.purchase_order);
      setDocuments(documentResult.documents || []);
      setEditMode(false);
      setForm({ po_date: result.purchase_order.po_date || "", delivery: result.purchase_order.delivery_snapshot || {}, commercial: result.purchase_order.commercial_snapshot || {}, standard_terms: result.purchase_order.standard_terms_snapshot || "" });
      setAdditionalCharges(Array.isArray(result.purchase_order.commercial_snapshot?.additional_charges) ? result.purchase_order.commercial_snapshot.additional_charges.map((charge: any) => ({ name: String(charge.name || ""), amount: String(charge.amount ?? "") })) : []);
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  async function uploadDocument(file: File) {
    setDocumentLoading(true);
    try {
      const token = await getAccessToken();
      const form = new FormData();
      form.set("file", file);
      form.set("document_type", "other");
      form.set("sort_order", String(documents.length));
      const response = await fetch(`/api/procurement/purchase-orders/${id}/documents`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Failed to upload attachment.");
      setDocuments((current) => [result.document, ...current]);
      setPackageRefresh((current) => current + 1);
      setMessage("Supporting document uploaded successfully.");
    } catch (error: any) {
      setMessage(error.message || "Failed to upload attachment.");
    } finally {
      setDocumentLoading(false);
    }
  }

  async function reorderDocuments(documentId: string, direction: -1 | 1) {
    if (!row || row.status !== "draft") return;
    const index = documents.findIndex((document) => document.id === documentId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= documents.length) return;
    const next = [...documents];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setDocuments(next);
    try { await apiFetch(`/api/procurement/purchase-orders/${id}/documents`, { method: "PATCH", body: JSON.stringify({ document_ids: next.map((document) => document.id) }) }); setPackageRefresh((current) => current + 1); }
    catch (error: any) { setMessage(error.message || "Failed to reorder attachments."); await load(); }
  }

  async function deleteDocument(documentId: string) {
    if (!window.confirm("Remove this supporting document from the Draft Purchase Order?")) return;
    setDocumentLoading(true);
    try {
      await apiFetch(`/api/procurement/purchase-orders/${id}/documents?document_id=${encodeURIComponent(documentId)}`, { method: "DELETE" });
      setDocuments((current) => current.filter((document) => document.id !== documentId));
      setPackageRefresh((current) => current + 1);
      setMessage("Supporting document removed successfully.");
    } catch (error: any) {
      setMessage(error.message || "Failed to remove attachment.");
    } finally {
      setDocumentLoading(false);
    }
  }

  useEffect(() => { void load(); }, [id]);
  useEffect(() => {
    if (!row?.id) return;
    let cancelled = false;
    setPackagePdfLoading(true);
    void (async () => {
      try {
        const token = await getAccessToken();
        const response = await fetch(`/api/procurement/purchase-orders/${row.id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
        const result = response.ok ? null : await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result?.error || "Failed to load the Purchase Order package.");
        const nextUrl = URL.createObjectURL(await response.blob());
        if (cancelled) URL.revokeObjectURL(nextUrl);
        else setPackagePdfUrl((current) => { if (current) URL.revokeObjectURL(current); return nextUrl; });
      } catch (error: any) {
        if (!cancelled) setMessage(error.message || "Failed to load the Purchase Order package.");
      } finally { if (!cancelled) setPackagePdfLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [row?.id, packageRefresh]);
  useEffect(() => () => { if (packagePdfUrl) URL.revokeObjectURL(packagePdfUrl); }, [packagePdfUrl]);
  useEffect(() => { setApprovalReview(new URLSearchParams(window.location.search).get("review") === "1"); }, []);

  async function save() {
    setSaving(true);
    try { if (additionalCharges.some((charge) => !charge.name.trim() || !Number.isFinite(Number(charge.amount)) || Number(charge.amount) < 0)) throw new Error("Each additional charge needs a name and a valid non-negative amount."); await apiFetch(`/api/procurement/purchase-orders/${id}`, { method: "PUT", body: JSON.stringify({ ...form, commercial: { ...(form.commercial as any), additional_charges: additionalCharges.map((charge) => ({ name: charge.name.trim(), amount: Number(charge.amount) })) } }) }); await load(); setEditMode(false); setMessage("Purchase Order draft saved."); }
    catch (error: any) { setMessage(error.message); }
    finally { setSaving(false); }
  }

  async function action(actionName: string, note?: string) {
    setSaving(true);
    try { await apiFetch(`/api/procurement/purchase-orders/${id}`, { method: "POST", body: JSON.stringify({ action: actionName, note }) }); await load(); setReasonAction(null); setReason(""); if (actionName === "submit") { router.push("/purchase/purchase-orders?message=submitted"); return; } setMessage(`Purchase Order ${actionName.replace(/_/g, " ")} successful.`); }
    catch (error: any) { setMessage(error.message); }
    finally { setSaving(false); }
  }

  async function openPdf() {
    setPdfLoading(true);
    try {
      const token = await getAccessToken();
      const response = await fetch(`/api/procurement/purchase-orders/${row.id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "Failed to open Purchase Order PDF.");
      }
      const url = URL.createObjectURL(await response.blob());
      const popup = window.open(url, "_blank", "noopener,noreferrer");
      if (!popup) throw new Error("Please allow pop-ups to view the Purchase Order PDF.");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error: any) {
      setMessage(error.message || "Failed to open Purchase Order PDF.");
    } finally {
      setPdfLoading(false);
    }
  }

  if (!row) return <p className="text-sm text-slate-500">{message || "Loading Purchase Order..."}</p>;

  const locked = !["draft", "sent_back"].includes(row.status);
  const canApprove = hasGlobalAccess(access) || can(access?.permissions || [], "procurement_purchase_orders", "approve");
  const canReject = hasGlobalAccess(access) || can(access?.permissions || [], "procurement_purchase_orders", "reject");
  const sourceLabel = row.source_type === "indent" ? "Material Indent" : "Direct Purchase";
  const vendor = row.vendor_snapshot || {};
  const delivery = row.delivery_snapshot || {};
  const billing = delivery.billing_address || {};
  const shipping = delivery.delivery_location || delivery.shipping_address || delivery;
  const keyTerms = Array.isArray(row.commercial_snapshot?.key_terms) ? row.commercial_snapshot.key_terms : [];
  const standardTerms = parsePurchaseOrderStandardTerms(row.standard_terms_snapshot);
  const companyIdentity = `${row.company?.company_code || ""} ${row.company?.company_name || ""}`.toLowerCase();
  const isTechLetterhead = companyIdentity.includes("tech") || companyIdentity.includes("mrc-tech");
  const letterhead = isTechLetterhead ? {
    header: "/letterheads/mrc-tech-header.png",
    footer: "/letterheads/mrc-tech-footer.png",
  } : companyIdentity.includes("infracon") || companyIdentity.includes("mrc-infracon") ? {
    header: "/letterheads/mrc-infracon-header.png",
    footer: "/letterheads/mrc-infracon-footer.png",
  } : null;

  return <section className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <Link href="/purchase/purchase-orders" className="text-sm text-slate-500">← Purchase Orders</Link>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">{row.po_number}</h1>
        <p className="mt-1 text-sm text-slate-500">{display(row.company?.company_name)} · {sourceLabel}</p>
      </div>
      <span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-bold uppercase tracking-wide text-slate-700">{row.status.replace(/_/g, " ")}</span>
    </header>

    <div className="flex flex-wrap gap-2">
      {(!locked) && <Link href={`/purchase/purchase-orders/${row.id}/edit`} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Edit Draft</Link>}
      {(["draft", "sent_back"].includes(row.status)) && <button disabled={saving} onClick={() => action("submit")} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white">{row.status === "sent_back" ? "Resubmit for Approval" : "Submit for Approval"}</button>}
      {row.status === "pending_approval" && approvalReview && canApprove && <button disabled={saving} onClick={() => action("approve")} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Approve</button>}
      {row.status === "pending_approval" && approvalReview && canReject && <><button disabled={saving} onClick={() => setReasonAction("send_back")} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold">Send Back</button><button disabled={saving} onClick={() => setReasonAction("reject")} className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700">Reject</button></>}
      <button type="button" disabled={pdfLoading} onClick={openPdf} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold">{pdfLoading ? "Opening PDF..." : "View / Download PO PDF"}</button>
    </div>
    {message && <p className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">{message}</p>}
    {reasonAction && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4"><h2 className="font-semibold text-slate-900">{reasonAction === "reject" ? "Reject Purchase Order" : "Send Purchase Order Back"}</h2><p className="mt-1 text-sm text-slate-600">Enter a reason before continuing.</p><textarea value={reason} onChange={(event) => setReason(event.target.value)} className="mt-3 min-h-24 w-full rounded border border-amber-300 bg-white p-3 text-sm" placeholder="Reason" /><div className="mt-3 flex gap-2"><button type="button" disabled={!reason.trim() || saving} onClick={() => void action(reasonAction, reason.trim())} className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Confirm</button><button type="button" onClick={() => { setReasonAction(null); setReason(""); }} className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold">Cancel</button></div></div>}

    <section className="mx-auto w-full max-w-[900px] overflow-hidden border border-slate-300 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.08)] print:shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4"><div><h2 className="font-semibold">Purchase Order Package</h2><p className="mt-1 text-xs text-slate-500">Generated Purchase Order followed by included supporting PDF and image pages.</p></div>{row && ["draft", "sent_back"].includes(row.status) && <button type="button" onClick={() => setDocumentsOpen((current) => !current)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">{documentsOpen ? "Hide Supporting Documents" : "Manage Supporting Documents"}</button>}</div>
      {packagePdfLoading && <p className="p-5 text-sm text-slate-500">Loading Purchase Order package...</p>}
      {!packagePdfLoading && packagePdfUrl && <iframe title="Purchase Order package" src={packagePdfUrl} className="h-[1200px] w-full" />}
      {!packagePdfLoading && !packagePdfUrl && <p className="p-5 text-sm text-red-700">The Purchase Order package could not be loaded.</p>}
    </section>
    {row && letterhead && <article className="hidden relative mx-auto min-h-[1273px] w-full max-w-[900px] overflow-hidden border border-slate-300 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.08)] print:shadow-none">
      {letterhead && <><img src={letterhead.header} alt={isTechLetterhead ? "MRC Tech Solutions letterhead" : "MRC Infracon letterhead"} className="pointer-events-none absolute left-0 top-0 h-auto w-full object-contain" /><img src={letterhead.footer} alt="" className="pointer-events-none absolute bottom-0 left-0 h-auto w-full object-contain" /></>}
      <div className={`relative z-10 min-h-[1273px] px-8 sm:px-12 print:px-10 ${letterhead ? "pb-40 pt-48" : "pb-10 pt-10"}`}>
        <div className="border-b-2 border-slate-900 pb-5 text-center">
          <h2 className="mt-4 text-2xl font-bold tracking-[0.2em] text-slate-950">PURCHASE ORDER</h2>
        </div>

        <div className="mt-6 grid gap-0 border border-slate-400 md:grid-cols-[1.35fr_1fr]">
          <section className="border-b border-slate-400 p-5 md:border-b-0 md:border-r">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">Vendor Details</h3>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Vendor Name" value={row.vendor_name_snapshot} />
              <Field label="Contact Person" value={vendor.contact_person || vendor.contact_name} />
              <Field label="Address" value={vendor.address} />
              <Field label="Mobile" value={vendor.phone || vendor.mobile} />
              <Field label="Email" value={vendor.email} />
              <Field label="GSTIN" value={vendor.gstin} />
            </dl>
          </section>
          <section className="p-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">Purchase Order Details</h3>
            <dl className="mt-4 grid gap-3">
              <Field label="Purchase Order No" value={row.po_number} />
              <Field label="Date" value={date(row.po_date)} />
              <Field label="Company" value={row.company?.company_name} />
              <Field label="Site" value={row.site?.site_name} />
            </dl>
          </section>
        </div>

        <div className="mt-7 grid gap-6 border-b border-slate-300 pb-7 md:grid-cols-2">
          <AddressBlock title="Billing Address" address={billing} contactLabel="Contact Person" />
          <AddressBlock title="Shipping / Delivery Address" address={{ ...shipping, company_name: shipping.company_name || delivery.shipping_company_name || delivery.company, gstin: shipping.gstin || delivery.shipping_gstin, contact: delivery.delivery_contact }} contactLabel="Contact Person" />
        </div>

        <section className="mt-7">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-700">Items</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead><tr className="border-y-2 border-slate-700 bg-slate-50 text-xs uppercase tracking-wide"><th className="p-3">S.No.</th><th className="p-3">Material / Description</th><th className="p-3">Make</th><th className="p-3 text-right">Qty</th><th className="p-3">Unit</th><th className="p-3 text-right">Rate</th><th className="p-3 text-right">GST</th><th className="p-3 text-right">Amount</th></tr></thead>
              <tbody>{(row.items || []).map((item: any, index: number) => <tr key={item.id} className="border-b border-slate-200 align-top"><td className="p-3">{index + 1}</td><td className="p-3"><div className="font-semibold">{display(item.item_name_snapshot)}</div><div className="text-xs text-slate-500">{display(item.item_code_snapshot)}</div>{item.specification_snapshot && <div className="mt-1 whitespace-pre-wrap text-xs text-slate-500">{item.specification_snapshot}</div>}</td><td className="p-3">{display(item.make_snapshot)}</td><td className="p-3 text-right">{display(item.quantity)}</td><td className="p-3">{display(item.uom_snapshot)}</td><td className="p-3 text-right">{money(item.unit_rate)}</td><td className="p-3 text-right">{item.gst_rate || 0}%<br />{money(item.gst_amount)}</td><td className="p-3 text-right font-semibold">{money(item.total_amount)}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end">
            <dl className="w-full max-w-sm border-t border-slate-400 text-sm">
              <div className="flex justify-between border-b border-slate-200 py-2"><dt>Items Basic</dt><dd>{money(row.total_basic_amount)}</dd></div>
              <div className="flex justify-between border-b border-slate-200 py-2"><dt>GST</dt><dd>{money(row.total_gst_amount)}</dd></div>
              <div className="flex justify-between border-b border-slate-200 py-2"><dt>Freight</dt><dd>{money(row.total_freight_amount)}</dd></div>
              <div className="flex justify-between border-b-2 border-slate-700 py-3 font-bold"><dt>Grand Total</dt><dd>{money(row.total_amount)}</dd></div>
            </dl>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-700">Key Terms</h2>
          <table className="w-full border-collapse border border-slate-400 text-sm"><thead><tr className="bg-slate-50 text-left text-xs uppercase"><th className="w-14 border border-slate-300 p-3">S.No.</th><th className="w-1/3 border border-slate-300 p-3">Description</th><th className="border border-slate-300 p-3">Terms</th></tr></thead><tbody>{keyTerms.length ? keyTerms.map((term: any, index: number) => <tr key={`${term.description || "term"}-${index}`}><td className="border border-slate-300 p-3">{index + 1}</td><td className="border border-slate-300 p-3 font-semibold">{display(term.description || term.label)}</td><td className="border border-slate-300 p-3 whitespace-pre-wrap">{display(term.value || term.terms || term.text)}</td></tr>) : <tr><td colSpan={3} className="border border-slate-300 p-3 text-slate-500">No key terms added.</td></tr>}</tbody></table>
        </section>

        <section className="mt-8 border-t border-slate-300 pt-6">
          <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-slate-700">Terms &amp; Conditions</h2>
          <div className="mt-4 text-sm leading-6 text-slate-700">{!standardTerms ? "No standard terms added." : standardTerms.kind === "structured" ? <div className="space-y-4">{standardTerms.clauses.map((clause, index) => <div key={`${clause.sort_order}-${index}`}><p className="font-semibold">{index + 1}. {clause.heading}</p><p className="mt-1 whitespace-pre-wrap">{clause.clause_body}</p></div>)}</div> : <span className="whitespace-pre-wrap">{standardTerms.text}</span>}</div>
        </section>
      </div>
    </article>}

    {false && !locked && editMode && <section className="mx-auto w-full max-w-[900px] rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-semibold">Draft Actions</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <label className="text-sm">PO Date<input disabled={locked} type="date" value={form.po_date} onChange={(event) => setForm({ ...form, po_date: event.target.value })} className="mt-1 h-10 w-full rounded-lg border px-3" /></label>
        {Array.isArray((form.commercial as any)?.additional_charges) && <div className="text-sm md:col-span-2"><div className="flex items-center justify-between"><span>Additional Charges</span><button type="button" onClick={() => setAdditionalCharges((current) => [...current, { name: "", amount: "" }])} className="rounded border px-2 py-1 text-xs">+ Add Charge</button></div>{additionalCharges.map((charge, index) => <div key={index} className="mt-2 grid grid-cols-[1fr_140px_auto] gap-2"><input value={charge.name} onChange={(event) => setAdditionalCharges((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} className="h-10 rounded-lg border px-3" placeholder="Charge name" /><input type="number" min="0" step="0.01" value={charge.amount} onChange={(event) => setAdditionalCharges((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item))} className="h-10 rounded-lg border px-3" placeholder="Amount" /><button type="button" onClick={() => setAdditionalCharges((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="text-xs text-red-700">Remove</button></div>)}</div>}
        {!Array.isArray((form.commercial as any)?.additional_charges) && <label className="text-sm">Freight Amount<input disabled={locked} type="number" min="0" step="0.01" value={String((form.commercial as any)?.freight_amount ?? row.total_freight_amount ?? 0)} onChange={(event) => setForm({ ...form, commercial: { ...(form.commercial as any), freight_amount: event.target.value } })} className="mt-1 h-10 w-full rounded-lg border px-3" /></label>}
        <label className="text-sm md:col-span-2">Standard Terms<textarea disabled={locked} value={form.standard_terms} onChange={(event) => setForm({ ...form, standard_terms: event.target.value })} className="mt-1 min-h-24 w-full rounded-lg border p-2" /></label>
      </div>
      <div className="mt-4 flex gap-2"><button disabled={saving} onClick={save} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">{saving ? "Saving..." : "Save Draft"}</button><button type="button" disabled={saving} onClick={() => setEditMode(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">Cancel</button></div>
    </section>}
    {documentsOpen && <section className="mx-auto w-full max-w-[900px] rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-semibold">Supporting Documents</h2><p className="mt-1 text-xs text-slate-500">PDF and image files become part of the Purchase Order PDF. Word, Excel and text files remain available as separate attachments.</p></div>
        {row.status === "draft" && <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">{documentLoading ? "Uploading..." : "Add Files"}<input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.txt" className="sr-only" disabled={documentLoading} onChange={(event) => { const files = Array.from(event.target.files || []); void Promise.all(files.map(uploadDocument)); event.currentTarget.value = ""; }} /></label>}
      </div>
      {documents.length === 0 ? <p className="mt-4 text-sm text-slate-500">No supporting documents uploaded.</p> : <div className="mt-4 divide-y divide-slate-200">{documents.map((document, index) => <div key={document.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div className="min-w-0"><a href={document.signed_url} target="_blank" rel="noreferrer" className="font-semibold text-slate-900 underline">{document.original_file_name}</a><p className="mt-1 text-xs text-slate-500">{document.document_type} · {document.mime_type || "File"} · {document.size_bytes ? `${(document.size_bytes / (1024 * 1024)).toFixed(1)} MB` : "Size unavailable"} · {(["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(document.mime_type) ? "Included in PO PDF" : "Attachment only — not included in PO PDF")} · Uploaded by {document.created_by_name || document.created_by_email || "User"} on {date(document.created_at)}</p></div><div className="flex items-center gap-3">{row.status === "draft" && <><button type="button" disabled={documentLoading || index === 0} onClick={() => void reorderDocuments(document.id, -1)} className="text-xs font-semibold">Move Up</button><button type="button" disabled={documentLoading || index === documents.length - 1} onClick={() => void reorderDocuments(document.id, 1)} className="text-xs font-semibold">Move Down</button></>}<a href={document.signed_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-slate-700">View / Download</a>{row.status === "draft" && <button type="button" onClick={() => void deleteDocument(document.id)} disabled={documentLoading} className="text-xs font-semibold text-red-700">Remove</button>}</div></div>)}</div>}
    </section>}
  </section>;
}
