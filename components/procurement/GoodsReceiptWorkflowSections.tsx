// @ts-nocheck
"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, Circle, FileText, RefreshCw, Trash2, Upload, WandSparkles } from "lucide-react";
import AlertMessage from "@/components/AlertMessage";
import { apiFetch, getAccessToken } from "@/components/hr/hrClient";
import StampedEvidenceCapture from "@/components/procurement/StampedEvidenceCapture";

const documentTypes = [
  ["vehicle_overview", "Vehicle Overview"],
  ["number_plate", "Number Plate"],
  ["weighbridge_slip", "Weighbridge Slip"],
  ["delivery_challan", "Delivery Challan"],
  ["invoice", "Invoice"],
  ["eway_bill", "E-Way Bill"],
  ["lr_gr", "LR / GR (Transport Receipt)"],
  ["mtc", "MTC / Test Certificate"],
  ["vehicle_entry_slip", "Vehicle Entry Slip"],
  ["material_unloading", "Material / Unloading"],
  ["rejected_material", "Rejected Material"],
  ["other", "Other Document"],
] as const;

const protectFromOcrOverwrite = new Set([
  "weighbridge_slip_number",
  "weighbridge_gross_date",
  "weighbridge_gross_time",
  "gross_weight",
  "weighbridge_tare_date",
  "weighbridge_tare_time",
  "tare_weight",
  "weighbridge_vehicle_number",
  "challan_number",
  "challan_date",
  "challan_po_number",
  "challan_vendor",
  "challan_vehicle_number",
  "challan_items_json",
  "invoice_items_json",
  "invoice_number",
  "invoice_date",
]);

function kgLabel(value: unknown) {
  if (value === undefined || value === null || value === "") return "Not available";
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString("en-IN")} KG` : "Not available";
}

function money(value: unknown) {
  if (value === undefined || value === null || value === "") return "-";
  const number = Number(value);
  return Number.isFinite(number) ? `₹${number.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "-";
}

function verifiedValue(values: any[], field: string, fallbackField?: string) {
  return values.find((value) => value.field_name === field)?.final_value || (fallbackField ? values.find((value) => value.field_name === fallbackField)?.final_value : "") || "";
}

function dateLabel(value: unknown) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : raw;
}

function dateTimeLabel(date: unknown, time: unknown) {
  return [dateLabel(date), String(time || "").trim()].filter(Boolean).join(" ") || "Not available";
}

function poFreightRule(grn: any) {
  const status = String(grn.purchase_order?.commercial_snapshot?.freight_transportation_status || "").trim();
  if (status === "included") return "included";
  if (status === "extra") return "extra";
  if (Number(grn.purchase_order?.total_freight_amount || 0) > 0) return "extra";
  return "unspecified";
}

function reconciliationStatusLabel(status: unknown) {
  return status === "match" ? "Match" : status === "warning" ? "Warning" : "Not applicable";
}

function reconciliationStatusClass(status: unknown) {
  return status === "match" ? "text-emerald-700" : status === "warning" ? "text-amber-700" : "text-slate-500";
}

function normalizeSupportedWeightUnit(value: unknown) {
  const unit = String(value || "").trim().toLowerCase().replace(/[.\s_-]+/g, "");
  if (["kg", "kgs", "kilogram", "kilograms", "mt", "metricton", "metrictons", "metrictonne", "metrictonnes", "tonne", "tonnes"].includes(unit)) return unit;
  return null;
}

function normalizedVehicle(value: unknown) {
  return String(value || "").toUpperCase().replace(/[\s-]/g, "");
}

function receiptWeightItems(grn: any) {
  return (grn.items || []).filter((item: any) => item.weight_based || normalizeSupportedWeightUnit(item.uom_snapshot || item.weight_uom));
}

