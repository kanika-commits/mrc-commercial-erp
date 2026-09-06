import { NextResponse } from "next/server";
import { adminClient, applyCompanySiteAccess, applyOrganizationAccess, jsonError, requireProcurementAny, text } from "@/lib/serverProcurementAccess";

const MODULE = "procurement_goods_receipts";
const OCR_TIMEOUT_MS = 60000;
const OCR_PRIMARY_MODEL = "gemini-3.5-flash-lite";
const OCR_FALLBACK_MODEL = "gemini-3.6-flash";
const SUPPORTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const TRANSIENT_PROVIDER_STATUSES = new Set([429, 500, 502, 503, 504]);

class OcrError extends Error {
  constructor(readonly retryable: boolean, message = "Automatic reading is unavailable. Enter the values manually.", readonly status?: number) {
    super(message);
    this.name = "OcrError";
  }
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeDate(value: unknown) {
  const raw = clean(value);
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return raw;
  const slash = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (!slash) return raw;
  const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
  return `${year}-${slash[2].padStart(2, "0")}-${slash[1].padStart(2, "0")}`;
}

function normalizeTime(value: unknown) {
  const raw = clean(value).replace(/[.\s]+/g, ":");
  const match = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
}

function normalizeWeight(value: unknown) {
  const raw = clean(value);
  if (!raw) return "";
  const number = Number(raw.replace(/,/g, "").match(/\d+(?:\.\d+)?/)?.[0] || "");
  return Number.isFinite(number) && number > 0 ? String(number) : raw;
}

function normalizeVehicle(value: unknown) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function extractionPrompt(documentType: string) {
  const scope = documentType === "weighbridge_slip" ? "weighbridge slip" : documentType === "invoice" ? "invoice" : "delivery challan";
  return [
    `Extract structured fields from this GRN ${scope}.`,
    "The document may be Hindi, English, or mixed Hindi/English, and may be rotated, skewed, dot-matrix printed, unevenly lit, stamped, or handwritten around printed data.",
    "Do not assume a fixed template or exact labels.",
    "Return JSON only using the schema.",
    "Extract only visible values. Use null for fields that are not visible or uncertain.",
    documentType === "weighbridge_slip"
      ? "Fields: slip number, loaded/gross weighing date, loaded/gross weighing time, gross/loaded weight, empty/tare weighing date, empty/tare weighing time, tare/empty weight, vehicle number. If the slip has only one visible date or time, return it in slip_date or slip_time and leave unknown distinct gross/tare date/time fields null."
      : documentType === "delivery_challan"
        ? "Fields: challan number, challan date, purchase order number, vendor name, vehicle number, and every visible material line with item code, exact description, quantity, and UOM. Do not combine lines or return a document total as an item quantity."
        : "Fields: invoice number, invoice date, and every visible material line with item code, exact description, quantity, and UOM. Do not derive quantity from amount, rate, tax, HSN, or invoice total. Do not combine lines or return a document total as an item quantity.",
    "Return weights as numeric strings in kilograms when the document clearly shows kilograms; otherwise return the visible numeric value and unit separately.",
    "Do not calculate net weight.",
  ].join(" ");
}

function responseSchema() {
  return {
    type: "OBJECT",
    properties: {
      slip_number: { type: "STRING", nullable: true },
      slip_date: { type: "STRING", nullable: true },
      slip_time: { type: "STRING", nullable: true },
      gross_date: { type: "STRING", nullable: true },
      gross_time: { type: "STRING", nullable: true },
      gross_weight: { type: "STRING", nullable: true },
      tare_date: { type: "STRING", nullable: true },
      tare_time: { type: "STRING", nullable: true },
      tare_weight: { type: "STRING", nullable: true },
      weight_unit: { type: "STRING", nullable: true },
      vehicle_number: { type: "STRING", nullable: true },
      challan_number: { type: "STRING", nullable: true },
      challan_date: { type: "STRING", nullable: true },
      challan_po_number: { type: "STRING", nullable: true },
      challan_vendor: { type: "STRING", nullable: true },
      invoice_number: { type: "STRING", nullable: true },
      invoice_date: { type: "STRING", nullable: true },
      challan_items: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            item_code: { type: "STRING", nullable: true },
            description: { type: "STRING", nullable: true },
            quantity: { type: "STRING", nullable: true },
            uom: { type: "STRING", nullable: true },
          },
          required: ["item_code", "description", "quantity", "uom"],
        },
      },
      invoice_items: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            item_code: { type: "STRING", nullable: true },
            description: { type: "STRING", nullable: true },
            quantity: { type: "STRING", nullable: true },
            uom: { type: "STRING", nullable: true },
          },
          required: ["item_code", "description", "quantity", "uom"],
        },
      },
      confidence: { type: "NUMBER", nullable: true },
    },
    required: ["slip_number", "slip_date", "slip_time", "gross_date", "gross_time", "gross_weight", "tare_date", "tare_time", "tare_weight", "weight_unit", "vehicle_number", "challan_number", "challan_date", "challan_po_number", "challan_vendor", "challan_items", "confidence"],
  };
}

