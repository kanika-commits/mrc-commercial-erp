"use client";
import { useEffect, useRef, useState } from "react";

type Props = { layout: any; setLayout: (value: any) => void; terms?: any[]; company?: { id?: string; company_code?: string; company_name?: string } | null };
const letterheadFor = (company?: Props["company"]) => { const code = (company?.company_code || "").trim().toUpperCase(); const name = (company?.company_name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " "); if (code === "MRC-TECH" || name.includes("mrc tech")) return { header: "/letterheads/mrc-tech-header.png", footer: "/letterheads/mrc-tech-footer.png", name: company?.company_name || "MRC Tech" }; if (code === "MRC" || code === "MRC-INFRA" || code === "MRC-INFRACON" || name.includes("mrc infracon") || name.includes("mrc infra")) return { header: "/letterheads/mrc-infracon-header.png", footer: "/letterheads/mrc-infracon-footer.png", name: company?.company_name || "MRC Infracon Limited" }; return null; };
const itemLabels: Record<string, string> = { serial: "Sr. No.", description: "Description of items", specification: "Specification", make: "Make", hsn: "HSN / SAC", quantity: "Qty", unit: "Unit", rate: "Rate", gst_percent: "GST %", gst_amount: "GST Amount", amount: "Amount", remarks: "Remarks" };
  const names: Record<string, string> = { heading: "PO Heading", vendor_details: "Vendor / PO Details", billing_shipping: "Billing / Shipping", project: "Project Details", introduction: "Introduction / Subject", items: "Items", totals: "Totals", key_terms: "Key Terms", standard_terms: "Terms & Conditions", signature: "Authorised Signatory" };
const itemValue = (key: string, row: number) => key === "serial" ? String(row) : key === "description" ? "Reinforcement steel bars for structural work" : key === "specification" ? "As per approved specification" : key === "make" ? "Sample Make" : key === "hsn" ? "7214" : key === "quantity" ? "10" : key === "unit" ? "Nos" : key === "rate" ? "1,250.00" : key === "gst_percent" ? "18%" : key === "gst_amount" ? "2,250.00" : key === "amount" ? "12,500.00" : "As required";