function normalizeReceivingMatch(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function parseDocumentLines(value: unknown) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function documentReceivedSuggestions(documents: any[], values: any[], grn: any) {
  const sources = [
    { type: "invoice", field: "invoice_items_json", source: "invoice" },
    { type: "delivery_challan", field: "challan_items_json", source: "challan" },
  ].map((source) => {
    const document = documents.find((candidate) => candidate.document_type === source.type);
    const ocrValues = document ? values.filter((value) => value.source_type === "ocr" && value.document_id === document.id) : [];
    return { ...source, document, ocrValues, lines: parseDocumentLines(ocrValues.find((value) => value.field_name === source.field)?.final_value) };
  });
  const suggestions: Record<string, any> = {};
  const mismatches: Record<string, boolean> = {};
  for (const source of sources) {
    if (!source.document) continue;
    const matchedItemIds = new Set<string>();
    for (const line of source.lines) {
      const quantity = Number(line?.quantity);
      if (!Number.isFinite(quantity) || quantity < 0) continue;
      const code = normalizeReceivingMatch(line?.item_code);
      const description = normalizeReceivingMatch(line?.description);
      const uom = normalizeReceivingMatch(line?.uom);
      const matches = (grn.items || []).filter((item: any) => {
        const codeMatch = code && code === normalizeReceivingMatch(item.item_code_snapshot);
        const descriptionMatch = description && description === normalizeReceivingMatch(item.item_name_snapshot) && (grn.items || []).filter((candidate: any) => description === normalizeReceivingMatch(candidate.item_name_snapshot)).length === 1;
        const uomMatch = !uom || uom === normalizeReceivingMatch(item.uom_snapshot);
        return uomMatch && (codeMatch || descriptionMatch);
      });
      if (matches.length !== 1) continue;
      const item = matches[0];
      matchedItemIds.add(item.id);
      const remaining = Number(item.remaining_quantity_snapshot || 0);
      if (suggestions[item.id]) {
        if (suggestions[item.id].suggestedValue !== String(quantity)) suggestions[item.id] = { ...suggestions[item.id], ambiguous: true };
        continue;
      }
      if (quantity <= remaining) suggestions[item.id] = { source: source.source, documentId: source.document.id, suggestedValue: String(quantity), overRemaining: false };
    }
    const expectedPo = String(grn.po_snapshot?.po_number || grn.purchase_order?.po_number || "").trim().toLowerCase();
    const expectedVendor = String(grn.po_snapshot?.vendor_name || grn.purchase_order?.vendor_name_snapshot || "").trim().toLowerCase();
    const documentPo = String(source.ocrValues.find((value) => value.field_name === (source.type === "invoice" ? "invoice_po_number" : "challan_po_number"))?.final_value || "").trim().toLowerCase();
    const documentVendor = String(source.ocrValues.find((value) => value.field_name === (source.type === "invoice" ? "invoice_vendor" : "challan_vendor"))?.final_value || "").trim().toLowerCase();
    mismatches[source.source] = Boolean((documentPo && expectedPo && documentPo !== expectedPo) || (documentVendor && expectedVendor && documentVendor !== expectedVendor) || (source.lines.length > 0 && matchedItemIds.size === 0));
  }
  const invoiceMismatch = Boolean(mismatches.invoice);
  const challanMismatch = Boolean(mismatches.challan);
  return { suggestions, mismatch: invoiceMismatch || challanMismatch, invoiceMismatch, challanMismatch, blockingMismatch: (invoiceMismatch && !suggestionsForSource(suggestions, "challan")) || (challanMismatch && !suggestionsForSource(suggestions, "invoice")) };
}

function suggestionsForSource(suggestions: Record<string, any>, source: string) {
  return Object.values(suggestions).some((suggestion: any) => suggestion.source === source && !suggestion.ambiguous && !suggestion.overRemaining);
}

function receiptLineBlockers(grn: any) {
  return (grn.items || []).flatMap((item: any) => {
    const received = Number(item.received_quantity || 0);
    const accepted = Number(item.accepted_quantity || 0);
    const rejected = Number(item.rejected_quantity || 0);
    const hold = Number(item.hold_quantity || 0);
    const quantities = [received, accepted, rejected, hold];
    return [
      quantities.some((value) => !Number.isFinite(value) || value < 0) ? `${item.item_name_snapshot}: Quantities must be non-negative numbers.` : "",
      received !== accepted + rejected + hold ? `${item.item_name_snapshot}: Received must equal Accepted + Rejected + Hold.` : "",
      rejected > 0 && !String(item.rejection_reason || "").trim() ? `${item.item_name_snapshot}: Rejection Reason is required.` : "",
      accepted > Number(item.remaining_quantity_snapshot || 0) ? `${item.item_name_snapshot}: Accepted quantity exceeds pending PO quantity.` : "",
    ].filter(Boolean);
  });
}

function receiptReviewState(grn: any, documents: any[], values: any[], weightItems = receiptWeightItems(grn)) {
  const gross = values.find((value) => value.field_name === "gross_weight")?.final_value;
  const tare = values.find((value) => value.field_name === "tare_weight")?.final_value;
  const invoiceNumber = values.find((value) => value.field_name === "invoice_number")?.final_value;
  const invoiceDate = values.find((value) => value.field_name === "invoice_date")?.final_value;
  const hasInvoice = Boolean(String(invoiceNumber || "").trim() && String(invoiceDate || "").trim() && documents.some((document) => document.document_type === "invoice"));
  const hasChallan = documents.some((document) => document.document_type === "delivery_challan");
  const blockers = [
    !hasInvoice && !hasChallan ? "Add either Invoice details/document or a Delivery Challan before finalizing this receipt." : "",
    ...receiptLineBlockers(grn),
    gross && tare && Number(gross) <= Number(tare) ? "Gross Weight must be greater than Tare Weight." : "",
  ].filter(Boolean);
  const warnings = grn.weight_reconciliation_status === "warning" ? ["Weight reconciliation difference requires review."] : [];
  return { blockers, warnings };
}

function hasAnyQuantity(item: any) {
  return ["received_quantity", "accepted_quantity", "rejected_quantity", "hold_quantity"].some((key) => Number(item[key] || 0) > 0);
}

function challanMismatch(values: any[], grn: any) {
  const get = (field: string) => values.find((value) => value.field_name === field)?.final_value || "";
  const po = String(grn.po_snapshot?.po_number || grn.purchase_order?.po_number || "").trim().toLowerCase();
  const vendor = String(grn.po_snapshot?.vendor_name || grn.purchase_order?.vendor_name_snapshot || "").trim().toLowerCase();
  return Boolean(
    (get("challan_po_number") && po && String(get("challan_po_number")).trim().toLowerCase() !== po) ||
    (get("challan_vendor") && vendor && String(get("challan_vendor")).trim().toLowerCase() !== vendor) ||
    (get("challan_vehicle_number") && grn.vehicle_number && normalizedVehicle(get("challan_vehicle_number")) !== normalizedVehicle(grn.vehicle_number))
  );
}

function vehicleMismatch(values: any[], grn: any) {
  const slipVehicle = values.find((value) => value.field_name === "weighbridge_vehicle_number")?.final_value;
  return Boolean(slipVehicle && grn.vehicle_number && normalizedVehicle(slipVehicle) !== normalizedVehicle(grn.vehicle_number));
}

function stepStatusClass(status: string) {
  if (status === "complete") return "border-emerald-200 bg-emerald-50 text-emerald-950 hover:border-emerald-300";
  if (status === "warning") return "border-amber-200 bg-amber-50 text-amber-950 hover:border-amber-300";
  if (status === "blocked") return "border-red-200 bg-red-50 text-red-950 hover:border-red-300";
  return "border-slate-200 bg-white text-slate-800 hover:border-slate-300";
}

function stepIndicatorClass(status: string) {
  if (status === "complete") return "border-emerald-200 bg-emerald-100 text-emerald-800";
  if (status === "warning") return "border-amber-200 bg-amber-100 text-amber-800";
  if (status === "blocked") return "border-red-200 bg-red-100 text-red-800";
  return "border-slate-300 bg-slate-50 text-slate-700";
}

function stepLabel(status: string) {
  return status === "complete" ? "Complete" : status === "optional" ? "Optional / Not provided" : status === "warning" ? "Review" : status === "blocked" ? "Blocked" : status === "incomplete" ? "Incomplete" : "Not started";
}

function labelFor(type: string) {
  return documentTypes.find(([value]) => value === type)?.[1] || "Document";
}

type DocumentFeedback = { tone: "success" | "warning" | "error" | "loading"; message: string; helper?: string };

export default function GoodsReceiptWorkflowSections({ grn, onChange, disabled, onReceivedSuggestions, onDocumentMismatch, children }: { grn: any; onChange: (next: any) => void; disabled: boolean; onReceivedSuggestions?: (suggestions: Record<string, any>) => void; onDocumentMismatch?: (mismatch: boolean, blockingMismatch: boolean) => void; children?: React.ReactNode }) {
  const [documents, setDocuments] = useState<any[]>([]);
  const [values, setValues] = useState<any[]>([]);
  const [localVerified, setLocalVerified] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [documentFeedback, setDocumentFeedback] = useState<Record<string, DocumentFeedback>>({});
  const [readingDocumentIds, setReadingDocumentIds] = useState<Set<string>>(new Set());
  const receivedSuggestionRef = useRef<Record<string, any>>({});
  const receivedDirtyRef = useRef<Set<string>>(new Set());
  const readingDocumentIdsRef = useRef<Set<string>>(new Set());

  const setFeedback = (key: string, feedback?: DocumentFeedback) => setDocumentFeedback((current) => {
    const next = { ...current };
    if (feedback) next[key] = feedback;
    else delete next[key];
    return next;
  });

  const applyDocumentSuggestions = (docs: any[], verified: any[]) => {
    const result = documentReceivedSuggestions(docs, verified, grn);
    const suggestions = result.suggestions;
    onDocumentMismatch?.(result.mismatch, result.blockingMismatch);
    const invoice = docs.find((document) => document.document_type === "invoice");
    const challan = docs.find((document) => document.document_type === "delivery_challan");
    if (invoice && result.invoiceMismatch && !readingDocumentIdsRef.current.has(invoice.id)) setFeedback(invoice.id, { tone: "warning", message: "Invoice materials do not match this Purchase Order.", helper: "Replace the Invoice or enter the received quantity manually." });
    if (invoice && !result.invoiceMismatch && documentFeedback[invoice.id]?.tone === "warning") setFeedback(invoice.id);
    if (challan && result.challanMismatch && !readingDocumentIdsRef.current.has(challan.id)) setFeedback(challan.id, { tone: "warning", message: "Delivery Challan materials do not match this Purchase Order.", helper: "Replace the Challan or enter the received quantity manually." });
    if (challan && !result.challanMismatch && documentFeedback[challan.id]?.tone === "warning") setFeedback(challan.id);
    receivedSuggestionRef.current = suggestions;
    onReceivedSuggestions?.(suggestions);
    const updates = Object.entries(suggestions).filter(([itemId, suggestion]) => {
      const item = (grn.items || []).find((candidate: any) => candidate.id === itemId);
      return item && !receivedDirtyRef.current.has(itemId) && !suggestion.overRemaining && !suggestion.ambiguous && Number(item.received_quantity || 0) === 0;
    });
    if (!updates.length) return;
    onChange({ ...grn, items: (grn.items || []).map((item: any) => {
      const suggestion = suggestions[item.id];
      return suggestion && !suggestion.overRemaining && !suggestion.ambiguous && !receivedDirtyRef.current.has(item.id) && Number(item.received_quantity || 0) === 0
        ? { ...item, received_quantity: suggestion.suggestedValue }
        : item;
    }) });
  };

  const load = async () => {
    try {
      const [docs, verified] = await Promise.all([
        apiFetch(`/api/procurement/goods-receipts/${grn.id}/documents`),
        apiFetch(`/api/procurement/goods-receipts/${grn.id}/verified-values`),
      ]);
      setDocuments(docs.documents || []);
      setValues(verified.values || []);
      applyDocumentSuggestions(docs.documents || [], verified.values || []);
      return documentReceivedSuggestions(docs.documents || [], verified.values || [], grn);
    } catch (error: any) {
      setMessage(error.message);
    }
  };

  useEffect(() => { void load(); }, [grn.id]);
  useEffect(() => {
    for (const item of grn.items || []) {
      const suggestion = receivedSuggestionRef.current[item.id];
      if (suggestion && String(item.received_quantity ?? "") !== String(suggestion.suggestedValue)) receivedDirtyRef.current.add(item.id);
    }
  }, [grn.items]);

  const latest = (field: string) => {
    const direct = values.find((value) => value.field_name === field);
    if (direct) return direct;
    if (field === "weighbridge_gross_date") return values.find((value) => value.field_name === "weighbridge_slip_date");
    if (field === "weighbridge_gross_time") return values.find((value) => value.field_name === "weighbridge_slip_time");
    return undefined;
  };
  const docsByType = (type: string) => documents.filter((document) => document.document_type === type);
  const update = (key: string, value: string) => onChange({ ...grn, [key]: value });
  const refreshHeader = async () => {
    const next = await apiFetch(`/api/procurement/goods-receipts/${grn.id}`);
    onChange((current: any) => current ? { ...current, normalized_received_kg: next.grn.normalized_received_kg, weighbridge_net_kg: next.grn.weighbridge_net_kg, weight_difference_kg: next.grn.weight_difference_kg, weight_reconciliation_status: next.grn.weight_reconciliation_status, weight_reconciliation_remarks: next.grn.weight_reconciliation_remarks } : next.grn);
  };

  const setField = async (field_name: string, final_value: string, source_type: "manual" | "ocr" | "corrected_ocr", original_extracted_value?: string) => {
    if ((!final_value.trim() && !["gross_weight", "tare_weight"].includes(field_name)) || disabled) return;
    setBusy(true);
    try {
      await apiFetch(`/api/procurement/goods-receipts/${grn.id}/verified-values`, { method: "POST", body: JSON.stringify({ field_name, final_value, source_type, original_extracted_value }) });
      await refreshHeader();
      await load();
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  async function upload(file: File, type: string) {
    if (disabled) return;
    setBusy(true);
    try {
      const token = await getAccessToken();
      const body = new FormData();
      body.set("file", file);
      body.set("document_type", type);
      body.set("capture_source", file.type.startsWith("image/") ? "camera_or_upload" : "upload");
      const response = await fetch(`/api/procurement/goods-receipts/${grn.id}/documents`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Upload failed.");
      await load();
      if (["weighbridge_slip", "delivery_challan", "invoice"].includes(type) && result.document?.id) await readDocument(result.document.id, type);
    } catch (error: any) {
      setFeedback(type, { tone: "error", message: `${labelFor(type)} upload failed.`, helper: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function removeDocument(documentId: string) {
    if (disabled) return;
    setBusy(true);
    try {
      await apiFetch(`/api/procurement/goods-receipts/${grn.id}/documents?document_id=${encodeURIComponent(documentId)}`, { method: "DELETE" });
      await load();
    } catch (error: any) {
      setFeedback(documentId, { tone: "error", message: `${labelFor(documents.find((document) => document.id === documentId)?.document_type || "") } could not be removed.`, helper: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function readDocument(documentId: string, type: string) {
    if (readingDocumentIdsRef.current.has(documentId)) return;
    readingDocumentIdsRef.current.add(documentId);
    setReadingDocumentIds(new Set(readingDocumentIdsRef.current));
    setFeedback(documentId, { tone: "loading", message: `Reading ${labelFor(type)}...` });
    setBusy(true);
    try {
      const result = await apiFetch(`/api/procurement/goods-receipts/${grn.id}/ocr`, { method: "POST", body: JSON.stringify({ document_id: documentId, document_type: type }) });
      const fields = (result.values || result.fields || []).map((item: any) => ({ ...item, normalized_field_name: type === "weighbridge_slip" && (item.field_name || item.field) === "vehicle_number" ? "weighbridge_vehicle_number" : item.field_name || item.field }));
      for (const item of fields) {
        const rawField = item.field_name || item.field;
        const field = type === "weighbridge_slip" && rawField === "vehicle_number" ? "weighbridge_vehicle_number" : rawField;
        const value = String(item.final_value ?? item.value ?? item.original_extracted_value ?? "");
        if (protectFromOcrOverwrite.has(field) && ["manual", "corrected_ocr"].includes(latest(field)?.source_type)) continue;
        if (field && value.trim()) {
          await apiFetch(`/api/procurement/goods-receipts/${grn.id}/verified-values`, { method: "POST", body: JSON.stringify({ field_name: field, final_value: value, source_type: "ocr", original_extracted_value: value, document_id: documentId }) });
        }
      }
      if (fields.length) {
        await refreshHeader();
        const suggestionState = await load();
        const mismatch = type === "invoice" ? suggestionState.invoiceMismatch : type === "delivery_challan" ? suggestionState.challanMismatch : false;
        setFeedback(documentId, mismatch ? { tone: "warning", message: `${labelFor(type)} materials do not match this Purchase Order.`, helper: `Replace the ${type === "invoice" ? "Invoice" : "Challan"} or enter the received quantity manually.` } : { tone: "success", message: `${labelFor(type)} read successfully.` });
      }
      if (!fields.length) setFeedback(documentId, { tone: "error", message: `${labelFor(type)} could not be read automatically.`, helper: type === "invoice" ? "Enter the Invoice details and received quantity manually, or try another document." : result.message || "Enter the values manually, or try another document." });
    } catch (error: any) {
      setFeedback(documentId, { tone: "error", message: `${labelFor(type)} could not be read automatically.`, helper: `${error.message} Enter the values manually, or try another document.` });
    } finally {
      readingDocumentIdsRef.current.delete(documentId);
      setReadingDocumentIds(new Set(readingDocumentIdsRef.current));
      setBusy(false);
    }
  }

  const net = grn.weighbridge_net_kg == null ? null : Number(grn.weighbridge_net_kg);
  const hasLocalGross = Object.prototype.hasOwnProperty.call(localVerified, "gross_weight");
  const hasLocalTare = Object.prototype.hasOwnProperty.call(localVerified, "tare_weight");
  const localGrossValue = hasLocalGross ? localVerified.gross_weight : latest("gross_weight")?.final_value || "";
  const localTareValue = hasLocalTare ? localVerified.tare_weight : latest("tare_weight")?.final_value || "";
  const localGross = localGrossValue === "" ? null : Number(localGrossValue);
  const localTare = localTareValue === "" ? null : Number(localTareValue);
  const localNet = localGross !== null && localTare !== null && Number.isFinite(localGross) && Number.isFinite(localTare) && localGross > localTare ? Number((localGross - localTare).toFixed(3)) : null;
  const displayedNet = hasLocalGross || hasLocalTare ? localNet : net;
  const grossTareInvalid = localGross !== null && localTare !== null && Number.isFinite(localGross) && Number.isFinite(localTare) && localGross <= localTare;
  const receivedKg = grn.normalized_received_kg == null ? null : Number(grn.normalized_received_kg);
  const reviewDifference = grn.weight_difference_kg === undefined || grn.weight_difference_kg === null ? null : Number(grn.weight_difference_kg);
  const status = grn.weight_reconciliation_status;
  const weightItems = receiptWeightItems(grn);
  const reviewState = receiptReviewState(grn, documents, values, weightItems);
  const materialBlockers = receiptLineBlockers(grn);
  const materialStarted = (grn.items || []).some(hasAnyQuantity);
  const materialResolved = (grn.items || []).length > 0 && (grn.items || []).every((item: any) => hasAnyQuantity(item) || Number(item.remaining_quantity_snapshot || 0) <= 0);
  const gross = latest("gross_weight")?.final_value;
  const tare = latest("tare_weight")?.final_value;
  const weighbridgeProvided = documents.some((document) => document.document_type === "weighbridge_slip")
    || ["weighbridge_slip_number", "weighbridge_slip_date", "weighbridge_slip_time", "weighbridge_gross_date", "weighbridge_gross_time", "weighbridge_tare_date", "weighbridge_tare_time", "weighbridge_vehicle_number", "gross_weight", "tare_weight"]
      .some((field) => Boolean(String(latest(field)?.final_value || "").trim()));
  const weighbridgeComplete = weighbridgeProvided && documents.some((document) => document.document_type === "weighbridge_slip") && Boolean(gross) && Boolean(tare) && !grossTareInvalid;
  const deliveryStarted = documents.some((document) => ["delivery_challan", "invoice"].includes(document.document_type)) || Boolean(latest("invoice_number")?.final_value || latest("invoice_date")?.final_value || latest("challan_number")?.final_value || latest("challan_date")?.final_value || grn.supplier_challan_number || grn.supplier_challan_date);
  const invoiceValid = Boolean(latest("invoice_number")?.final_value && latest("invoice_date")?.final_value && docsByType("invoice").length > 0);
  const challanValid = docsByType("delivery_challan").length > 0;
  const stepStates = [
    { href: "vehicle-arrival", title: "Vehicle Arrival", status: String(grn.vehicle_number || "").trim() ? "complete" : "incomplete" },
    { href: "weighbridge", title: "Weighbridge", status: grossTareInvalid ? "blocked" : vehicleMismatch(values, grn) ? "warning" : !weighbridgeProvided ? "optional" : weighbridgeComplete ? "complete" : "incomplete" },
    { href: "delivery-documents", title: "Delivery Documents", status: challanMismatch(values, grn) ? "warning" : invoiceValid || challanValid ? "complete" : deliveryStarted ? "incomplete" : "incomplete" },
    { href: "material-receiving", title: "Material Receiving", status: materialBlockers.length ? "blocked" : materialResolved ? "complete" : materialStarted ? "incomplete" : "incomplete" },
    ...(weightItems.length ? [{ href: "weight-reconciliation", title: "Weight Reconciliation", status: status === "warning" ? "warning" : status === "match" ? "complete" : "incomplete" }] : []),
    { href: "final-review", title: "Final Review", status: reviewState.blockers.length ? "blocked" : reviewState.warnings.length ? "warning" : "complete" },
  ].map((step, index) => ({ ...step, number: String(index + 1) }));
  const finalReviewNumber = stepStates.find((step) => step.href === "final-review")?.number || "5";

  function scrollToStep(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    event.preventDefault();
    document.getElementById(href)?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.replaceState(null, "", `#${href}`);
  }

  return <div className="space-y-5">
    <nav aria-label="Receipt workflow progress" className={`flex max-w-full gap-2 overflow-x-auto pb-1 md:grid ${weightItems.length ? "md:grid-cols-6" : "md:grid-cols-5"} md:overflow-visible`}>{stepStates.map((step) => <a key={step.href} href={`#${step.href}`} onClick={(event) => scrollToStep(event, step.href)} className={`min-w-44 rounded-xl border p-3 text-sm shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-emerald-500 md:min-w-0 ${stepStatusClass(step.status)}`} aria-label={`${step.number}. ${step.title}: ${stepLabel(step.status)}`}><span className={`mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold ${stepIndicatorClass(step.status)}`}>{step.status === "complete" ? <CheckCircle2 className="h-4 w-4" /> : step.status === "warning" || step.status === "blocked" ? <AlertTriangle className="h-4 w-4" /> : <Circle className="h-3 w-3" />}</span><span className="font-semibold">{step.title}</span><span className="mt-2 block text-xs font-semibold uppercase">{stepLabel(step.status)}</span></a>)}</nav>
    <AlertMessage type="warning" message={message} onClose={() => setMessage("")} />

    <section id="vehicle-arrival" className="rounded-xl border bg-white p-5 shadow-sm">
      <StepTitle number="1" icon={<Camera className="h-5 w-5 text-emerald-700" />} title="Vehicle Arrival" />
      <label className="mt-4 block max-w-xl text-sm font-semibold">Vehicle Number
        <input disabled={disabled} value={grn.vehicle_number || ""} onChange={(event) => update("vehicle_number", event.target.value)} className="mt-1 h-10 w-full rounded border px-3" placeholder="Enter manually or verify from evidence" />
      </label>
      <EvidencePicker disabled={disabled} busy={busy} type="vehicle_overview" label="Vehicle Overview Photos" multiple onUpload={upload} />
      <DocumentCards documents={docsByType("vehicle_overview")} disabled={disabled} onRemove={removeDocument} />
      <EvidencePicker disabled={disabled} busy={busy} type="number_plate" label="Number Plate Photo (Optional)" onUpload={upload} />
      <DocumentCards documents={docsByType("number_plate")} disabled={disabled} feedback={documentFeedback} readingDocumentIds={readingDocumentIds} readLabel="Automatic Reading" onRead={(document) => void readDocument(document.id, "number_plate")} onRemove={removeDocument} />
      <p className="mt-2 text-xs text-slate-500">Number plate evidence and automatic reading are optional. Manual vehicle entry is always available.</p>
    </section>

    <section id="weighbridge" className="rounded-xl border bg-white p-5 shadow-sm">
      <StepTitle number="2" icon={<FileText className="h-5 w-5 text-emerald-700" />} title="Weighbridge" note="One physical slip containing Gross and Tare" />
      <EvidencePicker disabled={disabled} busy={busy} type="weighbridge_slip" label="Weighbridge Slip" onUpload={upload} />
      <DocumentCards documents={docsByType("weighbridge_slip")} disabled={disabled} feedback={documentFeedback} readingDocumentIds={readingDocumentIds} readLabel="Read Slip" onRead={(document) => void readDocument(document.id, "weighbridge_slip")} onRemove={removeDocument} />
      <div className="mt-5 max-w-xl"><VerifiedInput field="weighbridge_slip_number" label="Slip Number" disabled={disabled} latest={latest} grn={grn} setField={setField} onLocalValue={(value) => setLocalVerified((current) => ({ ...current, weighbridge_slip_number: value }))} /></div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border p-4">
          <h3 className="font-semibold">Loaded / Gross Weighing</h3>
          <div className="mt-3 grid gap-3">{[
            ["weighbridge_gross_date", "Gross Date"],
            ["weighbridge_gross_time", "Gross Time"],
            ["gross_weight", "Gross Weight"],
          ].map(([field, label]) => <VerifiedInput key={field} field={field} label={label} disabled={disabled} latest={latest} grn={grn} setField={setField} onLocalValue={(value) => setLocalVerified((current) => ({ ...current, [field]: value }))} />)}</div>
        </div>
        <div className="rounded-lg border p-4">
          <h3 className="font-semibold">Empty / Tare Weighing</h3>
          <div className="mt-3 grid gap-3">{[
            ["weighbridge_tare_date", "Tare Date"],
            ["weighbridge_tare_time", "Tare Time"],
            ["tare_weight", "Tare Weight"],
          ].map(([field, label]) => <VerifiedInput key={field} field={field} label={label} disabled={disabled} latest={latest} grn={grn} setField={setField} onLocalValue={(value) => setLocalVerified((current) => ({ ...current, [field]: value }))} />)}</div>
        </div>
      </div>
      <DocumentCrossCheck title="Vehicle cross-check" extracted={latest("weighbridge_vehicle_number")?.final_value} expected={grn.vehicle_number} />
      <div className="mt-4 border-t pt-4">
        <p className="text-xs font-semibold uppercase text-slate-500">Net Material Weight</p>
        <p className="text-2xl font-bold text-slate-950">{kgLabel(displayedNet)}</p>
        {grossTareInvalid && <p className="text-xs font-semibold text-red-700">Gross Weight must be greater than Tare Weight.</p>}
        <p className="text-xs text-slate-500">Calculated by the system from verified Gross minus verified Tare.</p>
      </div>
    </section>

    <section id="delivery-documents" className="rounded-xl border bg-white p-5 shadow-sm">
      <StepTitle number="3" icon={<FileText className="h-5 w-5 text-emerald-700" />} title="Delivery Documents" />
      <DocumentArea title="Delivery Challan Document" type="delivery_challan" disabled={disabled} busy={busy} feedback={documentFeedback} readingDocumentIds={readingDocumentIds} documents={docsByType("delivery_challan")} onUpload={upload} onRemove={removeDocument} onRead={(document) => void readDocument(document.id, "delivery_challan")} readLabel="Read Challan" />
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <DocumentArea title="Invoice" type="invoice" disabled={disabled} busy={busy} feedback={documentFeedback} readingDocumentIds={readingDocumentIds} documents={docsByType("invoice")} onUpload={upload} onRemove={removeDocument} onRead={(document) => void readDocument(document.id, "invoice")} readLabel="Read Invoice">
          <div className="mt-3 grid gap-3 md:grid-cols-2">{[["invoice_number", "Invoice Number"], ["invoice_date", "Invoice Date"]].map(([field, label]) => <VerifiedInput key={field} field={field} label={label} disabled={disabled} latest={latest} grn={grn} setField={setField} onLocalValue={(value) => setLocalVerified((current) => ({ ...current, [field]: value }))} />)}</div>
        </DocumentArea>
        <DocumentArea title="E-Way Bill" type="eway_bill" disabled={disabled} busy={busy} feedback={documentFeedback} readingDocumentIds={readingDocumentIds} documents={docsByType("eway_bill")} onUpload={upload} onRemove={removeDocument} />
        <DocumentArea title="LR / GR (Transport Receipt)" type="lr_gr" disabled={disabled} busy={busy} feedback={documentFeedback} readingDocumentIds={readingDocumentIds} multiple documents={docsByType("lr_gr")} onUpload={upload} onRemove={removeDocument} />
        <DocumentArea title="MTC / Test Certificate" type="mtc" disabled={disabled} busy={busy} feedback={documentFeedback} readingDocumentIds={readingDocumentIds} multiple documents={docsByType("mtc")} onUpload={upload} onRemove={removeDocument} />
        <DocumentArea title="Vehicle Entry Slip" type="vehicle_entry_slip" disabled={disabled} busy={busy} feedback={documentFeedback} readingDocumentIds={readingDocumentIds} documents={docsByType("vehicle_entry_slip")} onUpload={upload} onRemove={removeDocument} />
        <DocumentArea title="Other Documents" type="other" disabled={disabled} busy={busy} feedback={documentFeedback} readingDocumentIds={readingDocumentIds} multiple documents={docsByType("other")} onUpload={upload} onRemove={removeDocument} />
      </div>
    </section>

    <section id="material-receiving" className="rounded-xl border bg-white p-5 shadow-sm">
      <StepTitle number="4" icon={<Upload className="h-5 w-5 text-emerald-700" />} title="Material Receiving" />
      {children}
      <EvidencePicker disabled={disabled} busy={busy} type="material_unloading" label="Material / Unloading Photos" multiple onUpload={upload} />
      <DocumentCards documents={docsByType("material_unloading")} disabled={disabled} onRemove={removeDocument} />
      {(grn.items || []).some((item: any) => Number(item.rejected_quantity || 0) > 0) && <>
        <EvidencePicker disabled={disabled} busy={busy} type="rejected_material" label="Rejected Material Photos (Optional)" multiple onUpload={upload} />
        <DocumentCards documents={docsByType("rejected_material")} disabled={disabled} onRemove={removeDocument} />
      </>}
    </section>

    {weightItems.length > 0 && <section id="weight-reconciliation" className="rounded-xl border bg-white p-5 shadow-sm">
      <StepTitle number={stepStates.find((step) => step.href === "weight-reconciliation")?.number || "5"} icon={<RefreshCw className="h-5 w-5 text-emerald-700" />} title="Weight Reconciliation" note="Header-level reconciliation from supported weight lines" />
      <>
        <div className="mt-3 grid gap-3 text-sm md:grid-cols-3"><p>Normalized Received Weight: <strong>{kgLabel(receivedKg)}</strong></p><p>Weighbridge Net Weight: <strong>{kgLabel(displayedNet)}</strong></p><p>Difference: <strong>{kgLabel(reviewDifference)}</strong></p></div>
        <p className={`mt-3 text-sm font-semibold ${reconciliationStatusClass(status)}`}>Status: {reconciliationStatusLabel(status)}</p>
        <label className="mt-4 block text-sm">Review Remark
          <textarea disabled={disabled} value={grn.weight_reconciliation_remarks || ""} onChange={(event) => onChange({ ...grn, weight_reconciliation_remarks: event.target.value })} className="mt-1 min-h-20 w-full rounded border p-2" placeholder="Add context for a quantity difference (optional)" />
        </label>
      </>
    </section>}

    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <FreightSection grn={grn} disabled={disabled} onChange={onChange} />
      <label className="mt-4 block text-sm">Remarks
        <textarea disabled={disabled} value={grn.remarks || ""} onChange={(event) => update("remarks", event.target.value)} className="mt-1 min-h-20 w-full rounded border p-2" />
      </label>
    </section>

    <FinalReviewSummary grn={grn} documents={documents} values={values} disabled={disabled} stepNumber={finalReviewNumber} />
  </div>;
}

function StepTitle({ number, icon, title, note }: { number: string; icon: React.ReactNode; title: string; note?: string }) {
  return <div className="flex flex-wrap items-center gap-2"><span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-700 text-sm font-bold text-white">{number}</span>{icon}<h2 className="font-semibold">{title}</h2>{note && <span className="text-xs text-slate-500">{note}</span>}</div>;
}

function FreightSection({ grn, disabled, onChange }: { grn: any; disabled: boolean; onChange: (next: any) => void }) {
  const rule = poFreightRule(grn);
  const statusLabel = rule === "included" ? "Included in PO" : rule === "extra" ? "Payable Separately" : "Not specified in PO";
  const paidBy = rule === "extra" ? "bank" : grn.freight_paid_by || "cash";
  const set = (key: string, value: string) => onChange({ ...grn, [key]: value });
  return <div>
    <h2 className="font-semibold">Freight</h2>
    <div className="mt-4 grid gap-4 md:grid-cols-3">
      <div className="text-sm">
        <p className="font-semibold">PO Freight Status</p>
        <p className="mt-1 flex h-10 items-center rounded border bg-slate-50 px-3">{statusLabel}</p>
      </div>
      {rule !== "included" && <label className="text-sm font-semibold">Freight Paid By
        {rule === "extra" ? <p className="mt-1 flex h-10 items-center rounded border bg-slate-50 px-3 font-normal">Bank</p> : <select disabled={disabled} value={paidBy} onChange={(event) => set("freight_paid_by", event.target.value)} className="mt-1 h-10 w-full rounded border px-3 font-normal"><option value="cash">Cash</option><option value="bank">Bank</option><option value="vendor">Vendor</option></select>}
      </label>}
      {rule !== "included" && <label className="text-sm font-semibold">Freight Amount
        <input disabled={disabled} type="number" min="0" step="0.01" value={grn.freight_amount ?? ""} onChange={(event) => set("freight_amount", event.target.value)} className="mt-1 h-10 w-full rounded border px-3 font-normal" placeholder="₹" />
      </label>}
    </div>
  </div>;
}

function VerifiedInput({ field, label, disabled, latest, grn, setField, onLocalValue }: { field: string; label: string; disabled: boolean; latest: (field: string) => any; grn: any; setField: (field: string, value: string, source: "manual" | "corrected_ocr") => void; onLocalValue?: (value: string) => void }) {
  const saved = latest(field);
  const serverValue = saved?.final_value || (field === "vehicle_number" ? grn.vehicle_number || "" : "");
  const [value, setValue] = useState(serverValue);
  const [error, setError] = useState("");
  const focused = useRef(false);
  const lastSaved = useRef(serverValue);
  function normalizedForSave(rawValue: string) {
    const trimmed = rawValue.trim();
    if (!trimmed) return ["gross_weight", "tare_weight"].includes(field) ? "" : null;
    if (["gross_weight", "tare_weight"].includes(field)) {
      if (!/^\d+(\.\d+)?$/.test(trimmed) || Number(trimmed) <= 0) return null;
    }
    if (["weighbridge_slip_time", "weighbridge_gross_time", "weighbridge_tare_time"].includes(field)) {
      const match = trimmed.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
      if (!match) return null;
      return `${match[1].padStart(2, "0")}:${match[2]}`;
    }
    return trimmed;
  }
  useEffect(() => {
    if (!focused.current && serverValue !== lastSaved.current) {
      setValue(serverValue);
      lastSaved.current = serverValue;
    }
  }, [serverValue]);
  useEffect(() => {
    if (disabled || value === lastSaved.current) return;
    const timer = window.setTimeout(async () => {
      const normalized = normalizedForSave(String(value));
      if (normalized === null) {
        if (String(value).trim()) setError(["weighbridge_slip_time", "weighbridge_gross_time", "weighbridge_tare_time"].includes(field) ? "Enter a valid time in HH:MM or HH:MM:SS format." : "Enter a positive number.");
        return;
      }
      setError("");
      await setField(field, normalized, saved?.source_type === "ocr" ? "corrected_ocr" : "manual");
      lastSaved.current = normalized;
      if (["weighbridge_slip_time", "weighbridge_gross_time", "weighbridge_tare_time"].includes(field) && normalized !== value) setValue(normalized);
    }, 850);
    return () => window.clearTimeout(timer);
  }, [disabled, field, saved?.source_type, setField, value]);
  return <label className="text-sm font-semibold">{label}
    <input disabled={disabled} type={field.endsWith("date") ? "date" : "text"} value={value} onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; }} onChange={(event) => { setValue(event.target.value); onLocalValue?.(event.target.value); }} className="mt-1 h-10 w-full rounded border px-3" />
    {error && <span className="text-xs font-normal text-red-700">{error}</span>}
    {saved && <span className="text-xs font-normal text-slate-500">{saved.source_type === "ocr" ? "Automatic reading accepted" : saved.source_type === "corrected_ocr" ? "Corrected from automatic reading" : saved.source_type === "system_calculated" ? "System calculated" : "Manually entered"}</span>}
  </label>;
}

function EvidencePicker({ disabled, busy, type, label, multiple, onUpload }: { disabled: boolean; busy: boolean; type: string; label: string; multiple?: boolean; onUpload: (file: File, type: string) => void }) {
  return <div className="mt-4"><p className="text-sm font-semibold">{label}</p><div className="mt-2 flex flex-wrap gap-2"><StampedEvidenceCapture disabled={disabled || busy} onCapture={(file) => onUpload(file, type)} /><label className="inline-flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm font-semibold"><Upload className="h-4 w-4" />Upload<input disabled={disabled || busy} type="file" accept="image/*,.pdf" multiple={multiple} className="sr-only" onChange={(event) => { for (const file of Array.from(event.target.files || [])) onUpload(file, type); event.currentTarget.value = ""; }} /></label>{busy && <RefreshCw className="h-5 w-5 animate-spin text-slate-500" />}</div></div>;
}

function DocumentArea({ title, type, disabled, busy, feedback, readingDocumentIds, multiple, documents, onUpload, onRemove, onRead, readLabel, children }: { title: string; type: string; disabled: boolean; busy: boolean; feedback: Record<string, DocumentFeedback>; readingDocumentIds: Set<string>; multiple?: boolean; documents: any[]; onUpload: (file: File, type: string) => void; onRemove: (documentId: string) => void; onRead?: (document: any) => void; readLabel?: string; children?: React.ReactNode }) {
  return <div className="rounded-lg border p-4"><h3 className="font-semibold">{title}</h3>{children}<EvidencePicker disabled={disabled} busy={busy} type={type} label={type === "invoice" ? "Invoice Document" : `Add ${title}`} multiple={multiple} onUpload={onUpload} />{feedback[type] && <DocumentFeedbackView feedback={feedback[type]} /> }<DocumentCards documents={documents} disabled={disabled} feedback={feedback} readingDocumentIds={readingDocumentIds} readLabel={readLabel} onRead={onRead} onRemove={onRemove} /></div>;
}

function DocumentFeedbackView({ feedback }: { feedback: DocumentFeedback }) {
  const tone = feedback.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : feedback.tone === "loading" ? "border-slate-200 bg-slate-50 text-slate-700" : feedback.tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800";
  return <div className={`mt-3 rounded border p-3 text-sm ${tone}`}><p className="flex items-center gap-2 font-semibold">{feedback.tone === "loading" ? <RefreshCw className="h-4 w-4 animate-spin" /> : feedback.tone === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}{feedback.message}</p>{feedback.helper && <p className="mt-1 text-xs font-normal">{feedback.helper}</p>}</div>;
}

function DocumentCards({ documents, disabled, feedback = {}, readingDocumentIds = new Set<string>(), readLabel, onRead, onRemove }: { documents: any[]; disabled: boolean; feedback?: Record<string, DocumentFeedback>; readingDocumentIds?: Set<string>; readLabel?: string; onRead?: (document: any) => void; onRemove: (documentId: string) => void }) {
  if (!documents.length) return <p className="mt-3 text-sm text-slate-500">No saved evidence yet.</p>;
  return <div className="mt-3 grid gap-3 md:grid-cols-2">{documents.map((document) => <div key={document.id} className="rounded-lg border bg-slate-50 p-3 text-sm"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{labelFor(document.document_type)}</p><a href={document.signed_url} target="_blank" rel="noreferrer" className="break-all underline">{document.original_file_name}</a><p className="mt-1 text-xs text-slate-500">Saved {document.created_at || ""}{document.created_by_name ? ` by ${document.created_by_name}` : ""}</p></div>{!disabled && <button type="button" onClick={() => void onRemove(document.id)} className="rounded border bg-white p-2 text-red-700" title="Remove evidence"><Trash2 className="h-4 w-4" /></button>}</div>{onRead && !disabled && <button disabled={readingDocumentIds.has(document.id)} type="button" onClick={() => onRead(document)} className="mt-3 inline-flex items-center gap-2 rounded border bg-white px-3 py-2 text-xs font-semibold"><WandSparkles className="h-4 w-4" />{readingDocumentIds.has(document.id) ? "Reading..." : readLabel || "Automatic Reading"}</button>}{feedback[document.id] && <DocumentFeedbackView feedback={feedback[document.id]} />}</div>)}</div>;
}

function DocumentCrossCheck({ title, extracted, expected }: { title: string; extracted: unknown; expected: unknown }) {
  const documentValue = String(extracted || "").trim();
  const expectedValue = String(expected || "").trim();
  if (!documentValue) return null;
  const normalizedDocument = documentValue.toUpperCase().replace(/[\s-]/g, "");
  const normalizedExpected = expectedValue.toUpperCase().replace(/[\s-]/g, "");
  const matched = Boolean(expectedValue) && normalizedDocument === normalizedExpected;
  return <p className={`mt-3 rounded-lg border p-3 text-sm ${matched ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{title}: {matched ? `Matched: ${documentValue}` : `Warning: document ${documentValue} does not match receipt ${expectedValue || "value"}.`}</p>;
}

function normalizedMatchText(value: unknown) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function challanBaseRows(grn: any) {
  return (grn.items || []).map((item: any) => ({
    purchase_order_item_id: item.purchase_order_item_id,
    item_code: item.item_code_snapshot || "",
    description: item.item_name_snapshot || "",
    specification: item.specification_snapshot || "",
    make: item.make_snapshot || "",
    po_quantity: item.ordered_quantity_snapshot ?? "",
    uom: item.uom_snapshot || "",
    quantity: "",
    match_status: "PO item",
    other: false,
  }));
}

function scoreChallanMatch(line: any, row: any) {
  const lineCode = normalizedMatchText(line.item_code);
  const rowCode = normalizedMatchText(row.item_code);
  if (lineCode && rowCode && lineCode === rowCode) return 5;
  const lineText = normalizedMatchText([line.description, line.uom].filter(Boolean).join(" "));
  const rowName = normalizedMatchText(row.description);
  const rowSpec = normalizedMatchText(row.specification);
  const rowMake = normalizedMatchText(row.make);
  let score = 0;
  if (lineText && rowName && lineText === rowName) score += 4;
  else if (lineText.length >= 8 && rowName.length >= 8 && (lineText.includes(rowName) || rowName.includes(lineText))) score += 3;
  if (rowSpec && lineText.includes(rowSpec)) score += 1;
  if (rowMake && lineText.includes(rowMake)) score += 1;
  return score;
}

function parseChallanItems(value: unknown, grn: any) {
  const rows = challanBaseRows(grn);
  try {
    const parsed = JSON.parse(String(value || "[]"));
    if (!Array.isArray(parsed)) return rows;
    const used = new Set<string>();
    const otherRows: any[] = [];
    for (const item of parsed) {
      const line = {
        purchase_order_item_id: String(item.purchase_order_item_id || ""),
        item_code: String(item.item_code || ""),
        description: String(item.description || ""),
        specification: String(item.specification || ""),
        make: String(item.make || ""),
        po_quantity: item.po_quantity ?? "",
        uom: String(item.uom || ""),
        quantity: String(item.quantity || ""),
        match_status: String(item.match_status || ""),
        other: item.other === true,
      };
      const directIndex = line.purchase_order_item_id ? rows.findIndex((row: any) => row.purchase_order_item_id === line.purchase_order_item_id) : -1;
      if (directIndex >= 0) {
        rows[directIndex] = { ...rows[directIndex], item_code: line.item_code || rows[directIndex].item_code, description: line.description || rows[directIndex].description, uom: line.uom || rows[directIndex].uom, quantity: line.quantity, match_status: line.match_status || "Matched" };
        used.add(rows[directIndex].purchase_order_item_id);
        continue;
      }
      const scored = rows
        .filter((row: any) => !used.has(row.purchase_order_item_id))
        .map((row: any) => ({ row, score: scoreChallanMatch(line, row) }))
        .filter((entry: any) => entry.score >= 3)
        .sort((a: any, b: any) => b.score - a.score);
      if (scored.length === 1 || (scored[0] && scored[1] && scored[0].score > scored[1].score)) {
        const index = rows.findIndex((row: any) => row.purchase_order_item_id === scored[0].row.purchase_order_item_id);
        rows[index] = { ...rows[index], item_code: line.item_code || rows[index].item_code, description: line.description || rows[index].description, uom: line.uom || rows[index].uom, quantity: line.quantity, match_status: line.match_status || "OCR matched" };
        used.add(rows[index].purchase_order_item_id);
      } else if (line.description || line.quantity || line.uom || line.item_code) {
        otherRows.push({ ...line, other: true, match_status: line.match_status || "Unmatched" });
      }
    }
    return [...rows, ...otherRows];
  } catch {}
  return rows;
}

function ChallanItemsEditor({ grn, disabled, latest, setField }: { grn: any; disabled: boolean; latest: (field: string) => any; setField: (field: string, value: string, source: "manual" | "corrected_ocr") => void }) {
  const saved = latest("challan_items_json");
  const [items, setItems] = useState(() => parseChallanItems(saved?.final_value, grn));
  const focused = useRef(false);
  const serialized = JSON.stringify(items.filter((item) => item.quantity || item.other).map((item) => ({
    purchase_order_item_id: item.other ? "" : item.purchase_order_item_id,
    item_code: item.item_code || "",
    description: item.description || "",
    specification: item.specification || "",
    make: item.make || "",
    po_quantity: item.po_quantity ?? "",
    uom: item.uom || "",
    quantity: item.quantity || "",
    match_status: item.match_status || "",
    other: item.other === true,
  })));
  useEffect(() => {
    if (!focused.current) setItems(parseChallanItems(saved?.final_value, grn));
  }, [grn, saved?.final_value]);
  useEffect(() => {
    if (disabled || serialized === (saved?.final_value || "[]")) return;
    const timer = window.setTimeout(() => void setField("challan_items_json", serialized, saved?.source_type === "ocr" ? "corrected_ocr" : "manual"), 850);
    return () => window.clearTimeout(timer);
  }, [disabled, saved?.final_value, saved?.source_type, serialized, setField]);
  function update(index: number, key: string, value: string) {
    focused.current = true;
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  }
  function addOtherItem() {
    focused.current = true;
    setItems((current) => [...current, { purchase_order_item_id: "", item_code: "", description: "", specification: "", make: "", po_quantity: "", uom: "", quantity: "", match_status: "Manual other item", other: true }]);
  }
  return <div className="mt-5 rounded-lg border p-4">
    <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Challan Items</h3>{!disabled && <button type="button" onClick={addOtherItem} className="rounded border px-3 py-1 text-xs font-semibold">+ Add Other Item</button>}</div>
    <div className="mt-3 hidden max-w-full overflow-x-auto md:block"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{["Material / Code", "Specification", "PO Qty", "UOM", "Challan Qty"].map((heading) => <th key={heading} className="p-3">{heading}</th>)}</tr></thead><tbody className="divide-y">{items.map((item, index) => <tr key={`${item.purchase_order_item_id || "other"}-${index}`}><td className="p-3"><input disabled={disabled} value={item.item_code} onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; }} onChange={(event) => update(index, "item_code", event.target.value)} placeholder="Item code" className="h-9 w-full rounded border px-3 text-sm" /><input disabled={disabled} value={item.description} onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; }} onChange={(event) => update(index, "description", event.target.value)} placeholder="Material / Description" className="mt-2 h-9 w-full rounded border px-3 text-sm" />{item.make && <p className="mt-1 text-xs text-slate-500">Make: {item.make}</p>}</td><td className="p-3">{item.specification || "-"}</td><td className="p-3">{item.other ? "-" : item.po_quantity}</td><td className="p-3"><input disabled={disabled} value={item.uom} onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; }} onChange={(event) => update(index, "uom", event.target.value)} placeholder="UOM" className="h-10 w-32 rounded border px-3 text-sm" /></td><td className="p-3"><input disabled={disabled} value={item.quantity} onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; }} onChange={(event) => update(index, "quantity", event.target.value)} placeholder="Qty" className="h-10 w-32 rounded border px-3 text-sm" /></td></tr>)}</tbody></table></div>
    <div className="mt-3 space-y-3 md:hidden">{items.map((item, index) => <section key={`${item.purchase_order_item_id || "other"}-${index}`} className="rounded-lg border bg-slate-50 p-3"><div className="text-sm"><input disabled={disabled} value={item.item_code} onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; }} onChange={(event) => update(index, "item_code", event.target.value)} placeholder="Item code" className="h-9 w-full rounded border bg-white px-2" /><input disabled={disabled} value={item.description} onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; }} onChange={(event) => update(index, "description", event.target.value)} placeholder="Item / Description" className="mt-2 h-9 w-full rounded border bg-white px-2" /><p className="mt-1 text-xs text-slate-500">{item.specification || "-"}{item.make ? ` - ${item.make}` : ""}</p></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><p>PO Qty<br /><strong>{item.other ? "-" : item.po_quantity}</strong></p><label>UOM<input disabled={disabled} value={item.uom} onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; }} onChange={(event) => update(index, "uom", event.target.value)} placeholder="UOM" className="mt-1 h-9 w-full rounded border bg-white px-2" /></label></div><label className="mt-3 block text-xs font-semibold">Challan Qty<input disabled={disabled} value={item.quantity} onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; }} onChange={(event) => update(index, "quantity", event.target.value)} placeholder="Qty" className="mt-1 h-10 w-full rounded border bg-white px-3" /></label></section>)}</div>
  </div>;
}

function FinalReviewSummary({ grn, documents, values, disabled, stepNumber }: { grn: any; documents: any[]; values: any[]; disabled: boolean; stepNumber: string }) {
  const freightRule = poFreightRule(grn);
  const freightStatus = freightRule === "included" ? "Included in PO" : freightRule === "extra" ? "Payable Separately" : "Not specified in PO";
  const freightPaidBy = freightRule === "extra" ? "Bank" : grn.freight_paid_by ? String(grn.freight_paid_by).replace(/^\w/, (letter) => letter.toUpperCase()) : "Cash";
  const weightItems = receiptWeightItems(grn);
  const gross = values.find((value) => value.field_name === "gross_weight")?.final_value;
  const tare = values.find((value) => value.field_name === "tare_weight")?.final_value;
  const grossDate = verifiedValue(values, "weighbridge_gross_date", "weighbridge_slip_date");
  const grossTime = verifiedValue(values, "weighbridge_gross_time", "weighbridge_slip_time");
  const tareDate = verifiedValue(values, "weighbridge_tare_date");
  const tareTime = verifiedValue(values, "weighbridge_tare_time");
  const grossNumber = gross === undefined || gross === null || String(gross).trim() === "" ? null : Number(gross);
  const tareNumber = tare === undefined || tare === null || String(tare).trim() === "" ? null : Number(tare);
  const net = grn.weighbridge_net_kg == null && grossNumber !== null && tareNumber !== null && Number.isFinite(grossNumber) && Number.isFinite(tareNumber) && grossNumber > tareNumber ? Number((grossNumber - tareNumber).toFixed(3)) : grn.weighbridge_net_kg == null ? null : Number(grn.weighbridge_net_kg);
  const receivedKg = grn.normalized_received_kg == null ? null : Number(grn.normalized_received_kg);
  const reviewDifference = grn.weight_difference_kg === undefined || grn.weight_difference_kg === null ? null : Number(grn.weight_difference_kg);
  const status = grn.weight_reconciliation_status;
  const { blockers, warnings } = receiptReviewState(grn, documents, values, weightItems);
  const evidenceSummary = documentTypes.map(([type, label]) => ({ type, label, count: documents.filter((document) => document.document_type === type).length })).filter((entry) => entry.count > 0);
  return <section id="final-review" className="rounded-xl border bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><StepTitle number={stepNumber} icon={<FileText className="h-5 w-5 text-emerald-700" />} title="Final Review" /><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${disabled ? "" : blockers.length ? "text-red-700" : "text-emerald-700"}`}>{disabled ? "FINALIZED" : blockers.length ? "CANNOT FINALIZE YET" : "READY TO FINALIZE"}</span></div><div className="mt-4 grid gap-4 text-sm md:grid-cols-2"><div><h3 className="font-semibold text-red-700">Blockers</h3>{blockers.length ? blockers.map((item) => <p key={item} className="mt-1">{item}</p>) : <p className="mt-1">None</p>}</div><div><h3 className="font-semibold text-amber-700">Warnings</h3>{warnings.length ? warnings.map((item) => <p key={item} className="mt-1">{item}</p>) : <p className="mt-1">None</p>}</div></div><div className="mt-4 grid gap-2 text-sm md:grid-cols-2"><p>Receipt: <strong>{grn.grn_number}</strong></p><p>Purchase Order: <strong>{grn.po_snapshot?.po_number || grn.purchase_order?.po_number || "-"}</strong></p><p>Company: <strong>{grn.company?.company_name || "-"}</strong></p><p>Site: <strong>{grn.site?.site_name || "-"}</strong></p><p>Vendor: <strong>{grn.po_snapshot?.vendor_name || grn.purchase_order?.vendor_name_snapshot || "-"}</strong></p><p>Vehicle: <strong>{grn.vehicle_number || values.find((value) => value.field_name === "vehicle_number")?.final_value || "Not entered"}</strong></p><p>Freight: <strong>{freightStatus}</strong></p>{freightRule !== "included" && <><p>Paid By: <strong>{freightPaidBy}</strong></p><p>Amount: <strong>{money(grn.freight_amount)}</strong></p></>}<p>Weighbridge Slip: <strong>{documents.some((document) => document.document_type === "weighbridge_slip") ? "Attached" : "Not Attached"}</strong></p><p>Loaded / Gross: <strong>{dateTimeLabel(grossDate, grossTime)}</strong><br /><strong>{kgLabel(gross)}</strong></p><p>Empty / Tare: <strong>{dateTimeLabel(tareDate, tareTime)}</strong><br /><strong>{kgLabel(tare)}</strong></p><p>Net: <strong>{kgLabel(net)}</strong></p><p>Accepted / Rejected / Hold: <strong>{(grn.items || []).reduce((n: number, item: any) => n + Number(item.accepted_quantity || 0), 0)} / {(grn.items || []).reduce((n: number, item: any) => n + Number(item.rejected_quantity || 0), 0)} / {(grn.items || []).reduce((n: number, item: any) => n + Number(item.hold_quantity || 0), 0)}</strong></p>{weightItems.length > 0 && <><p>Weight Reconciliation: <strong className={reconciliationStatusClass(status)}>{reconciliationStatusLabel(status)}</strong></p><p>Normalized Received: <strong>{kgLabel(receivedKg)}</strong></p><p>Difference: <strong>{kgLabel(reviewDifference)}</strong></p><p>Review Remark: <strong>{grn.weight_reconciliation_remarks || "-"}</strong></p></>}</div>{evidenceSummary.length > 0 && <div className="mt-4 border-t pt-4"><h3 className="font-semibold">Evidence Summary</h3><div className="mt-2 grid gap-2 text-sm md:grid-cols-2">{evidenceSummary.map((entry) => <p key={entry.type}>{entry.label}: <strong>{entry.count} attached</strong></p>)}</div></div>}</section>;
}

function ChallanCrossCheck({ values, grn }: { values: any[]; grn: any }) {
  const get = (field: string) => values.find((value) => value.field_name === field)?.final_value || "";
  const clean = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  const vehicle = (value: string) => value.toUpperCase().replace(/[\s-]/g, "");
  const checks = [
    ["Purchase Order", get("challan_po_number"), grn.po_snapshot?.po_number || grn.purchase_order?.po_number, "Delivery Challan PO Number does not match this receipt's Purchase Order."],
    ["Vendor", get("challan_vendor"), grn.po_snapshot?.vendor_name || grn.purchase_order?.vendor_name_snapshot, "Delivery Challan Vendor does not match the Purchase Order Vendor."],
    ["Vehicle Number", vehicle(get("challan_vehicle_number")), vehicle(grn.vehicle_number || ""), "Delivery Challan Vehicle Number differs from the receipt Vehicle Number."],
  ];
  const visible = checks.map(([label, documentValue, authoritative, warning]) => {
    if (!documentValue) return null;
    const match = Boolean(authoritative) && (label === "Vehicle Number" ? documentValue === authoritative : clean(String(documentValue)) === clean(String(authoritative)));
    return { label, match, warning };
  }).filter(Boolean);
  if (!visible.length) return null;
  return <div className="mt-4 border-t pt-4"><h3 className="font-semibold">Delivery Challan Cross-Checks</h3>{visible.map((check: any) => <p key={check.label} className={`mt-2 rounded-lg border p-3 text-sm ${check.match ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}><strong>{check.label}:</strong> {check.match ? "Matched" : check.warning}</p>)}</div>;
}
