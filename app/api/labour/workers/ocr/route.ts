import { NextResponse } from "next/server";
import {
  jsonError,
  requireLabourPermission,
  resolveOrganizationId,
  validateLabourCompanySiteIndependent,
} from "@/app/api/labour/_shared";
import { normalizeText } from "@/lib/labour/constants";

const MAX_AADHAAR_FILES = 10;
const MAX_AADHAAR_FILE_BYTES = 5 * 1024 * 1024;
const OCR_CONCURRENCY = 1;
const OCR_TIMEOUT_MS = 60000;
const OCR_PRIMARY_MODEL = "gemini-3.5-flash-lite";
const OCR_FALLBACK_MODEL = "gemini-3.6-flash";
const OCR_PRIMARY_MAX_OUTPUT_TOKENS = 2048;
const OCR_FALLBACK_MAX_OUTPUT_TOKENS = 4096;
const SUPPORTED_AADHAAR_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const TRANSIENT_PROVIDER_STATUSES = new Set([429, 500, 502, 503, 504]);
const OCR_ERROR_CODES = {
  CONFIG_MISSING_KEY: "CONFIG_MISSING_KEY",
  CONFIG_INVALID_MODEL: "CONFIG_INVALID_MODEL",
  REQUEST_INVALID_FILE: "REQUEST_INVALID_FILE",
  REQUEST_UNSUPPORTED_MIME: "REQUEST_UNSUPPORTED_MIME",
  PROVIDER_RATE_LIMIT: "PROVIDER_RATE_LIMIT",
  PROVIDER_TIMEOUT: "PROVIDER_TIMEOUT",
  PROVIDER_5XX: "PROVIDER_5XX",
  PROVIDER_EMPTY_RESPONSE: "PROVIDER_EMPTY_RESPONSE",
  PROVIDER_NO_CANDIDATE: "PROVIDER_NO_CANDIDATE",
  PROVIDER_MAX_TOKENS: "PROVIDER_MAX_TOKENS",
  PROVIDER_SAFETY_BLOCK: "PROVIDER_SAFETY_BLOCK",
  RESPONSE_MALFORMED: "RESPONSE_MALFORMED",
  RESPONSE_SCHEMA_INVALID: "RESPONSE_SCHEMA_INVALID",
  DOCUMENT_UNREADABLE: "DOCUMENT_UNREADABLE",
  UNKNOWN: "UNKNOWN",
} as const;

type OcrErrorCode = typeof OCR_ERROR_CODES[keyof typeof OCR_ERROR_CODES];

type AadhaarExtraction = {
  document_side: "front" | "back" | "combined" | "unknown";
  name: string | null;
  father_or_husband_name: string | null;
  date_of_birth: string | null;
  year_of_birth: string | null;
  gender: string | null;
  aadhaar_number: string | null;
  address: string | null;
  confidence: number | null;
  needs_verification: boolean;
  verification_fields: string[];
};

type AadhaarDetection = AadhaarExtraction & {
  detection_index: number;
  source_label: string | null;
  page_number: number | null;
};

class OcrProviderError extends Error {
  code: OcrErrorCode;
  retryable: boolean;
  status?: number;