export default function VisualLayoutPreview({ layout, setLayout, terms = [], company }: Props) {
  const letterhead = letterheadFor(company);
  const selectedTerms = { sections: [{ id: "preview-price", heading: "Price Validity", clause_body: "Prices remain valid for the agreed validity period.", status: "active", sort_order: 1 }, { id: "preview-delivery", heading: "Delivery", clause_body: "Delivery will follow the approved project programme and site instructions.", status: "active", sort_order: 2 }, { id: "preview-quality", heading: "Quality", clause_body: "Materials shall conform to the approved specifications and applicable standards.", status: "active", sort_order: 3 }] };
  const workspaceRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const termsRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState("heading");
  const gridSplit = layout.informationGridLeftPercent || 50;
  const termsWidths = layout.keyTermsColumns || { serial: 8, description: 27, terms: 65 };
  const [zoom, setZoom] = useState(0.75);
  const spacing = { headerToTitle: 8, titleToInfo: 10, infoToItems: 10, itemsToKeyTerms: 10, keyTermsToStandardTerms: 10, standardTermsToSignature: 10, signatureToFooter: 10, ...(layout.spacing || {}) };
  const [fitZoom, setFitZoom] = useState(0.55);
  const paperWidth = layout.page.orientation === "landscape" ? 1123 : 794; useEffect(() => { const updateFit = () => { const width = workspaceRef.current?.clientWidth || paperWidth; setFitZoom(Math.min(1, Math.max(0.4, (width - 32) / paperWidth))); }; updateFit();
  const observer = new ResizeObserver(updateFit); if (workspaceRef.current) observer.observe(workspaceRef.current); return () => observer.disconnect(); }, [paperWidth]);
  const sections = Object.entries(layout.sections).sort(([, a]: any, [, b]: any) => a.order - b.order);
  const visible = layout.items.columns.filter((c: any) => c.visible).sort((a: any, b: any) => a.order - b.order);
  const move = (direction: -1 | 1) => { const i = sections.findIndex(([key]) => key === selected);
  const other = sections[i + direction]; if (!other) return; setLayout({ ...layout, sections: { ...layout.sections, [selected]: { ...layout.sections[selected], order: layout.sections[other[0]].order }, [other[0]]: { ...layout.sections[other[0]], order: layout.sections[selected].order } } }); };
  const resize = (event: React.PointerEvent<HTMLButtonElement>) => { const movePointer = (point: PointerEvent) => { const rect = tableRef.current?.getBoundingClientRect();
  const columns = layout.items.columns.filter((c: any) => c.visible).sort((a: any, b: any) => a.order - b.order); if (!rect || columns.length < 2) return;
  const width = Math.max(18, Math.min(65, ((point.clientX - rect.left) / rect.width) * 100));
  const total = columns[0].width + columns[1].width; setLayout({ ...layout, items: { ...layout.items, columns: layout.items.columns.map((c: any) => c.key === columns[0].key ? { ...c, width: Number(width.toFixed(2)) } : c.key === columns[1].key ? { ...c, width: Number((total - width).toFixed(2)) } : c) } }); };
  const stop = () => { window.removeEventListener("pointermove", movePointer); window.removeEventListener("pointerup", stop); }; window.addEventListener("pointermove", movePointer); window.addEventListener("pointerup", stop); event.currentTarget.setPointerCapture?.(event.pointerId); };
  const select = (key: string, event?: React.MouseEvent) => { event?.stopPropagation(); setSelected(key); document.getElementById("po-layout-selected-controls")?.scrollIntoView({ behavior: "smooth", block: "nearest" }); };
  const section = (key: string, content: React.ReactNode) => { const config = layout.sections[key]; if (!config?.visible) return null; const signatureVisible = layout.sections.signature?.visible !== false; return <div key={key} data-section={key} onClick={(event) => select(key, event)} className={"relative border p-3 transition " + (selected === key ? "border-sky-500 ring-1 ring-sky-200" : "border-transparent hover:border-dashed hover:border-sky-400")} style={{ marginTop: config.spacing_before + (key === "items" ? spacing.infoToItems : key === "key_terms" ? spacing.itemsToKeyTerms : key === "standard_terms" ? spacing.keyTermsToStandardTerms : 0), marginBottom: config.spacing_after + (key === "standard_terms" && signatureVisible ? spacing.standardTermsToSignature : 0) }}>{content}</div>; };
  const dragPercent = (event: React.PointerEvent<HTMLButtonElement>, key: "grid" | "terms", index = 0) => { const movePointer = (point: PointerEvent) => { const rect = (key === "grid" ? splitRef.current : termsRef.current)?.getBoundingClientRect(); if (!rect) return;
  const value = Math.max(key === "grid" ? 30 : index === 0 ? 6 : 24, Math.min(key === "grid" ? 70 : index === 0 ? 30 : 65, ((point.clientX - rect.left) / rect.width) * 100)); if (key === "grid") { setLayout({ ...layout, informationGridLeftPercent: Number(value.toFixed(2)) }); } else { const next = index === 0 ? { serial: Number(value.toFixed(2)), description: Number((100 - value - termsWidths.terms).toFixed(2)), terms: termsWidths.terms } : { serial: termsWidths.serial, description: Number((value - termsWidths.serial).toFixed(2)), terms: Number((100 - value).toFixed(2)) }; setLayout({ ...layout, keyTermsColumns: next }); } };
  const stop = () => { window.removeEventListener("pointermove", movePointer); window.removeEventListener("pointerup", stop); }; window.addEventListener("pointermove", movePointer); window.addEventListener("pointerup", stop); event.currentTarget.setPointerCapture?.(event.pointerId); };
  return <section className="rounded border bg-slate-100 p-4">
<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
<div>
<h2 className="font-semibold">PO Visual Preview</h2>
<p className="text-xs text-slate-500">Synthetic data • {layout.page.orientation === "landscape" ? "A4 landscape" : "A4 portrait"}</p>
</div>
<div className="flex items-center gap-1">
<button type="button" onClick={() => setZoom(fitZoom)} className="rounded border bg-white px-2 py-1 text-xs">Fit Page</button>
<button type="button" onClick={() => setZoom(0.75)} className="rounded border bg-white px-2 py-1 text-xs">75%</button>
<button type="button" onClick={() => setZoom(1)} className="rounded border bg-white px-2 py-1 text-xs">100%</button>
<button type="button" onClick={() => setZoom(Math.min(1.5, zoom + 0.1))} className="rounded border bg-white px-2 py-1 text-xs" aria-label="Zoom in">+</button>
<button type="button" onClick={() => setZoom(Math.max(0.4, zoom - 0.1))} className="rounded border bg-white px-2 py-1 text-xs" aria-label="Zoom out">−</button>
</div>
</div>
<div id="po-layout-selected-controls" className="mb-3 flex items-center gap-2 text-xs">
<span className="text-slate-500">Selected: {names[selected] || selected}</span>
<button type="button" onClick={() => move(-1)} className="rounded border bg-white px-2 py-1">Move Up</button>
<button type="button" onClick={() => move(1)} className="rounded border bg-white px-2 py-1">Move Down</button>
</div>
<div ref={workspaceRef} className="w-full overflow-auto rounded border border-slate-300 bg-slate-300 p-4">
<div className="mx-auto bg-white text-[10px] leading-4 text-slate-800 shadow-xl" style={{ width: layout.page.orientation === "landscape" ? 1123 : 794, minHeight: layout.page.orientation === "landscape" ? 794 : 1123, transform: "scale(" + zoom + ")", transformOrigin: "top center", marginBottom: ((layout.page.orientation === "landscape" ? 794 : 1123) * zoom) - (layout.page.orientation === "landscape" ? 794 : 1123), padding: (layout.page.top_margin + layout.page.header_height) + "px " + layout.page.right_margin + "px " + (layout.page.bottom_margin + layout.page.footer_height) + "px " + layout.page.left_margin + "px" }}>
<div className="border-b-2 border-slate-700">
{letterhead ? <img src={letterhead.header} alt={`${letterhead.name} header`} className="block w-full object-contain object-left" style={{ aspectRatio: "1414 / 360", height: "auto" }} /> : <div className="border border-dashed border-slate-400 p-8 text-center text-slate-500">No supported company letterhead configured.</div>}
<div className="text-center text-xl font-bold tracking-wide" style={{ marginTop: spacing.headerToTitle }}>PURCHASE ORDER</div>
</div>{sections.map(([key]) => key === "heading" ? section(key, <div className="border border-slate-700 p-2" style={{ marginTop: spacing.titleToInfo }}>
<b>Purchase Order</b>
<div>PO No. TEST/PO/001 | Date: 31-Aug-2026</div>
</div>) : key === "vendor_details" ? section(key, <div ref={splitRef} className="relative grid grid-cols-2 gap-0 overflow-hidden border border-slate-700">
<div className="col-span-2 grid" style={{ gridTemplateColumns: gridSplit + "% " + (100 - gridSplit) + "%" }}>
<div className="border-r border-b border-slate-700 p-2">
<b>Vendor Details</b>
<div>ABC Engineering Pvt. Ltd.</div>
<div>12 Industrial Area, New Delhi</div>
<div>GSTIN: 07XXXXXXXXXXXX</div>
<div>Contact: Rajesh Sharma · +91 98765 43210</div>
<div>rajesh@example.com</div>
</div>
<div className="border-b border-slate-700 p-2">
<b>Purchase Order Details</b>
<div>PO No.: TEST/PO/001</div>
<div>Date: 31-Aug-2026</div>
<div>Project: Sample Construction Project</div>
</div>
<div className="border-r border-slate-700 p-2">
<b>Billing Address</b>
<div>MRC Infracon Limited</div>
<div>New Delhi, India</div>
<div>GSTIN: 07XXXXXXXXXXXX</div>
<div>Contact: Accounts · +91 11 4000 0000</div>
</div>
<div className="p-2">
<b>Shipping Address</b>
<div>Sample Construction Site</div>
<div>Sector 10, New Delhi</div>
<div>Contact: Site Store · +91 98765 43211</div>
</div>
</div>
<button type="button" aria-label="Resize information table divider" onPointerDown={(event) => dragPercent(event, "grid")} className="absolute left-0 top-0 z-10 h-full w-2 cursor-col-resize bg-slate-500/50" style={{ left: gridSplit + "%" }} />
</div>) : key === "billing_shipping" ? null : key === "project" ? section(key, <div>
<b>Project / Site</b>
<div>Sample Construction Project | Sample Construction Site</div>
</div>) : key === "introduction" ? section(key, <div>
<b>Subject:</b> Supply of construction materials<br />Dear Sir, please supply the materials listed below as per the approved terms.</div>) : key === "items" ? section(key, <div ref={tableRef} className="overflow-hidden border border-slate-700">
<div className="flex bg-slate-800 font-bold text-white">{visible.map((c: any, i: number) => <div key={c.key} style={{ width: c.width + "%", textAlign: c.align }} className="relative border-r border-white/40 px-1 py-1">{itemLabels[c.key] || c.key}<button type="button" aria-label={"Resize " + c.key + " column"} onPointerDown={i === 0 ? resize : undefined} className="absolute right-0 top-0 h-full w-2 cursor-col-resize bg-white/50" />
</div>)}</div>{Array.from({ length: 5 }, (_, row) => <div key={row} className="flex items-start border-t border-slate-300">{visible.map((c: any) => <div key={c.key} style={{ width: c.width + "%", textAlign: c.align }} className="break-words border-r border-slate-300 px-1 py-1">{itemValue(c.key, row + 1)}</div>)}</div>)}</div>) : key === "totals" ? section(key, <div className="ml-auto w-3/5 overflow-hidden border border-slate-700">
<div className="flex justify-between border-b border-slate-700 px-2 py-1">
<span>Freight</span>
<span>₹ 5,000.00</span>
</div>
<div className="flex justify-between border-b border-slate-700 px-2 py-1">
<span>Basic Total</span>
<span>₹ 55,000.00</span>
</div>
<div className="flex justify-between border-b border-slate-700 px-2 py-1">
<span>GST @ 18%</span>
<span>₹ 9,900.00</span>
</div>
<div className="flex justify-between px-2 py-1 font-bold">
<span>Total Amount</span>
<span>₹ 64,900.00</span>
</div>
</div>) : key === "key_terms" ? section(key, <div ref={termsRef} className="overflow-hidden border border-slate-700">
<div className="flex bg-slate-800 font-bold text-white">
<span style={{ width: termsWidths.serial + "%" }} className="relative border-r px-1 py-1">S.No.<button type="button" aria-label="Resize Key Terms serial column" onPointerDown={(event) => dragPercent(event, "terms", 0)} className="absolute right-0 top-0 h-full w-2 cursor-col-resize bg-white/50" />
</span>
<span style={{ width: termsWidths.description + "%" }} className="relative border-r px-1 py-1">Description<button type="button" aria-label="Resize Key Terms description column" onPointerDown={(event) => dragPercent(event, "terms", 1)} className="absolute right-0 top-0 h-full w-2 cursor-col-resize bg-white/50" />
</span>
<span style={{ width: termsWidths.terms + "%" }} className="px-1 py-1">Terms</span>
</div>{["Price Validity", "Freight", "Delivery Timeline", "Payment Terms"].map((label, index) => { const value = ""; return <div key={label} className="flex border-t border-slate-300">
<span style={{ width: termsWidths.serial + "%" }} className="border-r border-slate-300 px-1 py-1">{index + 1}</span>
<span style={{ width: termsWidths.description + "%" }} className="border-r border-slate-300 px-1 py-1">{label}</span>
<span style={{ width: termsWidths.terms + "%" }} className="px-1 py-1">{value}</span>
</div>; })}</div>) : key === "standard_terms" ? section(key, <div>
<h4 className="mb-2 text-center font-bold">TERMS &amp; CONDITIONS</h4>{selectedTerms?.sections?.filter((item: any) => item.status === "active").sort((a: any, b: any) => a.sort_order - b.sort_order).map((item: any, index: number) => <div key={item.id || index} className="mb-2 break-words">
<b>{index + 1}. {item.heading}</b>
<div>{item.clause_body}</div>
</div>) || <div className="text-slate-500">Preview placeholder: select a Standard Terms Set with active clauses.</div>}</div>) : section(key, <div className="text-right">
<b>For {letterhead?.name || company?.company_name || "Selected Company"}</b>
<div className="mt-8">Authorised Signatory</div>
</div>))}<div className="border-t-2 border-slate-700 text-center" style={{ marginTop: spacing.signatureToFooter }}>
{letterhead ? <img src={letterhead.footer} alt={`${letterhead.name} footer`} className="block w-full object-contain" style={{ aspectRatio: "1414 / 300", height: "auto" }} /> : <div className="border-t border-dashed border-slate-400 pt-2 text-center text-slate-400">No supported company footer configured.</div>}
</div>
</div>
</div>
</section>;
}