function fieldsFromExtraction(extraction: any, documentType: string) {
  const extractedItems = documentType === "invoice" ? extraction?.invoice_items : extraction?.challan_items;
  const documentItems = Array.isArray(extractedItems)
    ? extractedItems.map((item: any) => ({
      item_code: clean(item?.item_code),
      description: clean(item?.description),
      quantity: clean(item?.quantity),
      uom: clean(item?.uom),
      match_status: "OCR extracted",
    })).filter((item: any) => item.item_code || item.description || item.quantity || item.uom)
    : [];
  const grossDate = normalizeDate(extraction?.gross_date) || normalizeDate(extraction?.slip_date);
  const grossTime = normalizeTime(extraction?.gross_time) || normalizeTime(extraction?.slip_time);
  const tareDate = normalizeDate(extraction?.tare_date);
  const tareTime = normalizeTime(extraction?.tare_time);
  const candidates = documentType === "weighbridge_slip" ? [
    ["weighbridge_slip_number", "Slip Number", clean(extraction?.slip_number)],
    ["weighbridge_gross_date", "Gross Date", grossDate, clean(extraction?.gross_date) || clean(extraction?.slip_date)],
    ["weighbridge_gross_time", "Gross Time", grossTime, clean(extraction?.gross_time) || clean(extraction?.slip_time)],
    ["gross_weight", "Loaded / Gross Weight", normalizeWeight(extraction?.gross_weight)],
    ["weighbridge_tare_date", "Tare Date", tareDate, clean(extraction?.tare_date)],
    ["weighbridge_tare_time", "Tare Time", tareTime, clean(extraction?.tare_time)],
    ["tare_weight", "Empty / Tare Weight", normalizeWeight(extraction?.tare_weight)],
    ["vehicle_number", "Vehicle Number", normalizeVehicle(extraction?.vehicle_number)],
  ] : [
    ["challan_number", "Challan Number", clean(extraction?.challan_number)],
    ["challan_date", "Challan Date", normalizeDate(extraction?.challan_date)],
    ["challan_po_number", "Purchase Order Number", clean(extraction?.challan_po_number)],
    ["challan_vendor", "Vendor", clean(extraction?.challan_vendor)],
    ["challan_vehicle_number", "Vehicle Number", normalizeVehicle(extraction?.vehicle_number)],
    ["challan_items_json", "Challan Items", documentItems.length ? JSON.stringify(documentItems) : ""],
  ];
  if (documentType === "invoice") candidates.splice(0, candidates.length, ["invoice_number", "Invoice Number", clean(extraction?.invoice_number)], ["invoice_date", "Invoice Date", normalizeDate(extraction?.invoice_date)], ["invoice_items_json", "Invoice Items", documentItems.length ? JSON.stringify(documentItems) : ""]);
  const confidence = typeof extraction?.confidence === "number" ? Math.max(0, Math.min(1, extraction.confidence)) : null;
  return candidates
    .filter(([, , value]) => clean(value))
    .map(([field_name, label, value, original]) => ({ field_name, label, final_value: value, original_extracted_value: clean(original) || value, confidence }));
}

function parseProviderPayload(payload: any) {
  const candidate = payload?.candidates?.[0];
  if (!candidate) throw new OcrError(true);
  const finishReason = clean(candidate?.finishReason);
  if (finishReason === "MAX_TOKENS") throw new OcrError(true);
  if (finishReason && finishReason !== "STOP") throw new OcrError(false);
  const outputText = candidate?.content?.parts?.find((part: any) => typeof part.text === "string")?.text;
  if (!outputText) throw new OcrError(true);
  try {
    return JSON.parse(outputText);
  } catch {
    throw new OcrError(true);
  }
}

