"use client";

// Structured Work Order form route.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/components/hr/hrClient";
import { getWorkOrderPilotDraft, setWorkOrderPilotDraft } from "@/lib/workOrderPilotDraft.client";

type Line = { item_master_id: string; additional_description: string; quantity: string; unit_rate: string; gst_percent: string };
type KeyTerms = { inclusions: string[]; exclusions: string[]; additional: Array<{ label: string; value: string }> };

const emptyLine = (): Line => ({ item_master_id: "", additional_description: "", quantity: "", unit_rate: "", gst_percent: "0" });
const money = (n: number) => `₹ ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function NewWorkOrderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftId = searchParams.get("draft");
  const returningFromPreview = searchParams.get("from") === "preview";
  const preservedPreviewDraft = returningFromPreview ? getWorkOrderPilotDraft() : null;
  const [lookups, setLookups] = useState<any>({ companies: [], sites: [], vendors: [], items: [], letterheads: [], terms_templates: [], gst_billing_masters: [], billing_addresses: [], delivery_locations: [], site_contacts: [] });
  const [form, setForm] = useState<any>(() => preservedPreviewDraft?.form || ({ company_id: "", site_id: "", vendor_id: "", vendor_role: "Main Contractor", wo_number: "", wo_date: new Date().toISOString().slice(0, 10), wo_type: "Consultant", description: "", letterhead_id: "", terms_template_id: "", standard_terms_snapshot: "", gst_registration_id: "", billing_address_id: "", delivery_location_id: "", billing_contact_id: "", delivery_contact_id: "" }));
  const [keyTerms, setKeyTerms] = useState<KeyTerms>(() => (preservedPreviewDraft?.keyTerms as KeyTerms) || ({ inclusions: [""], exclusions: [""], additional: [] }));
  const [lines, setLines] = useState<Line[]>(() => (preservedPreviewDraft?.lines as Line[]) || [emptyLine()]);
  const [message, setMessage] = useState("");
  const [numberError, setNumberError] = useState("");
  const [numberLoading, setNumberLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [numberEdited, setNumberEdited] = useState(false);
  const [lookupRetry, setLookupRetry] = useState(0);
  const [lookupLoading, setLookupLoading] = useState(true);
  const [supportingDocuments, setSupportingDocuments] = useState<File[]>(() => preservedPreviewDraft?.supportingDocuments || []);

  useEffect(() => {
    setLookupLoading(true);
    apiFetch("/api/work-orders/create-lookups").then((result: any) => {
      setLookups({ companies: [], sites: [], vendors: [], items: [], letterheads: [], terms_templates: [], gst_billing_masters: [], billing_addresses: [], delivery_locations: [], site_contacts: [], ...result });
      const failures = (result.lookup_errors || []).map((entry: any) => entry.message).join(" ");
      setMessage(failures);
    }).catch((e: any) => setMessage(e.message)).finally(() => setLookupLoading(false));
  }, [lookupRetry]);

  useEffect(() => {
    if (!draftId) return;
    apiFetch(`/api/work-orders/drafts/${draftId}`).then((draft: any) => {
      const selection = draft.delivery_snapshot?.master_selection || {};
      setForm({ company_id: draft.company_id || "", site_id: draft.site_id || "", vendor_id: draft.vendor_id || "", vendor_role: draft.vendor_role || "Main Contractor", wo_number: draft.wo_number || "", wo_date: draft.wo_date || "", wo_type: draft.wo_type || "", description: draft.description || "", letterhead_id: draft.letterhead_id || "", terms_template_id: draft.terms_template_id || "", standard_terms_snapshot: draft.standard_terms_snapshot || "", gst_registration_id: selection.gst_registration_id || "", billing_address_id: selection.billing_address_id || "", delivery_location_id: selection.delivery_location_id || "", billing_contact_id: selection.billing_contact_id || "", delivery_contact_id: selection.delivery_contact_id || "" });
      const savedTerms = draft.work_order_key_terms || {};
      setKeyTerms({ inclusions: Array.isArray(savedTerms.inclusions) && savedTerms.inclusions.length ? savedTerms.inclusions : [""], exclusions: Array.isArray(savedTerms.exclusions) && savedTerms.exclusions.length ? savedTerms.exclusions : [""], additional: Array.isArray(savedTerms.additional) ? savedTerms.additional : [] });
      setLines((draft.items || []).map((item: any) => ({ item_master_id: item.item_master_id || "", additional_description: item.additional_description_snapshot || "", quantity: String(item.quantity ?? ""), unit_rate: String(item.unit_rate ?? ""), gst_percent: String(item.gst_percent ?? "0") })));
      setNumberEdited(true);
    }).catch((e: any) => setMessage(e.message));
  }, [draftId]);

  useEffect(() => {
    if (!form.company_id || !form.site_id || numberEdited) return;
    let cancelled = false;
    setNumberLoading(true);
    setNumberError("");
    apiFetch(`/api/work-orders/suggest-number?company_id=${encodeURIComponent(form.company_id)}&site_id=${encodeURIComponent(form.site_id)}`)
      .then((result: any) => {
        if (cancelled) return;
        if (!result.wo_number) throw new Error("The Work Order Number could not be generated.");
        setForm((current: any) => ({ ...current, wo_number: result.wo_number }));
      })
      .catch((error: any) => {
        if (!cancelled) {
          setForm((current: any) => ({ ...current, wo_number: "" }));
          setNumberError(error?.message || "The Work Order Number could not be generated. Please try again.");
        }
      })
      .finally(() => { if (!cancelled) setNumberLoading(false); });
    return () => { cancelled = true; };
  }, [form.company_id, form.site_id, numberEdited]);

  const sites = lookups.sites;
  const terms = useMemo(() => lookups.terms_templates.filter((t: any) => t.company_id === form.company_id && t.status === "active"), [lookups.terms_templates, form.company_id]);
  const letterhead = lookups.letterheads.find((l: any) => l.company_id === form.company_id && l.is_default);
  const selectedLetterhead = lookups.letterheads.find((l: any) => l.id === form.letterhead_id) || letterhead;
  const gstMasters = useMemo(() => lookups.gst_billing_masters.filter((row: any) => row.company_id === form.company_id), [lookups.gst_billing_masters, form.company_id]);
  const billingAmbiguity = gstMasters.find((row: any) => row.id === form.gst_registration_id && !row.billing_address && (row.billing_addresses || []).length > 1);
  const billingAddresses = useMemo(() => lookups.billing_addresses.filter((row: any) => row.company_id === form.company_id && (!form.gst_registration_id || row.gst_registration_id === form.gst_registration_id)), [lookups.billing_addresses, form.company_id, form.gst_registration_id]);
  const selectedBillingAddress = billingAddresses.find((row: any) => row.id === form.billing_address_id);
  const deliveryCompanyName = (row: any) => row?.company?.company_name || lookups.companies.find((company: any) => company.id === row?.company_id)?.company_name || "";
  const deliveryLocationMatchesSelectedMaster = (row: any) => row.site_id === form.site_id && row.status === "active" && row.billing_address?.gst_registration_id === form.gst_registration_id;
  const deliveryLocations = useMemo(() => form.gst_registration_id ? lookups.delivery_locations.filter(deliveryLocationMatchesSelectedMaster) : [], [lookups.delivery_locations, form.site_id, form.gst_registration_id]);
  const eligibleDeliveryLocations = useMemo(() => form.gst_registration_id ? lookups.delivery_locations.filter(deliveryLocationMatchesSelectedMaster) : [], [lookups.delivery_locations, form.site_id, form.gst_registration_id]);
  const defaultDeliveryLocation = eligibleDeliveryLocations.find((row: any) => row.is_default) || (eligibleDeliveryLocations.length === 1 ? eligibleDeliveryLocations[0] : null);
  const siteContacts = useMemo(() => lookups.site_contacts.filter((row: any) => row.site_id === form.site_id && row.status === "active").sort((a: any, b: any) => Number(b.is_default) - Number(a.is_default) || String(a.contact_name || "").localeCompare(String(b.contact_name || ""))), [lookups.site_contacts, form.site_id]);
  const totals = useMemo(() => lines.reduce((r, l) => {
    const basic = Number(l.quantity || 0) * Number(l.unit_rate || 0);
    const gst = basic * Number(l.gst_percent || 0) / 100;
    return { basic: r.basic + basic, gst: r.gst + gst, total: r.total + basic + gst };
  }, { basic: 0, gst: 0, total: 0 }), [lines]);

  const updateLine = (index: number, field: keyof Line, value: string) => setLines((rows) => rows.map((row, i) => i === index ? { ...row, [field]: value } : row));
  const updateKeyTerm = (kind: "inclusions" | "exclusions", index: number, value: string) => setKeyTerms((current) => ({ ...current, [kind]: current[kind].map((entry, i) => i === index ? value : entry) }));
  const addKeyTerm = () => setKeyTerms((current) => ({ ...current, additional: [...current.additional, { label: "", value: "" }] }));
  const selectTerms = (id: string) => {
    const template = lookups.terms_templates.find((row: any) => row.id === id);
    const snapshot = (template?.sections || []).filter((s: any) => s.status === "active").sort((a: any, b: any) => a.sort_order - b.sort_order).map((s: any) => `${s.heading}\n${s.clause_body}`).join("\n\n");
    setForm((current: any) => ({ ...current, terms_template_id: id, standard_terms_snapshot: snapshot }));
  };

  useEffect(() => {
    if (form.billing_address_id && !selectedBillingAddress) setForm((current: any) => ({ ...current, billing_address_id: "", delivery_location_id: "", billing_contact_id: "", delivery_contact_id: "" }));
  }, [form.billing_address_id, selectedBillingAddress?.id]);

  useEffect(() => {
    const master = gstMasters.find((row: any) => row.id === form.gst_registration_id);
    const linkedAddressId = master?.billing_address?.id;
    if (linkedAddressId && linkedAddressId !== form.billing_address_id) setForm((current: any) => ({ ...current, billing_address_id: linkedAddressId, delivery_location_id: "" }));
  }, [form.gst_registration_id, gstMasters, form.billing_address_id]);

  useEffect(() => {
    if (billingAmbiguity) setMessage("The selected GST/Billing Master has multiple linked billing addresses and no default. Select the canonical Billing Address explicitly.");
  }, [billingAmbiguity?.id]);

  useEffect(() => {
    if (!defaultDeliveryLocation || defaultDeliveryLocation.id === form.delivery_location_id) return;
    setForm((current: any) => ({ ...current, delivery_location_id: defaultDeliveryLocation.id }));
  }, [defaultDeliveryLocation?.id, form.delivery_location_id]);

  async function preview(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    const missing = [!form.company_id && "Company", !form.site_id && "Site", !form.vendor_id && "Vendor", !form.wo_number.trim() && "Work Order Number", !form.gst_registration_id && "GST/Billing Master", !form.billing_address_id && "Billing Address", !form.delivery_location_id && "Delivery Location", !form.billing_contact_id && "Billing Contact", !form.delivery_contact_id && "Delivery Contact", !form.letterhead_id && "Letterhead", !form.terms_template_id && "Terms & Conditions"].filter(Boolean);
    if (missing.length || lines.some((l) => !l.item_master_id || Number(l.quantity) <= 0 || Number(l.unit_rate) < 0)) {
      setMessage(missing.length ? `Complete the following fields: ${missing.join(", ")}.` : "Complete every item line before saving.");
      return;
    }
    if (!keyTerms.inclusions[0].trim() || !keyTerms.exclusions[0].trim()) {
      setMessage("Mandatory Inclusions and Exclusions are required.");
      return;
    }
    if (keyTerms.inclusions.slice(1).some((entry) => !entry.trim()) || keyTerms.exclusions.slice(1).some((entry) => !entry.trim()) || keyTerms.additional.some((entry) => !entry.label.trim() || !entry.value.trim())) {
      setMessage("Complete every additional Key Term before saving.");
      return;
    }
    setSaving(true);
    try {
      const selectedVendor = lookups.vendors.find((row: any) => row.id === form.vendor_id) || null;
      const primaryVendorContact = selectedVendor?.contacts?.find((contact: any) => contact?.is_primary) || selectedVendor?.contacts?.[0] || {};
      const vendorSnapshot = selectedVendor ? { ...selectedVendor, contact_person: selectedVendor.contact_person || primaryVendorContact.contact_name || "", phone: selectedVendor.phone || selectedVendor.mobile || primaryVendorContact.contact_number || primaryVendorContact.mobile || "", email: selectedVendor.email || primaryVendorContact.email || "" } : null;
      const payload = {
        ...form,
        company_name: lookups.companies.find((row: any) => row.id === form.company_id)?.company_name || "",
        site_name: sites.find((row: any) => row.id === form.site_id)?.site_name || "",
        vendor_snapshot: vendorSnapshot,
        billing_snapshot: selectedBillingAddress || null,
        delivery_snapshot: deliveryLocations.find((row: any) => row.id === form.delivery_location_id) || null,
        billing_contact_snapshot: siteContacts.find((row: any) => row.id === form.billing_contact_id) || null,
        delivery_contact_snapshot: siteContacts.find((row: any) => row.id === form.delivery_contact_id) || null,
        gst_snapshot: gstMasters.find((row: any) => row.id === form.gst_registration_id) || null,
        letterhead_name: selectedLetterhead?.letterhead_name || "",
        terms_template_name: terms.find((row: any) => row.id === form.terms_template_id)?.template_name || "",
        letterhead_snapshot: selectedLetterhead || null,
        work_order_key_terms: keyTerms,
        master_selection: { gst_registration_id: form.gst_registration_id, billing_address_id: form.billing_address_id, delivery_location_id: form.delivery_location_id, letterhead_id: form.letterhead_id, terms_template_id: form.terms_template_id },
        contact_selection: { billing_contact_id: form.billing_contact_id, delivery_contact_id: form.delivery_contact_id },
        items: lines,
        item_snapshots: lines.map((line) => lookups.items.find((item: any) => item.id === line.item_master_id) || null),
      };
      const previewForm = new FormData();
      previewForm.append("payload", JSON.stringify(payload));
      supportingDocuments.forEach((file) => previewForm.append("supporting_documents", file, file.name));
      const result = await apiFetch("/api/work-orders/preview", {
        method: "POST",
        body: previewForm,
      });
      if (result.pdf_base64) {
        setWorkOrderPilotDraft({ form, keyTerms, lines, supportingDocuments, payload, previewUrl: `data:application/pdf;base64,${result.pdf_base64}` });
        router.push("/work-orders/new/structured/preview");
      }
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setSaving(false);
    }
  }

  return <section className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-sky-700">Work Orders</p><h1 className="text-3xl font-bold">Create Work Order</h1><p className="mt-1 text-sm text-slate-500">Structured lines use immutable Work Order Item Master snapshots.</p></div><Link href="/work-orders" className="rounded-xl border px-4 py-2 text-sm font-semibold">Back to Work Orders</Link></header>
    <form onSubmit={preview} className="space-y-6">
      <section className="grid gap-4 rounded-2xl border bg-white p-5 md:grid-cols-3">
        {([['company_id', 'Company'], ['site_id', 'Site'], ['vendor_id', 'Vendor']] as const).map(([field, label]) => <label key={field} className="text-sm font-semibold">{label}<select required disabled={lookupLoading} className="mt-1 w-full rounded-lg border p-2 disabled:bg-slate-50" value={(form as any)[field]} onChange={(e) => { if (field !== 'vendor_id') { setNumberEdited(false); setNumberError(""); } setForm({ ...form, [field]: e.target.value, ...(field === 'site_id' ? { billing_contact_id: '', delivery_contact_id: '', delivery_location_id: '', wo_number: '' } : field === 'company_id' ? { gst_registration_id: '', billing_address_id: '', delivery_location_id: '', billing_contact_id: '', delivery_contact_id: '', wo_number: '' } : {}) }); }}>{<option value="">{lookupLoading ? `Loading ${label.toLowerCase()}s…` : `Select ${label.toLowerCase()}`}</option>}{(field === 'company_id' ? lookups.companies : field === 'site_id' ? sites : lookups.vendors).map((row: any) => <option key={row.id} value={row.id}>{row.company_name || row.site_name || row.vendor_name}</option>)}</select></label>)}
        <label className="text-sm font-semibold">WO Number *<input required aria-describedby={numberError ? "wo-number-error" : undefined} className="mt-1 w-full rounded-lg border p-2" value={form.wo_number} onChange={(e) => { setNumberEdited(true); setNumberError(""); setForm({ ...form, wo_number: e.target.value }); }} placeholder="SITE/CODE/101" />{numberLoading && <span className="mt-1 block text-xs font-normal text-slate-500">Generating next Work Order Number…</span>}{numberError && <span id="wo-number-error" role="alert" className="mt-1 block text-xs font-normal text-red-700">{numberError}</span>}</label>
        <label className="text-sm font-semibold">WO Date<input required type="date" className="mt-1 w-full rounded-lg border p-2" value={form.wo_date} onChange={(e) => setForm({ ...form, wo_date: e.target.value })} /></label>
        <label className="text-sm font-semibold">WO Type *<select required className="mt-1 w-full rounded-lg border p-2" value={form.wo_type} onChange={(e) => setForm({ ...form, wo_type: e.target.value })}><option value="">Select Work Order type</option>{['Consultant', 'Contractor (Labour)', 'Contractor (SITC)', 'Daily Wage', 'Rental'].map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
        <label className="text-sm font-semibold md:col-span-3">Description<textarea className="mt-1 w-full rounded-lg border p-2" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
      </section>
      <section className="space-y-5 rounded-2xl border bg-white p-5"><h2 className="text-xl font-bold">GST, Billing and Delivery</h2><div className="grid gap-5 md:grid-cols-2"><div><p className="text-xs font-semibold uppercase text-slate-500">Bill To / Billing Details</p><p className="mt-2 font-semibold">{lookups.companies.find((row: any) => row.id === form.company_id)?.company_name || "Select a company"}</p><p className="mt-2 text-sm"><span className="font-semibold">GSTIN</span><br />{gstMasters.find((row: any) => row.id === form.gst_registration_id)?.gstin || "—"}</p><label className="mt-4 block text-sm font-semibold">Billing Address<select required className="mt-1 w-full rounded-lg border p-2" value={form.billing_address_id} onChange={(e) => setForm({ ...form, billing_address_id: e.target.value, delivery_location_id: "", billing_contact_id: "", delivery_contact_id: "" })}><option value="">{form.gst_registration_id ? "Select billing address" : "Select a GST/Billing Master first"}</option>{billingAddresses.map((row: any) => <option key={row.id} value={row.id}>{[row.label, row.address_line1, row.city, row.state, row.pincode].filter(Boolean).join(" — ")}</option>)}</select></label><label className="mt-4 block text-sm font-semibold">Billing Contact Person<select required className="mt-1 w-full rounded-lg border p-2" value={form.billing_contact_id} onChange={(e) => setForm({ ...form, billing_contact_id: e.target.value })} disabled={!form.site_id || siteContacts.length <= 1}><option value="">{form.site_id ? "Select billing contact" : "Select a site first"}</option>{siteContacts.map((row: any) => <option key={row.id} value={row.id}>{row.contact_name}{row.designation ? ` — ${row.designation}` : ""}{row.mobile ? ` — ${row.mobile}` : ""}</option>)}</select></label></div><div><label className="text-sm font-semibold">GST / Billing Master<select required className="mt-1 w-full rounded-lg border p-2" value={form.gst_registration_id} onChange={(e) => setForm({ ...form, gst_registration_id: e.target.value, billing_address_id: "", delivery_location_id: "", billing_contact_id: "", delivery_contact_id: "" })}><option value="">Select GST / Billing Master</option>{gstMasters.map((row: any) => <option key={row.id} value={row.id}>{[row.gstin, row.trade_name || row.legal_name, row.state].filter(Boolean).join(" — ")}</option>)}</select></label></div></div><div className="border-t pt-5"><p className="text-xs font-semibold uppercase text-slate-500">Delivery Details</p><div className="mt-3 grid gap-4 md:grid-cols-2"><label className="text-sm font-semibold">Delivery Location<select required className="mt-1 w-full rounded-lg border p-2" value={form.delivery_location_id} onChange={(e) => setForm({ ...form, delivery_location_id: e.target.value, delivery_contact_id: "" })}><option value="">Select delivery location</option>{deliveryLocations.map((row: any) => <option key={row.id} value={row.id}>{row.location_name}</option>)}</select></label><div className="text-sm"><span className="font-semibold">Delivery Address</span><p className="mt-1 rounded-lg border bg-slate-50 p-3">{(() => { const row = deliveryLocations.find((item: any) => item.id === form.delivery_location_id); return row ? [row.address || row.address_line1, row.address_line2, row.city, row.state, row.pincode].filter(Boolean).join(", ") : "Select a delivery location."; })()}</p></div><label className="text-sm font-semibold">Delivery Contact Person<select required className="mt-1 w-full rounded-lg border p-2" value={form.delivery_contact_id} onChange={(e) => setForm({ ...form, delivery_contact_id: e.target.value })} disabled={!form.site_id || siteContacts.length <= 1}><option value="">{form.site_id ? "Select delivery contact" : "Select a site first"}</option>{siteContacts.map((row: any) => <option key={row.id} value={row.id}>{row.contact_name}{row.designation ? ` — ${row.designation}` : ""}{row.mobile ? ` — ${row.mobile}` : ""}</option>)}</select></label></div></div></section>
      {(() => { const row = deliveryLocations.find((item: any) => item.id === form.delivery_location_id); const company = deliveryCompanyName(row); return company ? <p className="-mt-2 px-1 text-sm text-slate-600">Project / Associated Company: <span className="font-semibold">{company}</span></p> : null; })()}
      <section className="overflow-x-auto rounded-2xl border bg-white p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-bold">Work Order Items</h2><p className="text-sm text-slate-500">Amounts are recalculated on the server.</p></div><button type="button" className="rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => setLines([...lines, emptyLine()])}>Add Line</button></div><table className="min-w-[1350px] w-full text-left text-sm"><thead className="bg-slate-50"><tr>{['Sr. No.', 'Item Header', 'Description', 'Unit', 'Mode of Measurement', 'Additional Description', 'Quantity', 'Unit Rate', 'GST %', 'Basic Amount', 'GST Amount', 'Line Total', ''].map((h) => <th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{lines.map((line, index) => { const item = lookups.items.find((i: any) => i.id === line.item_master_id); const basic = Number(line.quantity || 0) * Number(line.unit_rate || 0); const gst = basic * Number(line.gst_percent || 0) / 100; return <tr key={index} className="border-t align-top"><td className="p-2">{index + 1}</td><td className="p-2"><select required className="w-44 rounded border p-2" value={line.item_master_id} onChange={(e) => updateLine(index, 'item_master_id', e.target.value)}><option value="">Select item</option>{lookups.items.map((i: any) => <option key={i.id} value={i.id}>{i.item_header}</option>)}</select></td><td className="p-2">{item?.description || '—'}</td><td className="p-2">{item?.unit || '—'}</td><td className="p-2">{item?.mode_of_measurement || '—'}</td><td className="p-2"><input type="text" className="w-48 rounded border p-2" value={line.additional_description} onChange={(e) => updateLine(index, 'additional_description', e.target.value)} placeholder="Optional" /></td>{(['quantity', 'unit_rate', 'gst_percent'] as const).map((field) => <td className="p-2" key={field}><input required type="number" min={field === 'quantity' ? '0.001' : '0'} step="any" className="w-24 rounded border p-2" value={line[field]} onChange={(e) => updateLine(index, field, e.target.value)} /></td>)}<td className="p-2 font-semibold">{money(basic)}</td><td className="p-2">{money(gst)}</td><td className="p-2 font-semibold">{money(basic + gst)}</td><td className="p-2"><button type="button" className="text-red-700" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, i) => i !== index))}>Remove</button></td></tr>; })}</tbody></table><div className="mt-4 flex justify-end gap-6 border-t pt-4 text-sm"><span>Basic <b>{money(totals.basic)}</b></span><span>GST <b>{money(totals.gst)}</b></span><span className="text-base">Grand Total <b>{money(totals.total)}</b></span></div></section>
      <section className="grid gap-4 rounded-2xl border bg-white p-5 md:grid-cols-2">
        <label className="text-sm font-semibold">Letterhead<select className="mt-1 w-full rounded-lg border p-2" value={form.letterhead_id} onChange={(e) => setForm({ ...form, letterhead_id: e.target.value })}><option value="">Select letterhead</option>{lookups.letterheads.filter((row: any) => row.company_id === form.company_id).map((row: any) => <option key={row.id} value={row.id}>{row.letterhead_name}</option>)}</select></label>
        <label className="text-sm font-semibold">Terms &amp; Conditions<select className="mt-1 w-full rounded-lg border p-2" value={form.terms_template_id} onChange={(e) => selectTerms(e.target.value)}><option value="">Select terms master</option>{terms.map((t: any) => <option key={t.id} value={t.id}>{t.template_name}</option>)}</select></label>
        <label className="text-sm font-semibold md:col-span-2">Terms &amp; Conditions snapshot<textarea className="mt-1 w-full rounded-lg border p-2" rows={6} value={form.standard_terms_snapshot} onChange={(e) => setForm({ ...form, standard_terms_snapshot: e.target.value })} /></label>
      </section>
      <section className="rounded-2xl border bg-white p-5"><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-bold">Key Terms</h2><button type="button" className="rounded-lg border px-3 py-2 text-sm font-semibold" onClick={addKeyTerm}>+ Add Additional Term</button></div><div className="overflow-x-auto"><table className="min-w-[520px] w-full border-collapse text-sm"><thead className="bg-slate-50"><tr><th className="w-56 border p-3 text-left">Key Term</th><th className="border p-3 text-left">Terms</th></tr></thead><tbody><tr><td className="border p-3 font-semibold">Inclusions *</td><td className="border p-3"><textarea required rows={2} className="min-h-10 w-full resize-y rounded-lg border p-2" value={keyTerms.inclusions[0] || ""} onChange={(e) => updateKeyTerm('inclusions', 0, e.target.value)} /></td></tr><tr><td className="border p-3 font-semibold">Exclusions *</td><td className="border p-3"><textarea required rows={2} className="min-h-10 w-full resize-y rounded-lg border p-2" value={keyTerms.exclusions[0] || ""} onChange={(e) => updateKeyTerm('exclusions', 0, e.target.value)} /></td></tr>{keyTerms.inclusions.slice(1).map((entry, index) => <tr key={`inclusion-${index + 1}`}><td className="border p-3 font-semibold"><div className="flex items-center justify-between gap-2"><span>Inclusions {index + 2}</span><button type="button" className="text-xs font-semibold text-red-700" onClick={() => setKeyTerms((current) => ({ ...current, inclusions: current.inclusions.filter((_, i) => i !== index + 1) }))}>Remove</button></div></td><td className="border p-3"><textarea rows={2} className="min-h-10 w-full resize-y rounded-lg border p-2" value={entry} onChange={(e) => updateKeyTerm('inclusions', index + 1, e.target.value)} /></td></tr>)}{keyTerms.exclusions.slice(1).map((entry, index) => <tr key={`exclusion-${index + 1}`}><td className="border p-3 font-semibold"><div className="flex items-center justify-between gap-2"><span>Exclusions {index + 2}</span><button type="button" className="text-xs font-semibold text-red-700" onClick={() => setKeyTerms((current) => ({ ...current, exclusions: current.exclusions.filter((_, i) => i !== index + 1) }))}>Remove</button></div></td><td className="border p-3"><textarea rows={2} className="min-h-10 w-full resize-y rounded-lg border p-2" value={entry} onChange={(e) => updateKeyTerm('exclusions', index + 1, e.target.value)} /></td></tr>)}{keyTerms.additional.map((term, index) => <tr key={`additional-${index}`}><td className="border p-3"><div className="flex items-center gap-2"><input className="min-w-0 flex-1 rounded-lg border p-2" placeholder="Description" value={term.label} onChange={(e) => setKeyTerms((current) => ({ ...current, additional: current.additional.map((row, i) => i === index ? { ...row, label: e.target.value } : row) }))} /><button type="button" className="shrink-0 text-xs font-semibold text-red-700" onClick={() => setKeyTerms((current) => ({ ...current, additional: current.additional.filter((_, i) => i !== index) }))}>Remove</button></div></td><td className="border p-3"><textarea rows={2} className="min-h-10 w-full resize-y rounded-lg border p-2" placeholder="Terms" value={term.value} onChange={(e) => setKeyTerms((current) => ({ ...current, additional: current.additional.map((row, i) => i === index ? { ...row, value: e.target.value } : row) }))} /></td></tr>)}</tbody></table></div></section>
      <section className="space-y-4 rounded-2xl border bg-white p-5"><div><h2 className="text-lg font-bold">Supporting Documents</h2><p className="text-sm text-slate-500">Any file type is accepted. PDFs and common images are shown in the preview; other files are listed there and remain attached after submission.</p></div><input type="file" multiple onChange={(event) => { const files = Array.from(event.target.files || []); setSupportingDocuments((current) => [...current, ...files]); event.currentTarget.value = ""; setMessage(""); }} className="block w-full rounded-lg border p-2 text-sm" />{supportingDocuments.length > 0 && <ul className="space-y-2 text-sm">{supportingDocuments.map((file, index) => <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border bg-slate-50 px-3 py-2"><span className="truncate">{file.name}</span><button type="button" className="shrink-0 font-semibold text-red-700" onClick={() => setSupportingDocuments((current) => current.filter((_, fileIndex) => fileIndex !== index))}>Remove</button></li>)}</ul>}</section>
      {message && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><p>{message}</p><button type="button" className="mt-2 rounded border border-red-300 px-3 py-1 font-semibold" onClick={() => setLookupRetry((value) => value + 1)}>Retry lookup loading</button></div>}<button type="submit" disabled={saving} className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50">{saving ? 'Generating Preview…' : 'Preview Work Order PDF'}</button>
    </form>
  </section>;
}