  constructor(code: OcrErrorCode, message: string, retryable = false, status?: number) {
    super(message);
    this.name = "OcrProviderError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

function debugEnabled() {
  return process.env.OCR_DEBUG === "true" || process.env.NODE_ENV === "development";
}

function debugOcr(event: Record<string, unknown>) {
  if (!debugEnabled()) return;
  console.info("[labour-aadhaar-ocr]", event);
}

function safeMessage(message: unknown) {
  const text = normalizeText(message);
  if (!text) return "OCR failed. Enter details manually.";
  return text.replace(/[0-9]{4}\s?[0-9]{4}\s?[0-9]{4}/g, "**** **** ****");
}

function ocrFailureCategory(error: unknown) {
  if (error instanceof OcrProviderError) {
    if (error.code === OCR_ERROR_CODES.PROVIDER_MAX_TOKENS) return "MAX_TOKENS";
    if (error.code === OCR_ERROR_CODES.PROVIDER_RATE_LIMIT) return "RATE_LIMIT";
    if ([OCR_ERROR_CODES.CONFIG_MISSING_KEY, OCR_ERROR_CODES.CONFIG_INVALID_MODEL].includes(error.code as any)) return "AUTH";
    if (error.code === OCR_ERROR_CODES.PROVIDER_TIMEOUT) return "TIMEOUT";
    if (error.code === OCR_ERROR_CODES.PROVIDER_SAFETY_BLOCK) return "SAFETY";
    if ([OCR_ERROR_CODES.PROVIDER_EMPTY_RESPONSE, OCR_ERROR_CODES.PROVIDER_NO_CANDIDATE, OCR_ERROR_CODES.RESPONSE_MALFORMED, OCR_ERROR_CODES.RESPONSE_SCHEMA_INVALID].includes(error.code as any)) return "INVALID_RESPONSE";
    return "PROVIDER_ERROR";
  }
  if ((error as any)?.name === "AbortError") return "TIMEOUT";
  return "PROVIDER_ERROR";
}

function emptyExtraction(): AadhaarExtraction {
  return {
    document_side: "unknown",
    name: null,
    father_or_husband_name: null,
    date_of_birth: null,
    year_of_birth: null,
    gender: null,
    aadhaar_number: null,
    address: null,
    confidence: null,
    needs_verification: true,
    verification_fields: [],
  };
}

function normalizeDob(value: unknown) {
  const text = normalizeText(value);
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return text;
  const slash = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (!slash) return null;
  return `${slash[3]}-${slash[2].padStart(2, "0")}-${slash[1].padStart(2, "0")}`;
}

function normalizeAadhaar(value: unknown) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 12 ? digits : null;
}

function normalizeGender(value: unknown) {
  const text = normalizeText(value).toLowerCase();
  if (!text) return null;
  if (["m", "male"].includes(text)) return "Male";
  if (["f", "female"].includes(text)) return "Female";
  if (["transgender", "other"].includes(text)) return "Other";
  return null;
}

function normalizeDocumentSide(value: unknown): AadhaarExtraction["document_side"] {
  const text = normalizeText(value).toLowerCase();
  if (text === "front" || text === "back" || text === "combined") return text;
  return "unknown";
}

function normalizeExtraction(value: any): AadhaarExtraction {
  const verificationFields = Array.isArray(value?.verification_fields)
    ? value.verification_fields.map((item: unknown) => normalizeText(item)).filter(Boolean).slice(0, 8)
    : [];
  return {
    document_side: normalizeDocumentSide(value?.document_side),
    name: normalizeText(value?.name) || null,
    father_or_husband_name: normalizeText(value?.father_or_husband_name) || null,
    date_of_birth: normalizeDob(value?.date_of_birth),
    year_of_birth: /^\d{4}$/.test(String(value?.year_of_birth || "")) ? String(value.year_of_birth) : null,
    gender: normalizeGender(value?.gender),
    aadhaar_number: normalizeAadhaar(value?.aadhaar_number),
    address: normalizeText(value?.address) || null,
    confidence: typeof value?.confidence === "number" ? Math.max(0, Math.min(1, value.confidence)) : null,
    needs_verification: value?.needs_verification !== false,
    verification_fields: verificationFields,
  };
}

function normalizeDetections(value: any): AadhaarDetection[] {
  const rawDetections = Array.isArray(value?.detections) ? value.detections : [value];
  return rawDetections.map((item: any, index: number) => ({
    ...normalizeExtraction(item),
    detection_index: index,
    source_label: normalizeText(item?.source_label) || null,
    page_number: Number.isInteger(item?.page_number) && item.page_number > 0 ? item.page_number : null,
  })).filter((item: AadhaarDetection) => (
    item.name || item.aadhaar_number || item.date_of_birth || item.year_of_birth || item.address || item.father_or_husband_name
  ));
}

function extractionSchema() {
  return {
    type: "OBJECT",
    properties: {
      name: { type: "STRING", nullable: true },
      document_side: { type: "STRING", enum: ["front", "back", "combined", "unknown"] },
      father_or_husband_name: { type: "STRING", nullable: true },
      date_of_birth: { type: "STRING", nullable: true },
      year_of_birth: { type: "STRING", nullable: true },
      gender: { type: "STRING", nullable: true },
      aadhaar_number: { type: "STRING", nullable: true },
      address: { type: "STRING", nullable: true },
      needs_verification: { type: "BOOLEAN" },
      verification_fields: {
        type: "ARRAY",
        items: { type: "STRING" },
      },
    },
    required: [
      "name",
      "document_side",
      "father_or_husband_name",
      "date_of_birth",
      "year_of_birth",
      "gender",
      "aadhaar_number",
      "address",
      "needs_verification",
      "verification_fields",
    ],
  };
}

function detectionSchema() {
  return {
    type: "OBJECT",
    properties: {
      detections: {
        type: "ARRAY",
        items: {
          ...extractionSchema(),
          properties: {
            ...extractionSchema().properties,
            source_label: { type: "STRING", nullable: true },
            page_number: { type: "INTEGER", nullable: true },
          },
        },
      },
    },
    required: ["detections"],
  };
}

function extractionPrompt() {
  return [
    "Extract Aadhaar identity data from the attached file.",
    "Return JSON only using the provided schema.",
    "One item per visible Aadhaar side/card/person.",
    "Set document_side to front, back, combined, or unknown.",
    "For PDFs include page_number when the page is clear; otherwise null.",
    "Fields only: side, name, father/husband, DOB/year, gender, Aadhaar number, address, verification flag.",
    "Use null when a field is not visible.",
    "Do not explain, reason, summarize, transcribe, or use markdown.",
  ].join(" ");
}

type GeminiAttemptConfig = {
  model: string;
  maxOutputTokens: number;
  retryCount: number;
  retryReason: string | null;
};

function geminiAttempts(retryReason: string | null = null): GeminiAttemptConfig[] {
  const primaryModel = normalizeText(process.env.GEMINI_OCR_PRIMARY_MODEL) || OCR_PRIMARY_MODEL;
  const fallbackModel = normalizeText(process.env.GEMINI_OCR_FALLBACK_MODEL) || OCR_FALLBACK_MODEL;
  return [
    {
      model: primaryModel,
      maxOutputTokens: OCR_PRIMARY_MAX_OUTPUT_TOKENS,
      retryCount: retryReason ? 1 : 0,
      retryReason,
    },
    {
      model: fallbackModel,
      maxOutputTokens: OCR_FALLBACK_MAX_OUTPUT_TOKENS,
      retryCount: 1,
      retryReason: retryReason || OCR_ERROR_CODES.PROVIDER_MAX_TOKENS,
    },
  ];
}

function parseStructuredGeminiPayload(payload: any) {
  const candidate = payload?.candidates?.[0];
  if (!candidate) {
    throw new OcrProviderError(OCR_ERROR_CODES.PROVIDER_NO_CANDIDATE, "OCR provider returned no candidate.", true);
  }
  const finishReason = normalizeText(candidate?.finishReason);
  if (finishReason && !["STOP", "MAX_TOKENS"].includes(finishReason)) {
    const code = finishReason === "SAFETY" ? OCR_ERROR_CODES.PROVIDER_SAFETY_BLOCK : OCR_ERROR_CODES.UNKNOWN;
    throw new OcrProviderError(code, "This Aadhaar image could not be read clearly. You can retry or enter the details manually.");
  }
  if (finishReason === "MAX_TOKENS") {
    throw new OcrProviderError(OCR_ERROR_CODES.PROVIDER_MAX_TOKENS, "OCR provider returned an incomplete response.", true);
  }
  const outputText = candidate?.content?.parts?.find((part: any) => typeof part.text === "string")?.text;
  if (!outputText) {
    throw new OcrProviderError(OCR_ERROR_CODES.PROVIDER_EMPTY_RESPONSE, "OCR provider returned no structured data.", true);
  }
  try {
    const parsed = JSON.parse(outputText);
    const detections = normalizeDetections(parsed);
    const normalized = detections[0] || normalizeExtraction(parsed);
    if (!normalized.name && !normalized.aadhaar_number && !normalized.date_of_birth && !normalized.year_of_birth) {
      throw new OcrProviderError(OCR_ERROR_CODES.DOCUMENT_UNREADABLE, "This Aadhaar could not be read clearly.", false);
    }
    return { ...normalized, detections } as AadhaarExtraction & { detections: AadhaarDetection[] };
  } catch (error) {
    if (error instanceof OcrProviderError) throw error;
    throw new OcrProviderError(OCR_ERROR_CODES.RESPONSE_MALFORMED, "OCR provider returned malformed structured data.", true);
  }
}

function userFacingOcrError(error: any) {
  if (error instanceof OcrProviderError) {
    if (error.code === OCR_ERROR_CODES.PROVIDER_RATE_LIMIT) return safeMessage(error.message) || "Gemini OCR quota is temporarily exhausted. Please retry later.";
    if (error.code === OCR_ERROR_CODES.PROVIDER_5XX) return "OCR service is busy. Please retry shortly.";
    if (error.code === OCR_ERROR_CODES.PROVIDER_TIMEOUT) return "OCR timed out. Please retry this Aadhaar.";
    if ([OCR_ERROR_CODES.CONFIG_MISSING_KEY, OCR_ERROR_CODES.CONFIG_INVALID_MODEL, OCR_ERROR_CODES.REQUEST_INVALID_FILE].includes(error.code as any)) return "OCR is not configured correctly. Contact the administrator.";
    if ([OCR_ERROR_CODES.RESPONSE_MALFORMED, OCR_ERROR_CODES.RESPONSE_SCHEMA_INVALID, OCR_ERROR_CODES.PROVIDER_EMPTY_RESPONSE, OCR_ERROR_CODES.PROVIDER_NO_CANDIDATE, OCR_ERROR_CODES.PROVIDER_MAX_TOKENS].includes(error.code as any)) return "Aadhaar could not be read automatically. Please retry or enter the details manually.";
    return "This Aadhaar image could not be read clearly. You can retry or enter the details manually.";
  }
  if (error?.name === "AbortError") return "OCR timed out. Please retry this Aadhaar.";
  return "This Aadhaar image could not be read clearly. You can retry or enter the details manually.";
}

async function callGemini(file: File, meta: { requestId: string; optimized: boolean; config: GeminiAttemptConfig }): Promise<AadhaarExtraction> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new OcrProviderError(OCR_ERROR_CODES.CONFIG_MISSING_KEY, "OCR provider is not configured. Set GEMINI_API_KEY on the server.");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const model = meta.config.model;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);
  const prompt = extractionPrompt();
  let providerDiagnostics: Record<string, unknown> = {
    providerHttpStatus: null,
    candidateCount: 0,
    finishReason: null,
    finishMessage: null,
    promptTokenCount: null,
    candidatesTokenCount: null,
    thoughtsTokenCount: null,
    totalTokenCount: null,
  };
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: prompt,
              },
              {
                inline_data: {
                  mime_type: file.type,
                  data: buffer.toString("base64"),
                },
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: meta.config.maxOutputTokens,
          responseMimeType: "application/json",
          responseSchema: detectionSchema(),
          thinkingConfig: {
            thinkingLevel: "minimal",
          },
        },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    const candidate = payload?.candidates?.[0];
    providerDiagnostics = {
      providerHttpStatus: response.status,
      candidateCount: Array.isArray(payload?.candidates) ? payload.candidates.length : 0,
      finishReason: normalizeText(candidate?.finishReason) || null,
      finishMessage: normalizeText(candidate?.finishMessage) || null,
      promptTokenCount: payload?.usageMetadata?.promptTokenCount ?? null,
      candidatesTokenCount: payload?.usageMetadata?.candidatesTokenCount ?? null,
      thoughtsTokenCount: payload?.usageMetadata?.thoughtsTokenCount ?? null,
      totalTokenCount: payload?.usageMetadata?.totalTokenCount ?? null,
    };
    if (!response.ok) {
      const providerMessage = normalizeText(payload?.error?.message);
      if (response.status === 429) {
        const providerStatus = normalizeText(payload?.error?.status);
        const quotaMessage = providerStatus === "RESOURCE_EXHAUSTED" || /quota|rate/i.test(providerMessage)
          ? "Gemini OCR quota is temporarily exhausted. Please retry later."
          : "OCR service is busy. Please retry shortly.";
        throw new OcrProviderError(OCR_ERROR_CODES.PROVIDER_RATE_LIMIT, quotaMessage, true, response.status);
      }
      if (TRANSIENT_PROVIDER_STATUSES.has(response.status)) throw new OcrProviderError(OCR_ERROR_CODES.PROVIDER_5XX, "OCR service is busy. Please retry shortly.", true, response.status);
      if (response.status === 404 || /model/i.test(providerMessage)) throw new OcrProviderError(OCR_ERROR_CODES.CONFIG_INVALID_MODEL, "Configured Gemini OCR model is unavailable.", false, response.status);
      if (response.status === 400) throw new OcrProviderError(OCR_ERROR_CODES.REQUEST_INVALID_FILE, "Gemini OCR request was rejected.", false, response.status);
      throw new OcrProviderError(OCR_ERROR_CODES.UNKNOWN, "OCR provider could not read this Aadhaar.", false, response.status);
    }
    const extraction = parseStructuredGeminiPayload(payload);
    debugOcr({
      requestId: meta.requestId,
      model,
      mimeType: file.type,
      fileSize: file.size,
      optimized: meta.optimized,
      elapsedMs: Date.now() - startedAt,
      ...providerDiagnostics,
      retryCount: meta.config.retryCount,
      retryReason: meta.config.retryReason,
      maxOutputTokens: meta.config.maxOutputTokens,
      promptLength: prompt.length,
      timeout: false,
      rateLimit: false,
      structuredParsingSucceeded: true,
      errorCategory: null,
    });
    return extraction;
  } catch (error: any) {
    if (error?.name === "AbortError") {
      const timeoutError = new OcrProviderError(OCR_ERROR_CODES.PROVIDER_TIMEOUT, "OCR timed out. Please retry this Aadhaar.", false);
      debugOcr({
        requestId: meta.requestId,
        model,
        mimeType: file.type,
        fileSize: file.size,
        optimized: meta.optimized,
        elapsedMs: Date.now() - startedAt,
        providerHttpStatus: null,
        retryCount: meta.config.retryCount,
        retryReason: meta.config.retryReason,
        maxOutputTokens: meta.config.maxOutputTokens,
        promptLength: prompt.length,
        timeout: true,
        rateLimit: false,
        candidateCount: 0,
        finishReason: null,
        finishMessage: null,
        promptTokenCount: null,
        candidatesTokenCount: null,
        thoughtsTokenCount: null,
        totalTokenCount: null,
        structuredParsingSucceeded: false,
        errorCategory: ocrFailureCategory(timeoutError),
        errorCode: timeoutError.code,
      });
      throw timeoutError;
    }
    debugOcr({
      requestId: meta.requestId,
      model,
      mimeType: file.type,
      fileSize: file.size,
      optimized: meta.optimized,
      elapsedMs: Date.now() - startedAt,
      ...providerDiagnostics,
      providerHttpStatus: error?.status || providerDiagnostics.providerHttpStatus || null,
      retryCount: meta.config.retryCount,
      retryReason: meta.config.retryReason,
      maxOutputTokens: meta.config.maxOutputTokens,
      promptLength: prompt.length,
      timeout: false,
      rateLimit: error instanceof OcrProviderError && error.code === OCR_ERROR_CODES.PROVIDER_RATE_LIMIT,
      structuredParsingSucceeded: false,
      errorCategory: ocrFailureCategory(error),
      errorCode: error instanceof OcrProviderError ? error.code : OCR_ERROR_CODES.UNKNOWN,
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function extractWithGemini(file: File, meta: { requestId: string; optimized: boolean }): Promise<AadhaarExtraction> {
  const [primary, fallback] = geminiAttempts();
  try {
    return await callGemini(file, { ...meta, config: primary });
  } catch (error: any) {
    const fallbackCodes = new Set<OcrErrorCode>([
      OCR_ERROR_CODES.PROVIDER_MAX_TOKENS,
      OCR_ERROR_CODES.PROVIDER_EMPTY_RESPONSE,
      OCR_ERROR_CODES.PROVIDER_NO_CANDIDATE,
      OCR_ERROR_CODES.PROVIDER_5XX,
    ]);
    if (error instanceof OcrProviderError && error.retryable && fallbackCodes.has(error.code)) {
      return callGemini(file, { ...meta, config: { ...fallback, retryReason: error.code } });
    }
    throw error;
  }
}

async function processWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_workers", "add");
    if ("response" in access) return access.response;
    const formData = await request.formData();
    const organizationId = await resolveOrganizationId(access, normalizeText(formData.get("organization_id")));
    if (!organizationId) return jsonError("You cannot register labour outside your organization.", 403);
    const companyId = normalizeText(formData.get("company_id"));
    const siteId = normalizeText(formData.get("site_id"));
    if (!companyId || !siteId) return jsonError("Company and site are required.");
    const scopeCheck = await validateLabourCompanySiteIndependent(access, organizationId, companyId, siteId);
    if ("error" in scopeCheck) return jsonError(scopeCheck.error || "Selected company/site is not available.", 403);

    const files = formData.getAll("files").filter((file): file is File => file instanceof File && file.size > 0);
    if (!files.length) return jsonError("Add at least one Aadhaar file.");
    if (files.length > MAX_AADHAAR_FILES) return jsonError("Maximum 10 Aadhaar files can be processed at once.");

    const rows = await processWithConcurrency(files, OCR_CONCURRENCY, async (file, index) => {
      const id = normalizeText(formData.get(`client_id_${index}`)) || `row-${index + 1}`;
      if (!SUPPORTED_AADHAAR_MIME_TYPES.has(file.type)) {
        return { id, file_name: file.name, status: "failed", error: "This file type is not supported. Upload JPG, PNG, WebP or PDF.", extraction: emptyExtraction() };
      }
      if (file.size > MAX_AADHAAR_FILE_BYTES) {
        return { id, file_name: file.name, status: "failed", error: "Aadhaar file is too large. Maximum size is 5 MB.", extraction: emptyExtraction() };
      }
      try {
        const requestId = crypto.randomUUID();
        const optimized = normalizeText(formData.get(`optimized_${index}`)) === "true";
        const extraction = await extractWithGemini(file, { requestId, optimized }) as AadhaarExtraction & { detections?: AadhaarDetection[] };
        return {
          id,
          file_name: file.name,
          status: "extracted",
          error: "",
          extraction,
          detections: extraction.detections || [extraction],
        };
      } catch (error: any) {
        return {
          id,
          file_name: file.name,
          status: "failed",
          error: userFacingOcrError(error),
          extraction: emptyExtraction(),
        };
      }
    });
    return NextResponse.json({ provider: "gemini", rows });
  } catch (error: any) {
    return jsonError(safeMessage(error.message) || "Failed to process Aadhaar OCR.", 500);
  }
}