async function callProvider(file: Blob, mimeType: string, documentType: string, model: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new OcrError(false);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: extractionPrompt(documentType) },
            { inline_data: { mime_type: mimeType, data: Buffer.from(await file.arrayBuffer()).toString("base64") } },
          ],
        }],
        generationConfig: {
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
          responseSchema: responseSchema(),
          thinkingConfig: { thinkingLevel: "minimal" },
        },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new OcrError(TRANSIENT_PROVIDER_STATUSES.has(response.status), "Automatic reading is unavailable. Enter the values manually.", response.status);
    return parseProviderPayload(payload);
  } catch (error: any) {
    if (error?.name === "AbortError") throw new OcrError(false);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function extract(file: Blob, mimeType: string, documentType: string) {
  const primaryModel = clean(process.env.GEMINI_OCR_PRIMARY_MODEL) || OCR_PRIMARY_MODEL;
  const fallbackModel = clean(process.env.GEMINI_OCR_FALLBACK_MODEL) || OCR_FALLBACK_MODEL;
  try {
    return await callProvider(file, mimeType, documentType, primaryModel);
  } catch (error) {
    if (error instanceof OcrError && error.retryable) return callProvider(file, mimeType, documentType, fallbackModel);
    throw error;
  }
}

async function load(request: Request, id: string) {
  const access = await requireProcurementAny(request, [{ moduleCode: MODULE, actionCode: "view" }, { moduleCode: MODULE, actionCode: "edit" }]);
  if ("response" in access) return { response: access.response } as const;
  const admin = adminClient();
  let query: any = applyOrganizationAccess(admin.from("procurement_goods_receipts").select("id,organization_id,company_id,site_id,status").eq("id", id).maybeSingle(), access);
  query = query && applyCompanySiteAccess(query, access);
  if (!query) return { response: jsonError("Goods Receipt Note was not found.", 404) } as const;
  const { data, error } = await query;
  if (error) throw error;
  if (!data) return { response: jsonError("Goods Receipt Note was not found.", 404) } as const;
  return { access, admin, row: data } as const;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const result = await load(request, id);
    if ("response" in result) return result.response;
    if (result.row.status !== "draft") return jsonError("Finalized Goods Receipt Notes are read-only.", 403);
    const body = await request.json().catch(() => ({}));
    const documentId = text(body.document_id);
    const documentType = text(body.document_type) || "weighbridge_slip";
    if (!documentId) return jsonError("Document ID is required.", 400);
    const { data: document, error } = await result.admin.from("procurement_goods_receipt_documents").select("id,document_type,storage_bucket,storage_key,mime_type,status").eq("id", documentId).eq("grn_id", id).eq("organization_id", result.row.organization_id).eq("status", "active").maybeSingle();
    if (error) throw error;
    if (!document) return jsonError("Document was not found.", 404);
    if (!["weighbridge_slip", "delivery_challan", "invoice"].includes(document.document_type)) return NextResponse.json({ extraction_status: "unsupported", values: [], message: "Automatic reading is unavailable. Enter the values manually." });
    if (!SUPPORTED_MIME_TYPES.has(document.mime_type)) return NextResponse.json({ extraction_status: "unsupported", values: [], message: "Automatic reading is unavailable. Enter the values manually." });
    if (!process.env.GEMINI_API_KEY) return NextResponse.json({ extraction_status: "unavailable", values: [], message: "Automatic reading is unavailable. Enter the values manually." });
    const downloaded = await result.admin.storage.from(document.storage_bucket).download(document.storage_key);
    if (downloaded.error || !downloaded.data) throw new OcrError(false);
    const extraction = await extract(downloaded.data, document.mime_type, document.document_type);
    const values = fieldsFromExtraction(extraction, document.document_type);
    return NextResponse.json({
      extraction_status: values.length ? "extracted" : "no_fields",
      values,
      message: values.length ? "Automatic reading completed. Review or correct the values as needed." : "Automatic reading is unavailable. Enter the values manually.",
    });
  } catch (error: any) {
    if (error instanceof OcrError) return NextResponse.json({ extraction_status: "unavailable", values: [], message: error.message });
    return jsonError(error.message || "Automatic reading is unavailable. Enter the values manually.", 500);
  }
}
