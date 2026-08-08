"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, CheckCircle2, FilePlus2, ImageUp, Pencil, Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatLabourCode, maskAadhaar, normalizeLabourCode } from "@/lib/labour/constants";
import { resolveSingleLabourSiteId, selectedLabourSiteIsValid, subscribeLabourWorkspaceSummary, type LabourWorkspaceSummary } from "@/lib/labour/attendanceSystemContext";
import { aadhaarInputValue, normalizeAadhaar, validateAadhaar } from "@/lib/utils/aadhaar";

const MAX_GROUP_LABOURERS = 5;
const MAX_AADHAAR_FILES = 10;
const AADHAAR_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf";
const SUPPORTED_AADHAAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

const emptyAssignment = {
  company_id: "",
  site_id: "",
  vendor_id: "",
  work_order_id: "",
  effective_from: new Date().toISOString().slice(0, 10),
};

type ExistingMatch = {
  id: string;
  labour_code: string;
  worker_name: string;
  father_or_husband_name?: string | null;
  date_of_birth?: string | null;
  aadhaar_number?: string | null;
  mobile_number?: string | null;
  current_company_id?: string | null;
  current_site_id?: string | null;
  current_contractor_vendor_id?: string | null;
  current_labour_trade_id?: string | null;
  current_site_name?: string | null;
  current_company_name?: string | null;
  current_contractor_name?: string | null;
  current_category_name?: string | null;
  current_effective_from?: string | null;
  current_wage_rate?: string | number | null;
  registered_on?: string | null;
  status?: string | null;
  last_assignment?: AssignmentHistory | null;
  recent_assignments?: AssignmentHistory[];
};

type AssignmentHistory = {
  site_name?: string | null;
  company_name?: string | null;
  contractor_name?: string | null;
  category_name?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  status?: string | null;
  wage_rate?: string | number | null;
};

type WorkerDetail = {
  worker: ExistingMatch & { labour_contractor_profiles?: any };
  deployments: any[];
};

type AadhaarSide = "front" | "back" | "combined" | "unknown";
type PairingStatus = "manual" | "paired" | "combined" | "needs_pairing" | "front_missing" | "back_missing" | "unmatched" | "duplicate_front" | "duplicate_back" | "number_mismatch";

type AadhaarSourceRef = {
  source_file_id: string;
  source_filename: string;
  page_number: number | null;
  detection_index: number;
  side: AadhaarSide;
  normalized_aadhaar: string;
};

type ProcessingFile = {
  id: string;
  file: File;
  preview_url: string;
  file_name: string;
  optimized: boolean;
  status: "Queued" | "Preparing file" | "Reading Aadhaar" | "Needs verification" | "OCR failed";
  error?: string;
};

type BatchRow = {
  id: string;
  source_type: "aadhaar" | "manual";
  file: File | null;
  aadhaar_front_file: File | null;
  aadhaar_back_file: File | null;
  aadhaar_front_preview_url: string;
  aadhaar_back_preview_url: string;
  aadhaar_front_name: string;
  aadhaar_back_name: string;
  preview_url: string;
  file_name: string;
  document_side: AadhaarSide;
  pairing_status: PairingStatus;
  source_refs: AadhaarSourceRef[];
  ocr_status: "queued" | "reading" | "extracted" | "failed";
  save_status: "pending" | "saving" | "success" | "failed";
  labour_trade_id: string;
  worker_name: string;
  father_or_husband_name: string;
  date_of_birth: string;
  year_of_birth: string;
  gender: string;
  aadhaar_number: string;
  mobile_number: string;
  daily_rate: string;
  remarks: string;
  confidence: number | null;
  existing: ExistingMatch | null;
  match_state: "new" | "loaded" | "weak" | "conflict" | "duplicate" | "validation";
  match_message: string;
  error: string;
  result_message: string;
  labour_code: string;
  document_warning: string;
};

function normalizeMobile(value: string) {
  return value.replace(/\D/g, "");
}

function normalizeIdentity(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = value.includes("T") ? new Date(value) : new Date(`${value}T00:00:00`);
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fileKey(file: File) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function previewFor(file: File | null) {
  return file?.type.startsWith("image/") ? URL.createObjectURL(file) : "";
}

function revokeRowPreviews(row: BatchRow) {
  if (row.preview_url) URL.revokeObjectURL(row.preview_url);
  if (row.aadhaar_front_preview_url) URL.revokeObjectURL(row.aadhaar_front_preview_url);
  if (row.aadhaar_back_preview_url) URL.revokeObjectURL(row.aadhaar_back_preview_url);
}

async function optimizeAadhaarImage(file: File) {
  if (!file.type.startsWith("image/") || file.size < 2 * 1024 * 1024) return file;
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = imageUrl;
    });
    const longEdge = Math.max(image.width, image.height);
    if (longEdge <= 2200) return file;
    const scale = 2200 / longEdge;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.(png|webp|jpg|jpeg)$/i, ".jpg"), { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function makeRow(file: File | null, sourceType: "aadhaar" | "manual" = "aadhaar"): BatchRow {
  return {
    id: crypto.randomUUID(),
    source_type: sourceType,
    file,
    aadhaar_front_file: null,
    aadhaar_back_file: null,
    aadhaar_front_preview_url: "",
    aadhaar_back_preview_url: "",
    aadhaar_front_name: "",
    aadhaar_back_name: "",
    preview_url: previewFor(file),
    file_name: file?.name || "Manual Entry",
    document_side: "unknown",
    pairing_status: sourceType === "manual" ? "manual" : "unmatched",
    source_refs: [],
    ocr_status: "queued",
    save_status: "pending",
    labour_trade_id: "",
    worker_name: "",
    father_or_husband_name: "",
    date_of_birth: "",
    year_of_birth: "",
    gender: "",
    aadhaar_number: "",
    mobile_number: "",
    daily_rate: "",
    remarks: "",
    confidence: null,
    existing: null,
    match_state: "validation",
    match_message: "Validation Required",
    error: "",
    result_message: "",
    labour_code: "",
    document_warning: "",
  };
}

function rowValidation(row: BatchRow, requiresDailyRate = true) {
  const errors = [];
  if (!row.labour_trade_id) errors.push("Labour Category is required.");
  if (!row.worker_name.trim()) errors.push("Name is required.");
  if (row.source_type !== "manual") {
    const aadhaar = validateAadhaar(row.aadhaar_number);
    if (!aadhaar.valid) errors.push(aadhaar.error);
  }
  if (requiresDailyRate && !String(row.daily_rate || "").trim()) errors.push("Daily Rate is required.");
  if (row.daily_rate && (!/^\d+$/.test(row.daily_rate) || Number(row.daily_rate) < 0)) errors.push("Daily Rate must be a non-negative whole rupee amount.");
  if (row.match_state === "conflict") errors.push("Supervisor review is required.");
  if (row.match_state === "duplicate") errors.push("Duplicate in this batch.");
  if (row.pairing_status === "duplicate_front") errors.push("Duplicate Front.");
  if (row.pairing_status === "duplicate_back") errors.push("Duplicate Back.");
  if (row.pairing_status === "number_mismatch") errors.push("Aadhaar numbers do not match.");
  return errors;
}

export default function NewLabourWorkerPage() {
  const [assignment, setAssignment] = useState(emptyAssignment);
  const [labourWorkspace, setLabourWorkspace] = useState<LabourWorkspaceSummary>({ pairs: [], attendance_systems: [] });
  const [assignmentLocked, setAssignmentLocked] = useState(false);
  const [lookups, setLookups] = useState<any>({ companies: [], sites: [], vendors: [], trades: [] });
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [processingFiles, setProcessingFiles] = useState<ProcessingFile[]>([]);
  const [detailRowId, setDetailRowId] = useState<string>("");
  const [workerDetails, setWorkerDetails] = useState<Record<string, WorkerDetail>>({});
  const [detailLoading, setDetailLoading] = useState("");
  const [detailError, setDetailError] = useState("");
  const [processingOcr, setProcessingOcr] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [notice, setNotice] = useState("");
  const [sessionCount, setSessionCount] = useState(0);
  const [recent, setRecent] = useState<{ code: string; name: string; action: string }[]>([]);
  const [batchStats, setBatchStats] = useState({ registered: 0, transferred: 0, failed: 0 });
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [capturedPreview, setCapturedPreview] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const lookupRequestRef = useRef(0);
  const lookupAbortRef = useRef<AbortController | null>(null);

  const unsavedRows = rows.some((row) => row.save_status !== "success");
  const selectedSiteName = (lookups.sites || []).find((site: any) => site.id === assignment.site_id)?.site_name || "-";
  const assignmentWorkOrders = lookups.labour_work_orders || [];
  const selectedWorkOrder = assignmentWorkOrders.find((workOrder: any) => workOrder.id === assignment.work_order_id) || null;
  const hasSingleDailyWageWorkOrder = assignmentWorkOrders.length === 1 && assignmentWorkOrders[0]?.wo_type === "Daily Wage" && assignment.work_order_id === assignmentWorkOrders[0]?.id;
  const hasNoEligibleWorkOrders = Boolean(assignment.company_id && assignment.site_id && assignment.vendor_id && !lookupLoading && assignmentWorkOrders.length === 0);
  const workOrderSelectionSatisfied = !assignment.vendor_id || hasNoEligibleWorkOrders || assignmentWorkOrders.length <= 1 || Boolean(assignment.work_order_id);
  const assignmentReady = Boolean(assignment.company_id && assignment.site_id && assignment.vendor_id && assignment.effective_from && workOrderSelectionSatisfied);
  const assignmentModelResolved = Boolean(assignment.company_id && assignment.site_id && assignment.vendor_id && !lookupLoading && (selectedWorkOrder || hasNoEligibleWorkOrders));
  const assignmentCommercialModel = assignmentModelResolved && selectedWorkOrder?.wo_type === "Daily Wage" ? "daily_wage" : assignmentModelResolved ? "contract_basis" : "";
  const assignmentRequiresDailyRate = assignmentCommercialModel === "daily_wage";
  const paymentModelLabel = assignmentRequiresDailyRate ? "Daily Wage" : assignmentCommercialModel === "contract_basis" ? "Contractual Labour" : "Select Assignment";

  async function token() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  }

  async function parsePayload(response: Response) {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { error: text };
    }
  }

  async function loadLookups() {
    const requestId = lookupRequestRef.current + 1;
    lookupRequestRef.current = requestId;
    lookupAbortRef.current?.abort();
    const controller = new AbortController();
    lookupAbortRef.current = controller;
    setLookupLoading(true);
    try {
      const params = new URLSearchParams({ purpose: "labour_registration" });
      if (assignment.company_id) params.set("company_id", assignment.company_id);
      if (assignment.site_id) params.set("site_id", assignment.site_id);
      if (assignment.vendor_id) params.set("vendor_id", assignment.vendor_id);
      const response = await fetch(`/api/labour/lookups?${params.toString()}`, {
        headers: { Authorization: `Bearer ${await token()}` },
        signal: controller.signal,
      });
      const payload = await parsePayload(response);
      if (!response.ok) throw new Error(payload.error || "Could not load registration lookups.");
      if (requestId !== lookupRequestRef.current) return;
      setLookups(payload);
      setAssignment((current) => ({
        ...current,
        vendor_id: current.vendor_id && (payload.vendors || []).some((vendor: any) => vendor.id === current.vendor_id) ? current.vendor_id : "",
        work_order_id: current.work_order_id && (payload.labour_work_orders || []).some((workOrder: any) => workOrder.id === current.work_order_id)
          ? current.work_order_id
          : (payload.labour_work_orders || []).length === 1
            ? (payload.labour_work_orders || [])[0].id
            : "",
      }));
    } catch (lookupError: any) {
      if (lookupError?.name === "AbortError") return;
      setError(lookupError.message || "Could not load registration lookups.");
    } finally {
      if (requestId === lookupRequestRef.current) setLookupLoading(false);
    }
  }

  useEffect(() => {
    void loadLookups();
  }, [assignment.company_id, assignment.site_id, assignment.vendor_id]);
  useEffect(() => {
    if (assignmentRequiresDailyRate) return;
    setRows((current) => current.some((row) => row.daily_rate)
      ? current.map((row) => ({ ...row, daily_rate: "" }))
      : current);
  }, [assignmentRequiresDailyRate]);
  useEffect(() => subscribeLabourWorkspaceSummary(setLabourWorkspace), []);
  useEffect(() => {
    const singleSiteId = resolveSingleLabourSiteId(labourWorkspace);
    if (!singleSiteId || selectedLabourSiteIsValid(assignment.site_id, labourWorkspace) || assignmentLocked) return;
    setAssignment((current) => ({
      ...current,
      site_id: singleSiteId,
    }));
  }, [assignment.site_id, assignmentLocked, labourWorkspace]);

  useEffect(() => {
    if (!unsavedRows) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsavedRows]);

  useEffect(() => () => {
    stopCamera();
    if (capturedPreview) URL.revokeObjectURL(capturedPreview);
  }, [capturedPreview]);

  const identitySignature = rows.map((row) => [
    row.id,
    row.worker_name,
    row.father_or_husband_name,
    row.date_of_birth,
    row.aadhaar_number,
    row.mobile_number,
    row.labour_trade_id,
  ].join("~")).join("|");

  useEffect(() => {
    if (!assignmentLocked || saving || processingOcr) return;
    const timeout = window.setTimeout(() => {
      rows
        .filter((row) => row.save_status !== "success" && row.match_state !== "conflict" && row.match_state !== "duplicate")
        .forEach((row) => void checkRow(row));
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [identitySignature, assignmentLocked, assignment.company_id, assignment.site_id, assignment.vendor_id, saving, processingOcr]);

  function updateAssignment(patch: Partial<typeof assignment>) {
    if (patch.company_id !== undefined || patch.site_id !== undefined) {
      setLookups((current: any) => ({ ...current, vendors: [], contractors: [], labour_work_orders: [] }));
    }
    if (patch.vendor_id !== undefined) setLookups((current: any) => ({ ...current, labour_work_orders: [] }));
    setAssignment((current) => ({ ...current, ...patch }));
    setError("");
    setSuccess("");
    setNotice("");
  }

  function startRegistration() {
    if (!assignmentReady) {
      setError(workOrderSelectionSatisfied
        ? "Company, site, labour contractor and site joining date are required."
        : "Select the applicable Work Order for this contractor and site.");
      return;
    }
    setAssignmentLocked(true);
    setError("");
    setSuccess("");
    setNotice("");
  }

  function changeAssignment() {
    if (unsavedRows && !window.confirm("Unsaved OCR/review rows will be cleared. Change assignment?")) return;
    rows.forEach(revokeRowPreviews);
    processingFiles.forEach((file) => file.preview_url && URL.revokeObjectURL(file.preview_url));
    setRows([]);
    setProcessingFiles([]);
    setAssignmentLocked(false);
    setSuccess("");
    setError("");
    setNotice("");
  }

  function finishBatch() {
    if (unsavedRows && !window.confirm("Unsaved rows will be cleared. Finish this batch?")) return;
    rows.forEach(revokeRowPreviews);
    processingFiles.forEach((file) => file.preview_url && URL.revokeObjectURL(file.preview_url));
    setRows([]);
    setProcessingFiles([]);
    setAssignment(emptyAssignment);
    setAssignmentLocked(false);
    setSessionCount(0);
    setRecent([]);
    setBatchStats({ registered: 0, transferred: 0, failed: 0 });
    setSuccess("");
    setError("");
    setNotice("");
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function openCamera() {
    setError("");
    setSuccess("");
    setNotice("");
    setCameraError("");
    setCapturedFile(null);
    if (capturedPreview) {
      URL.revokeObjectURL(capturedPreview);
      setCapturedPreview("");
    }
    setCameraOpen(true);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("No camera was found on this device.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      }, 0);
    } catch (cameraAccessError: any) {
      const message = cameraAccessError?.name === "NotAllowedError" || cameraAccessError?.name === "PermissionDeniedError"
        ? "Camera permission was denied. Upload an Aadhaar image instead."
        : "No camera was found on this device.";
      setCameraError(message);
      stopCamera();
    }
  }

  function closeCamera() {
    stopCamera();
    setCameraOpen(false);
    setCameraError("");
    setCapturedFile(null);
    if (capturedPreview) {
      URL.revokeObjectURL(capturedPreview);
      setCapturedPreview("");
    }
  }

  function captureAadhaarPhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setCameraError("Camera photo could not be captured. Upload an Aadhaar image instead.");
        return;
      }
      const file = new File([blob], `aadhaar-capture-${Date.now()}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
      if (capturedPreview) URL.revokeObjectURL(capturedPreview);
      setCapturedFile(file);
      setCapturedPreview(URL.createObjectURL(file));
      stopCamera();
    }, "image/jpeg", 0.9);
  }

  async function retakeAadhaarPhoto() {
    if (capturedPreview) {
      URL.revokeObjectURL(capturedPreview);
      setCapturedPreview("");
    }
    setCapturedFile(null);
    await openCamera();
  }

  async function useCapturedPhoto() {
    if (!capturedFile) return;
    await addFiles([capturedFile]);
    closeCamera();
  }

  async function addFiles(files: FileList | File[] | null) {
    if (!files?.length) return;
    setError("");
    setSuccess("");
    setNotice("");
    const existingPendingRows = rows.filter((row) => row.save_status !== "success").length;
    const existingPendingFiles = rows.filter((row) => row.save_status !== "success").reduce((count, row) => (
      count + (row.aadhaar_front_file ? 1 : 0) + (row.aadhaar_back_file ? 1 : 0) + (!row.aadhaar_front_file && !row.aadhaar_back_file && row.file ? 1 : 0)
    ), 0) + processingFiles.length;
    const existingKeys = new Set([
      ...rows.filter((row) => row.save_status !== "success").flatMap((row) => [row.file, row.aadhaar_front_file, row.aadhaar_back_file].filter(Boolean).map((file) => fileKey(file as File))),
      ...processingFiles.map((file) => fileKey(file.file)),
    ]);
    const selected = Array.from(files).filter((file) => {
      if (!SUPPORTED_AADHAAR_TYPES.has(file.type)) {
        setError("This file type is not supported. Upload JPG, PNG, WebP or PDF.");
        return false;
      }
      if (existingKeys.has(fileKey(file))) return false;
      existingKeys.add(fileKey(file));
      return true;
    });
    if (!selected.length) return;
    if (existingPendingFiles + selected.length > MAX_AADHAAR_FILES) {
      setError("Maximum 10 Aadhaar files can be processed at once.");
      return;
    }
    if (existingPendingRows >= MAX_GROUP_LABOURERS) {
      setError("Maximum 5 labourers can be reviewed at once.");
      return;
    }
    const nextFiles = await Promise.all(selected.map(async (file) => {
      const prepared = file.type.startsWith("image/") ? await optimizeAadhaarImage(file) : file;
      return {
        id: crypto.randomUUID(),
        file: prepared,
        preview_url: prepared.type.startsWith("image/") ? URL.createObjectURL(prepared) : "",
        file_name: prepared.name,
        optimized: prepared !== file,
        status: "Queued" as const,
      };
    }));
    setProcessingFiles((current) => [...current, ...nextFiles]);
    await processOcr(nextFiles);
  }

  function addManualRow() {
    const pendingRows = rows.filter((row) => row.save_status !== "success").length;
    if (pendingRows >= MAX_GROUP_LABOURERS) {
      setError("Maximum 5 labourers can be reviewed at once.");
      return;
    }
    const row = {
      ...makeRow(null, "manual"),
      ocr_status: "extracted" as const,
      match_state: "validation" as const,
      match_message: "Manual Entry — No Aadhaar",
    };
    setRows((current) => [...current, row]);
    setError("");
    setSuccess("");
  }

  function buildRowsFromOcrResults(targetFiles: ProcessingFile[], payloadRows: any[]) {
    const byAadhaar = new Map<string, any[]>();
    targetFiles.forEach((file) => {
      const result = payloadRows.find((item: any) => item.id === file.id) || { id: file.id, status: "failed", error: "OCR failed.", extraction: {} };
      if (result.status !== "extracted") return;
      const detections = Array.isArray(result.detections) && result.detections.length ? result.detections : [];
      detections.forEach((extraction: any, detectionIndex: number) => {
        const aadhaar = normalizeAadhaar(extraction.aadhaar_number || "");
        const side = (extraction.document_side || "unknown") as AadhaarSide;
        const sourceRef: AadhaarSourceRef = {
          source_file_id: file.id,
          source_filename: file.file_name,
          page_number: Number.isInteger(extraction.page_number) && extraction.page_number > 0 ? extraction.page_number : null,
          detection_index: Number.isInteger(extraction.detection_index) ? extraction.detection_index : detectionIndex,
          side,
          normalized_aadhaar: aadhaar,
        };
        const item = { file, result, extraction, aadhaar, side, detectionIndex, sourceRef };
        if (aadhaar.length === 12) byAadhaar.set(aadhaar, [...(byAadhaar.get(aadhaar) || []), item]);
      });
    });

    const groupedRows: BatchRow[] = [];
    byAadhaar.forEach((items, aadhaar) => {
      const fronts = items.filter((item) => item.side === "front");
      const backs = items.filter((item) => item.side === "back");
      const combined = items.filter((item) => item.side === "combined");
      const unknowns = items.filter((item) => item.side === "unknown");
      const front = combined[0] || fronts[0] || (backs.length ? null : unknowns[0]) || null;
      const back = combined[0] || backs[0] || (fronts.length ? unknowns[0] : null) || null;
      const primary = combined[0] || front || back || items[0];
      const pairingStatus: PairingStatus = combined.length > 0
        ? "combined"
        : fronts.length > 1
        ? "duplicate_front"
        : backs.length > 1
          ? "duplicate_back"
          : front && back
            ? "paired"
            : front
              ? "back_missing"
              : back
                ? "front_missing"
                : unknowns.length > 0
                  ? "needs_pairing"
                  : "unmatched";
      const extraction = {
        name: front?.extraction.name || primary.extraction.name || "",
        father_or_husband_name: back?.extraction.father_or_husband_name || front?.extraction.father_or_husband_name || primary.extraction.father_or_husband_name || "",
        date_of_birth: front?.extraction.date_of_birth || primary.extraction.date_of_birth || "",
        year_of_birth: front?.extraction.year_of_birth || primary.extraction.year_of_birth || "",
        gender: front?.extraction.gender || primary.extraction.gender || "",
        confidence: Math.max(0, ...items.map((item) => Number(item.extraction.confidence) || 0)) || null,
      };
      groupedRows.push({
        ...makeRow(primary.file.file),
        id: crypto.randomUUID(),
        file: primary.file.file,
        preview_url: primary.file.preview_url,
        file_name: primary.file.file_name,
        aadhaar_front_file: front?.file.file || null,
        aadhaar_back_file: back?.file.file || null,
        aadhaar_front_preview_url: front?.file.preview_url || "",
        aadhaar_back_preview_url: back?.file.preview_url || "",
        aadhaar_front_name: front?.file.file_name || "",
        aadhaar_back_name: back?.file.file_name || "",
        document_side: primary.side,
        pairing_status: pairingStatus,
        source_refs: items.map((item) => item.sourceRef),
        ocr_status: items.some((item) => item.result.status === "extracted") ? "extracted" : "failed",
        worker_name: extraction.name,
        father_or_husband_name: extraction.father_or_husband_name,
        date_of_birth: extraction.date_of_birth,
        year_of_birth: extraction.year_of_birth,
        gender: extraction.gender,
        aadhaar_number: aadhaarInputValue(aadhaar),
        confidence: extraction.confidence,
        match_state: pairingStatus.startsWith("duplicate") ? "conflict" : "new",
        match_message: pairingStatus === "paired" || pairingStatus === "combined" ? "Paired Aadhaar Front/Back" : pairingLabel(pairingStatus),
        error: pairingStatus.startsWith("duplicate") ? pairingLabel(pairingStatus) : "",
      });
    });
    return groupedRows;
  }

  function combinePairingStatus(row: BatchRow): PairingStatus {
    if (row.source_type === "manual") return "manual";
    const fronts = row.source_refs.filter((source) => source.side === "front");
    const backs = row.source_refs.filter((source) => source.side === "back");
    const combined = row.source_refs.filter((source) => source.side === "combined");
    const unknowns = row.source_refs.filter((source) => source.side === "unknown");
    if (combined.length > 0) return "combined";
    if (fronts.length > 1) return "duplicate_front";
    if (backs.length > 1) return "duplicate_back";
    if (fronts.length === 1 && backs.length === 1) return "paired";
    if (fronts.length === 1) return "back_missing";
    if (backs.length === 1) return "front_missing";
    if (unknowns.length > 0) return "needs_pairing";
    return "unmatched";
  }

  function duplicateNoticeForSources(existing: BatchRow, incoming: BatchRow) {
    const existingSides = new Set(existing.source_refs.map((source) => source.side));
    const messages = incoming.source_refs
      .filter((source) => existingSides.has(source.side))
      .map((source) => {
        if (source.side === "front") return "This Aadhaar Front is already added.";
        if (source.side === "back") return "This Aadhaar Back is already added.";
        return "This Aadhaar is already present in the current batch.";
      });
    return Array.from(new Set(messages));
  }

  function mergeAadhaarRows(existing: BatchRow, incoming: BatchRow): { row: BatchRow; notices: string[] } {
    const notices = duplicateNoticeForSources(existing, incoming);
    const existingSides = new Set(existing.source_refs.map((source) => source.side));
    const incomingFreshRefs = incoming.source_refs.filter((source) => !existingSides.has(source.side));
    const sourceRefs = [...existing.source_refs, ...incomingFreshRefs];
    const merged: BatchRow = {
      ...existing,
      file: existing.file || incoming.file,
      preview_url: existing.preview_url || incoming.preview_url,
      file_name: existing.file_name || incoming.file_name,
      aadhaar_front_file: existing.aadhaar_front_file || (incomingFreshRefs.some((source) => source.side === "front" || source.side === "combined") ? incoming.aadhaar_front_file : null),
      aadhaar_back_file: existing.aadhaar_back_file || (incomingFreshRefs.some((source) => source.side === "back" || source.side === "combined") ? incoming.aadhaar_back_file : null),
      aadhaar_front_preview_url: existing.aadhaar_front_preview_url || (incomingFreshRefs.some((source) => source.side === "front" || source.side === "combined") ? incoming.aadhaar_front_preview_url : ""),
      aadhaar_back_preview_url: existing.aadhaar_back_preview_url || (incomingFreshRefs.some((source) => source.side === "back" || source.side === "combined") ? incoming.aadhaar_back_preview_url : ""),
      aadhaar_front_name: existing.aadhaar_front_name || (incomingFreshRefs.some((source) => source.side === "front" || source.side === "combined") ? incoming.aadhaar_front_name : ""),
      aadhaar_back_name: existing.aadhaar_back_name || (incomingFreshRefs.some((source) => source.side === "back" || source.side === "combined") ? incoming.aadhaar_back_name : ""),
      document_side: existing.document_side === "unknown" ? incoming.document_side : existing.document_side,
      source_refs: sourceRefs,
      worker_name: existing.worker_name || incoming.worker_name,
      father_or_husband_name: existing.father_or_husband_name || incoming.father_or_husband_name,
      date_of_birth: existing.date_of_birth || incoming.date_of_birth,
      year_of_birth: existing.year_of_birth || incoming.year_of_birth,
      gender: existing.gender || incoming.gender,
      mobile_number: existing.mobile_number || incoming.mobile_number,
      daily_rate: existing.daily_rate || incoming.daily_rate,
      confidence: Math.max(Number(existing.confidence) || 0, Number(incoming.confidence) || 0) || null,
      existing: existing.existing || incoming.existing,
    };
    const pairingStatus = combinePairingStatus(merged);
    return {
      row: {
      ...merged,
      pairing_status: pairingStatus,
      match_state: pairingStatus.startsWith("duplicate") ? "conflict" : merged.match_state,
      match_message: pairingStatus === "paired" || pairingStatus === "combined" ? "Paired Aadhaar Front/Back" : pairingLabel(pairingStatus),
      error: pairingStatus.startsWith("duplicate") ? pairingLabel(pairingStatus) : "",
      },
      notices,
    };
  }

  function mergePendingRowsByAadhaar(currentRows: BatchRow[], incomingRows: BatchRow[]) {
    const merged = [...currentRows];
    const notices: string[] = [];
    incomingRows.forEach((incoming) => {
      const aadhaar = normalizeAadhaar(incoming.aadhaar_number);
      const existingIndex = aadhaar.length === 12
        ? merged.findIndex((row) => row.save_status !== "success" && normalizeAadhaar(row.aadhaar_number) === aadhaar)
        : -1;
      if (existingIndex >= 0) {
        const result = mergeAadhaarRows(merged[existingIndex], incoming);
        merged[existingIndex] = result.row;
        notices.push(...result.notices);
      } else {
        merged.push(incoming);
      }
    });
    return { rows: merged, notices: Array.from(new Set(notices)) };
  }

  async function processOcr(targetFiles: ProcessingFile[]) {
    if (!targetFiles.length || processingOcr) return;
    setProcessingOcr(true);
    try {
      setProcessingFiles((current) => current.map((file) => targetFiles.some((target) => target.id === file.id) ? { ...file, status: "Preparing file" } : file));
      const body = new FormData();
      body.set("company_id", assignment.company_id);
      body.set("site_id", assignment.site_id);
      targetFiles.forEach((file, index) => {
        body.append("files", file.file);
        body.set(`client_id_${index}`, file.id);
        body.set(`optimized_${index}`, file.optimized ? "true" : "false");
      });
      setProcessingFiles((current) => current.map((file) => targetFiles.some((target) => target.id === file.id) ? { ...file, status: "Reading Aadhaar" } : file));
      const response = await fetch("/api/labour/workers/ocr", {
        method: "POST",
        headers: { Authorization: `Bearer ${await token()}` },
        body,
      });
      const payload = await parsePayload(response);
      if (!response.ok) throw new Error(payload.error || "OCR failed.");
      const payloadRows = payload.rows || [];
      const extractedFileIds = new Set(payloadRows.filter((row: any) => row.status === "extracted").map((row: any) => row.id));
      const failedById = new Map(payloadRows.filter((row: any) => row.status !== "extracted").map((row: any) => [row.id, row]));
      const completedRows = buildRowsFromOcrResults(targetFiles, payloadRows);
      const previewMerge = mergePendingRowsByAadhaar(rows, completedRows);
      if (previewMerge.rows.filter((row) => row.save_status !== "success").length > MAX_GROUP_LABOURERS) {
        completedRows.forEach(revokeRowPreviews);
        throw new Error("Maximum 5 labourers can be reviewed at once.");
      }
      let mergeNotices: string[] = [];
      setRows((current) => {
        const result = mergePendingRowsByAadhaar(current, completedRows);
        mergeNotices = result.notices;
        return result.rows;
      });
      if (mergeNotices.length) setNotice(mergeNotices.join(" "));
      setProcessingFiles((current) => current
        .map((file) => {
          if (!targetFiles.some((target) => target.id === file.id)) return file;
          const failed = failedById.get(file.id) as any;
          if (failed) return { ...file, status: "OCR failed" as const, error: failed.error || "OCR failed. Retry or enter manually." };
          return file;
        })
        .filter((file) => !extractedFileIds.has(file.id)));
      completedRows.filter((row) => row.ocr_status === "extracted").forEach((row) => {
        void checkRow(row);
      });
    } catch (ocrError: any) {
      setProcessingFiles((current) => current.map((file) => targetFiles.some((target) => target.id === file.id)
        ? { ...file, status: "OCR failed" as const, error: ocrError.message || "OCR failed. Retry or enter manually." }
        : file));
    } finally {
      setProcessingOcr(false);
    }
  }

  async function retryProcessingFile(file: ProcessingFile) {
    if (processingOcr || saving) return;
    setNotice("");
    setProcessingFiles((current) => current.map((item) => item.id === file.id ? { ...item, status: "Queued", error: "" } : item));
    await processOcr([file]);
  }

  async function retryOcr(row: BatchRow) {
    if (processingOcr || saving || !row.file) return;
    setError("");
    setSuccess("");
    setNotice("");
    patchRow(row.id, {
      ocr_status: "reading",
      match_state: "validation",
      match_message: "Reading Aadhaar",
      error: "",
      result_message: "",
      document_warning: "",
    });
    try {
      const body = new FormData();
      body.set("company_id", assignment.company_id);
      body.set("site_id", assignment.site_id);
      body.append("files", row.file);
      body.set("client_id_0", row.id);
      body.set("optimized_0", "false");
      const response = await fetch("/api/labour/workers/ocr", {
        method: "POST",
        headers: { Authorization: `Bearer ${await token()}` },
        body,
      });
      const payload = await parsePayload(response);
      if (!response.ok) throw new Error(payload.error || "OCR failed.");
      const result = (payload.rows || []).find((item: any) => item.id === row.id) || { status: "failed", error: "OCR failed.", extraction: {} };
      const extraction = result.extraction || {};
      const nextRow = {
        ...row,
        ocr_status: result.status === "extracted" ? "extracted" as const : "failed" as const,
        worker_name: extraction.name || row.worker_name,
        father_or_husband_name: extraction.father_or_husband_name || row.father_or_husband_name,
        date_of_birth: extraction.date_of_birth || row.date_of_birth,
        year_of_birth: extraction.year_of_birth || row.year_of_birth,
        gender: extraction.gender || row.gender,
        aadhaar_number: extraction.aadhaar_number || row.aadhaar_number,
        confidence: extraction.confidence ?? row.confidence,
        match_state: result.status === "extracted" ? "new" as const : "validation" as const,
        match_message: result.status === "extracted" ? "New Labour" : "OCR Failed",
        error: result.error || "",
      };
      patchRow(row.id, {
        ocr_status: result.status === "extracted" ? "extracted" : "failed",
        worker_name: nextRow.worker_name,
        father_or_husband_name: nextRow.father_or_husband_name,
        date_of_birth: nextRow.date_of_birth,
        year_of_birth: nextRow.year_of_birth,
        gender: nextRow.gender,
        aadhaar_number: nextRow.aadhaar_number,
        confidence: nextRow.confidence,
        match_state: nextRow.match_state,
        match_message: nextRow.match_message,
        error: nextRow.error,
      });
      if (nextRow.ocr_status === "extracted") void checkRow(nextRow);
    } catch (retryError: any) {
      patchRow(row.id, {
        ocr_status: "failed",
        match_state: "validation",
        match_message: "OCR Failed",
        error: retryError.message || "This Aadhaar image could not be read clearly. You can retry or enter the details manually.",
      });
    }
  }

  async function checkRow(row: BatchRow) {
    const aadhaar = row.aadhaar_number.trim();
    const mobile = normalizeMobile(row.mobile_number);
    const name = row.worker_name.trim();
    const fatherName = row.father_or_husband_name.trim();
    if (aadhaar.replace(/\D/g, "").length < 8 && mobile.length < 8 && name.length < 3) {
      patchRow(row.id, { existing: null, match_state: "validation", match_message: "Validation Required" });
      return;
    }
    try {
      const params = new URLSearchParams();
      if (aadhaar) params.set("aadhaar_number", aadhaar);
      if (mobile) params.set("mobile_number", mobile);
      if (name) params.set("worker_name", name);
      if (fatherName) params.set("father_or_husband_name", fatherName);
      if (row.date_of_birth) params.set("date_of_birth", row.date_of_birth);
      const response = await fetch(`/api/labour/workers/register?${params.toString()}`, {
        headers: { Authorization: `Bearer ${await token()}` },
      });
      const payload = await parsePayload(response);
      if (!response.ok) throw new Error(payload.error || "Could not check existing labourer.");
      if (payload.conflict) {
        patchRow(row.id, { existing: null, match_state: "conflict", match_message: "A possible existing labourer requires supervisor review." });
        return;
      }
      if (payload.match) {
        const match = payload.match as ExistingMatch;
        const sameAssignment = (
          match.current_company_id === assignment.company_id &&
          match.current_site_id === assignment.site_id &&
          match.current_contractor_vendor_id === assignment.vendor_id &&
          match.current_labour_trade_id === row.labour_trade_id
        );
        patchRow(row.id, {
          existing: match,
          labour_code: match.labour_code || "",
          worker_name: match.worker_name || row.worker_name,
          father_or_husband_name: match.father_or_husband_name || row.father_or_husband_name,
          date_of_birth: match.date_of_birth || row.date_of_birth,
          aadhaar_number: match.aadhaar_number || row.aadhaar_number,
          mobile_number: match.mobile_number || row.mobile_number,
          labour_trade_id: row.labour_trade_id || match.current_labour_trade_id || "",
          daily_rate: row.daily_rate || (match.current_wage_rate != null ? String(match.current_wage_rate) : ""),
          match_state: "loaded",
          match_message: sameAssignment ? "This labourer is already registered at the selected site." : "Existing Labour — Transfer Required",
        });
        return;
      }
      patchRow(row.id, {
        existing: null,
        match_state: payload.weak ? "weak" : "new",
        match_message: payload.weak ? "Weak possible match. Verify identity details." : "New Labour",
      });
    } catch (checkError: any) {
      patchRow(row.id, { error: checkError.message || "Could not check existing labourer." });
    }
  }

  function patchRow(id: string, patch: Partial<BatchRow>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch, save_status: row.save_status === "success" ? row.save_status : "pending" } : row));
  }

  function removeRow(id: string) {
    setRows((current) => {
      const row = current.find((item) => item.id === id);
      if (row) revokeRowPreviews(row);
      return current.filter((item) => item.id !== id);
    });
  }

  function removeProcessingFile(id: string) {
    setProcessingFiles((current) => {
      const file = current.find((item) => item.id === id);
      if (file?.preview_url) URL.revokeObjectURL(file.preview_url);
      return current.filter((item) => item.id !== id);
    });
  }

  async function openExistingDetails(row: BatchRow) {
    if (!row.existing?.id) return;
    setDetailRowId(row.id);
    setDetailError("");
    if (workerDetails[row.existing.id]) return;
    setDetailLoading(row.existing.id);
    try {
      const response = await fetch(`/api/labour/workers/${row.existing.id}`, {
        headers: { Authorization: `Bearer ${await token()}` },
      });
      const payload = await parsePayload(response);
      if (!response.ok) throw new Error(payload.error || "Could not load labour details.");
      const deployments = Array.isArray(payload.deployments) ? payload.deployments : [];
      setWorkerDetails((current) => ({
        ...current,
        [row.existing!.id]: {
          worker: payload.worker || row.existing!,
          deployments,
        },
      }));
    } catch (error: any) {
      setDetailError(error.message || "Could not load labour details.");
    } finally {
      setDetailLoading("");
    }
  }

  const duplicateMap = useMemo(() => {
    const seen = new Map<string, string[]>();
    rows.filter((row) => row.save_status !== "success").forEach((row) => {
      const keys = [];
      const aadhaar = normalizeAadhaar(row.aadhaar_number);
      const mobileName = `${normalizeMobile(row.mobile_number)}::${normalizeIdentity(row.worker_name)}`;
      const strong = `${normalizeIdentity(row.worker_name)}::${normalizeIdentity(row.father_or_husband_name)}::${row.date_of_birth}`;
      if (aadhaar.length === 12) keys.push(`aadhaar:${aadhaar}`);
      if (normalizeMobile(row.mobile_number).length >= 8 && row.worker_name.trim()) keys.push(`mobile_name:${mobileName}`);
      if (row.worker_name.trim() && row.father_or_husband_name.trim() && row.date_of_birth) keys.push(`strong:${strong}`);
      keys.forEach((key) => seen.set(key, [...(seen.get(key) || []), row.id]));
    });
    return seen;
  }, [rows]);

  const rowsWithDuplicateState = rows.map((row) => {
    const hasDuplicate = Array.from(duplicateMap.values()).some((ids) => ids.length > 1 && ids.includes(row.id));
    return hasDuplicate && row.save_status !== "success"
      ? { ...row, match_state: "duplicate" as const, match_message: "Duplicate in This Batch" }
      : row;
  });
  const validRows = rowsWithDuplicateState.filter((row) => row.save_status !== "success" && rowValidation(row, assignmentRequiresDailyRate).length === 0);
  const categoryMissingCount = rowsWithDuplicateState.filter((row) => row.save_status !== "success" && !row.labour_trade_id).length;
  const rateMissingCount = assignmentRequiresDailyRate ? rowsWithDuplicateState.filter((row) => row.save_status !== "success" && !String(row.daily_rate || "").trim()).length : 0;
  const reviewSummary = validRows.length === rowsWithDuplicateState.length
    ? `${validRows.length} ready`
    : `${validRows.length} ready · ${categoryMissingCount ? `${categoryMissingCount} need category` : rateMissingCount ? `${rateMissingCount} need Daily Rate` : `${rowsWithDuplicateState.length - validRows.length} need review`}`;
  const completedOcrCount = rows.length + processingFiles.filter((file) => file.status === "OCR failed").length;
  const totalOcrCount = rows.length + processingFiles.length;

  async function saveBatch() {
    if (saving || !validRows.length) return;
    setSaving(true);
    setError("");
    setSuccess("");
    setNotice("");
    try {
      const body = new FormData();
      body.set("company_id", assignment.company_id);
      body.set("site_id", assignment.site_id);
      body.set("vendor_id", assignment.vendor_id);
      body.set("work_order_id", assignment.work_order_id);
      body.set("commercial_model", assignmentCommercialModel);
      body.set("effective_from", assignment.effective_from);
      const rowsToSave = rowsWithDuplicateState.filter((row) => row.save_status !== "success" && rowValidation(row, assignmentRequiresDailyRate).length === 0);
      body.set("rows", JSON.stringify(rowsToSave.map((row) => ({
        id: row.id,
        labour_trade_id: row.labour_trade_id,
        worker_name: row.worker_name,
        father_or_husband_name: row.father_or_husband_name,
        date_of_birth: row.date_of_birth,
        aadhaar_number: row.aadhaar_number,
        mobile_number: row.mobile_number,
        wage_rate: assignmentRequiresDailyRate ? row.daily_rate : "",
        remarks: row.remarks,
        existing_worker_id: row.existing?.id || null,
      }))));
      rowsToSave.forEach((row) => {
        if (row.aadhaar_front_file) body.set(`aadhaar_front_file_${row.id}`, row.aadhaar_front_file);
        if (row.aadhaar_back_file) body.set(`aadhaar_back_file_${row.id}`, row.aadhaar_back_file);
        if (!row.aadhaar_front_file && !row.aadhaar_back_file && row.file) body.set(`aadhaar_file_${row.id}`, row.file);
      });
      setRows((current) => current.map((row) => rowsToSave.some((target) => target.id === row.id) ? { ...row, save_status: "saving", error: "" } : row));
      const response = await fetch("/api/labour/workers/batch-register", {
        method: "POST",
        headers: { Authorization: `Bearer ${await token()}` },
        body,
      });
      const payload = await parsePayload(response);
      if (!response.ok) throw new Error(payload.error || "Failed to save batch.");
      const results = payload.results || [];
      const successful = results.filter((item: any) => item.status === "success");
      const failed = results.filter((item: any) => item.status !== "success");
      const successfulIds = new Set(successful.map((item: any) => item.id));
      const failedById = new Map(failed.map((item: any) => [item.id, item]));
      rowsToSave.forEach((row) => {
        if (successfulIds.has(row.id)) revokeRowPreviews(row);
      });
      setRows((current) => current
        .map((row) => {
          const failedResult = failedById.get(row.id) as any;
          if (failedResult) return { ...row, save_status: "failed" as const, error: failedResult.error || "Failed to save this row." };
          return row;
        })
        .filter((row) => !successfulIds.has(row.id)));
      setSessionCount((count) => count + successful.length);
      setBatchStats((current) => ({
        registered: current.registered + successful.filter((item: any) => item.action === "registered" || item.action === "reactivated" || item.action === "already_registered").length,
        transferred: current.transferred + successful.filter((item: any) => item.action === "transferred").length,
        failed: current.failed + failed.length,
      }));
      setRecent((current) => [
        ...successful.map((result: any) => ({
          code: result.labour_code || "",
          name: rowsToSave.find((row) => row.id === result.id)?.worker_name || "-",
          action: result.action || "registered",
        })),
        ...current,
      ].slice(0, 5));
      const summaryText = `Saved ${successful.length} of ${rowsToSave.length} reviewed row(s). Successful rows are cleared for the next Aadhaar cards.`;
      if (successful.length > 0) setSuccess(summaryText);
      if (failed.length > 0) setError(successful.length > 0 ? `${failed.length} row(s) failed. Fix the highlighted rows and save again.` : "No rows were saved. Fix the highlighted row and save again.");
    } catch (saveError: any) {
      setError(saveError.message || "Failed to save batch.");
      setRows((current) => current.map((row) => row.save_status === "saving" ? { ...row, save_status: "pending" } : row));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-3 py-4 md:px-10 md:py-7">
      <div className="mx-auto max-w-[1180px] space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Labour Registration</p>
            <h1 className="text-2xl font-semibold md:text-3xl">Labour Registration</h1>
            <p className="mt-1 text-sm text-slate-600">Register up to 5 Aadhaar cards for one contractor assignment, then review and save together.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/labour/workers" className="inline-flex h-11 items-center rounded-lg border bg-white px-4 text-sm font-semibold">Back to Directory</Link>
          </div>
        </header>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
        {success && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-800">
            <div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5" /> {success}</div>
          </div>
        )}
        {notice && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">{notice}</div>}

        {assignmentLocked && (
          <section className="sticky top-3 z-20 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur md:p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <Info label="Company" value={(lookups.companies || []).find((company: any) => company.id === assignment.company_id)?.company_name} />
                <Info label="Site" value={selectedSiteName} />
                <Info label="Contractor" value={(lookups.vendors || []).find((vendor: any) => vendor.id === assignment.vendor_id)?.vendor_name} />
                <Info label="Work Order" value={selectedWorkOrder ? `${selectedWorkOrder.wo_number || "WO"} — ${selectedWorkOrder.wo_type || "Work Order"}` : "No Work Order"} />
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Payment Model</p>
                  <PaymentModelBadge label={paymentModelLabel} />
                </div>
                <Info label="Joining Date" value={formatDate(assignment.effective_from)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={changeAssignment} disabled={saving || processingOcr} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border bg-white px-3 text-sm font-semibold disabled:opacity-60"><Pencil className="h-4 w-4" /> Change Assignment</button>
              </div>
            </div>
          </section>
        )}

        {!assignmentLocked && (
          <section className="rounded-lg border bg-white p-4 shadow-sm md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Assignment</h2>
              <PaymentModelBadge label={paymentModelLabel} />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Select label="Company *" value={assignment.company_id} onChange={(value) => updateAssignment({ company_id: value, vendor_id: "", work_order_id: "" })} options={lookups.companies || []} labelKey="company_name" />
              <Select label="Site *" value={assignment.site_id} onChange={(value) => updateAssignment({ site_id: value, vendor_id: "", work_order_id: "" })} options={lookups.sites || []} labelKey="site_name" />
              <Select label="Labour Contractor *" value={assignment.vendor_id} onChange={(value) => updateAssignment({ vendor_id: value, work_order_id: "" })} options={lookups.vendors || []} labelKey="vendor_name" disabled={lookupLoading || !assignment.company_id || !assignment.site_id} placeholder={lookupLoading ? "Loading contractors..." : "Select"} helper={assignment.company_id && assignment.site_id && !lookupLoading && !(lookups.vendors || []).length ? "No Work Order contractors found for this company/site." : ""} />
              {hasSingleDailyWageWorkOrder ? (
                <Info label="Work Order" value={`${selectedWorkOrder?.wo_number || "WO"} — ${selectedWorkOrder?.wo_type || "Work Order"}`} />
              ) : hasNoEligibleWorkOrders ? (
                <div>
                  <Info label="Work Order" value="No linked Work Orders available" />
                  <p className="mt-1 text-[11px] font-semibold text-slate-500">No Work Order found for this contractor and site. Labour will be registered as Contractual Labour.</p>
                </div>
              ) : (
                <Select label="Work Order (Optional)" value={assignment.work_order_id} onChange={(value) => updateAssignment({ work_order_id: value })} options={assignmentWorkOrders} labelKey={(workOrder: any) => `${workOrder.wo_number || "WO"} — ${workOrder.wo_type || "Work Order"}`} disabled={lookupLoading || !assignment.company_id || !assignment.site_id || !assignment.vendor_id} placeholder={lookupLoading ? "Loading Work Orders..." : "Select Work Order"} helper={assignment.company_id && assignment.site_id && assignment.vendor_id && !lookupLoading && assignmentWorkOrders.length > 1 && !assignment.work_order_id ? "Select the applicable Work Order." : ""} />
              )}
              <Input label="Site Joining Date *" type="date" value={assignment.effective_from} onChange={(value) => updateAssignment({ effective_from: value })} />
            </div>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={startRegistration} disabled={!assignmentReady} className="h-12 w-full rounded-lg bg-slate-950 px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">Start Registration</button>
            </div>
          </section>
        )}

        {assignmentLocked && (
          <>
            <section className="rounded-lg border bg-white p-4 shadow-sm md:p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Add Labour</h2>
                  <p className="mt-1 text-sm text-slate-500">Use Aadhaar when available, or add a manual No Aadhaar row. Nothing is saved until Save Batch.</p>
                </div>
                {processingOcr && <span className="inline-flex items-center gap-2 text-sm font-bold text-sky-700"><Search className="h-4 w-4 animate-pulse" /> Reading Aadhaar...</span>}
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-600">{rows.filter((row) => row.save_status !== "success").length} of {MAX_GROUP_LABOURERS} labourers · {rows.filter((row) => row.save_status !== "success").reduce((count, row) => count + (row.aadhaar_front_file ? 1 : 0) + (row.aadhaar_back_file ? 1 : 0) + (!row.aadhaar_front_file && !row.aadhaar_back_file && row.file ? 1 : 0), 0) + processingFiles.length} of {MAX_AADHAAR_FILES} Aadhaar files</p>
              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                <button type="button" onClick={openCamera} disabled={processingOcr || saving} className="flex min-h-20 items-center justify-center gap-3 rounded-xl border-2 border-dashed bg-slate-50 px-4 py-5 text-sm font-bold text-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
                  <Camera className="h-5 w-5" /> Capture Aadhaar
                </button>
                <button type="button" onClick={() => uploadInputRef.current?.click()} disabled={processingOcr || saving} className="flex min-h-20 items-center justify-center gap-3 rounded-xl border-2 border-dashed bg-slate-50 px-4 py-5 text-sm font-bold text-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
                  <ImageUp className="h-5 w-5" /> Upload Aadhaar
                </button>
                <button type="button" onClick={addManualRow} disabled={processingOcr || saving} className="flex min-h-20 items-center justify-center gap-3 rounded-xl border-2 border-dashed bg-slate-50 px-4 py-5 text-sm font-bold text-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
                  <FilePlus2 className="h-5 w-5" /> Add Manually — No Aadhaar
                </button>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept={AADHAAR_ACCEPT}
                  multiple
                  onChange={(event) => {
                    addFiles(event.target.files);
                    event.currentTarget.value = "";
                  }}
                  className="hidden"
                />
              </div>
            </section>

            {!!processingFiles.length && (
              <section className="rounded-lg border bg-white p-4 shadow-sm md:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">Processing Aadhaar Cards</h2>
                    <p className="mt-1 text-sm text-slate-500">Processing Aadhaar cards... {completedOcrCount} of {totalOcrCount} completed</p>
                  </div>
                  <span className="inline-flex items-center gap-2 text-sm font-bold text-sky-700"><Search className="h-4 w-4 animate-pulse" /> Reading Aadhaar</span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {processingFiles.map((file) => (
                    <div key={file.id} className="flex items-center gap-3 rounded-lg border bg-slate-50 p-3">
                      {file.preview_url ? <img src={file.preview_url} alt="" className="h-14 w-14 rounded-lg object-cover" /> : <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-slate-200 text-xs font-bold">PDF</div>}
                      <div className="min-w-0 flex-1">
                        <p className="max-w-52 truncate text-sm font-bold">{file.file_name}</p>
                        <p className={`text-xs font-semibold ${file.status === "OCR failed" ? "text-red-700" : "text-sky-700"}`}>{file.status}</p>
                        {file.error && <p className="mt-1 text-xs font-semibold text-red-700">{file.error}</p>}
                        {file.status === "OCR failed" && (
                          <div className="mt-2 flex gap-2">
                            <button type="button" onClick={() => retryProcessingFile(file)} disabled={processingOcr || saving} className="rounded-lg border bg-white px-2 py-1 text-xs font-bold disabled:opacity-60">Retry OCR</button>
                            <button type="button" onClick={() => removeProcessingFile(file.id)} disabled={processingOcr || saving} className="rounded-lg border bg-white px-2 py-1 text-xs font-bold text-red-700 disabled:opacity-60">Remove</button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {!!rowsWithDuplicateState.length && (
              <section className="rounded-lg border bg-white shadow-sm">
                <div className="border-b p-4 md:p-5">
                  <h2 className="text-lg font-semibold">Identity Verification</h2>
                  <p className="mt-1 text-sm text-slate-500">Check each Aadhaar result. Complete only the rows that are ready for this site.</p>
                  <PairingSummary rows={rowsWithDuplicateState} />
                </div>
                <div className="space-y-3 p-3 md:p-4">
                  {rowsWithDuplicateState.map((row) => (
                    <div key={row.id} className="relative rounded-lg border bg-slate-50 p-2.5 pr-12">
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        disabled={saving}
                        aria-label="Remove labour row"
                        title="Remove labour row"
                        className="absolute right-2.5 top-2.5 inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-200 bg-white text-red-600 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <X className="h-4 w-4" />
                      </button>
                      <div className="grid gap-3 lg:gap-2 xl:grid-cols-[7.25rem_minmax(9rem,1.2fr)_minmax(7.5rem,1fr)_7rem_8rem_minmax(8.5rem,1fr)_7.5rem_6.75rem_7.75rem_8.5rem] xl:items-start">
                        <FilePreview row={row} />
                        <div>
                          <MatchBadge row={row} onOpenDetails={() => openExistingDetails(row)} />
                          <Input label="Name *" value={row.worker_name} onChange={(value) => patchRow(row.id, { worker_name: value })} onBlur={() => checkRow(row)} compact />
                        </div>
                        <Input label="Father/Husband Name" value={row.father_or_husband_name} onChange={(value) => patchRow(row.id, { father_or_husband_name: value })} onBlur={() => checkRow(row)} compact />
                        <Input label="DOB" type="date" value={row.date_of_birth} onChange={(value) => patchRow(row.id, { date_of_birth: value })} onBlur={() => checkRow(row)} compact />
                        <Input label="Aadhaar" value={row.aadhaar_number} onChange={(value) => patchRow(row.id, { aadhaar_number: aadhaarInputValue(value) })} onBlur={() => checkRow({ ...row, aadhaar_number: aadhaarInputValue(row.aadhaar_number) })} compact inputMode="numeric" maxLength={14} />
                        <Select label="Labour Category *" value={row.labour_trade_id} onChange={(value) => patchRow(row.id, { labour_trade_id: value })} options={lookups.trades || []} labelKey="trade_name" compact error={!row.labour_trade_id} helper={!row.labour_trade_id ? "Select category" : ""} />
                        <Input label="Mobile" value={row.mobile_number} onChange={(value) => patchRow(row.id, { mobile_number: value })} onBlur={() => checkRow(row)} compact />
                        {assignmentRequiresDailyRate
                          ? <Input label="Daily Rate (₹)" type="number" value={row.daily_rate} onChange={(value) => patchRow(row.id, { daily_rate: value.replace(/\D/g, "") })} compact />
                          : <Info label="Daily Rate" value="Not Applicable" />}
                        <div className="min-w-0" />
                        <div className="flex flex-wrap gap-1.5 xl:flex-col xl:items-stretch">
                          {row.existing && !isSameSelectedAssignment(row, assignment) && (
                            <button type="button" aria-label="Assign to Current Site" title="Assign to Current Site" onClick={() => patchRow(row.id, { match_message: "Ready to assign to the current site. Save Batch to complete." })} className="rounded-lg bg-slate-950 px-2 py-1.5 text-[11px] font-bold text-white">
                              Assign
                            </button>
                          )}
                          {row.existing && isSameSelectedAssignment(row, assignment) && row.existing.status === "active" && (
                            <Link href="/labour/attendance/daily" className="inline-flex rounded-lg bg-green-700 px-2 py-1.5 text-[11px] font-bold text-white">Attendance</Link>
                          )}
                          {row.existing && row.existing.status !== "active" && (
                            <Link href={`/labour/workers/${row.existing.id}?activate=1&source=registration`} className="rounded-lg bg-amber-100 px-2 py-1.5 text-[11px] font-bold text-amber-800">Reactivate</Link>
                          )}
                          {row.ocr_status === "failed" && (
                            <button type="button" onClick={() => retryOcr(row)} disabled={processingOcr || saving} className="rounded-lg border bg-white px-2 py-1.5 text-[11px] font-bold disabled:opacity-60">
                              Retry OCR
                            </button>
                          )}
                        </div>
                      </div>
                      <RowStatus row={row} requiresDailyRate={assignmentRequiresDailyRate} />
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-3 border-t p-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-semibold text-slate-600">{reviewSummary}</p>
                  <button type="button" onClick={saveBatch} disabled={saving || !validRows.length} className="h-12 rounded-lg bg-slate-950 px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
                    {saving ? "Saving Batch..." : `Save ${validRows.length} Labourer${validRows.length === 1 ? "" : "s"}`}
                  </button>
                </div>
              </section>
            )}

            <section className="rounded-lg border bg-white p-4 shadow-sm md:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Today's Registered Labour</h2>
                  <p className="mt-1 text-sm text-slate-500">Saved labour for this registration session.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={finishBatch} disabled={saving || processingOcr} className="h-11 rounded-lg border bg-white px-3 text-sm font-semibold disabled:opacity-60">Finish Batch</button>
                </div>
              </div>
              {recent.length ? (
                <div className="mt-4 overflow-hidden rounded-lg border">
                  <div className="grid grid-cols-[7rem_minmax(0,1fr)_7rem] gap-2 bg-slate-50 px-3 py-2 text-xs font-bold uppercase text-slate-500">
                    <span>Labour Code</span>
                    <span>Labour Name</span>
                    <span>Status</span>
                  </div>
                  <div className="divide-y">
                    {recent.map((item, index) => (
                      <div key={`${item.code}-${item.name}-${index}`} className="grid grid-cols-[7rem_minmax(0,1fr)_7rem] gap-2 px-3 py-2 text-sm">
                        <span className="font-semibold text-slate-800">{formatLabourCode(item.code)}</span>
                        <span className="min-w-0 truncate text-slate-900">{item.name}</span>
                        <span className="font-semibold text-slate-600">{formatAction(item.action)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-500">No labour saved in this session yet.</p>
              )}
            </section>
          </>
        )}
        {cameraOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Capture Aadhaar">
            <div className="max-h-[100svh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:max-w-2xl sm:rounded-2xl">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Capture Aadhaar</h2>
                <button type="button" onClick={closeCamera} className="rounded-lg border px-3 py-2 text-sm font-semibold">Cancel</button>
              </div>
              {cameraError ? (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                  <p>{cameraError}</p>
                  <button type="button" onClick={() => uploadInputRef.current?.click()} className="mt-3 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Upload Aadhaar</button>
                </div>
              ) : capturedPreview ? (
                <img src={capturedPreview} alt="Captured Aadhaar preview" className="mt-4 max-h-[65svh] w-full rounded-lg object-contain bg-slate-100" />
              ) : (
                <video ref={videoRef} autoPlay playsInline muted className="mt-4 max-h-[65svh] w-full rounded-lg bg-black object-contain" />
              )}
              <canvas ref={canvasRef} className="hidden" />
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                {!cameraError && !capturedPreview && <button type="button" onClick={captureAadhaarPhoto} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Capture</button>}
                {capturedPreview && <button type="button" onClick={retakeAadhaarPhoto} className="rounded-lg border px-4 py-2 text-sm font-semibold">Retake</button>}
                {capturedPreview && <button type="button" onClick={useCapturedPhoto} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Use Photo</button>}
              </div>
            </div>
          </div>
        )}
        {detailRowId && (
          <ExistingLabourDetailsModal
            row={rowsWithDuplicateState.find((row) => row.id === detailRowId) || null}
            details={(() => {
              const row = rowsWithDuplicateState.find((item) => item.id === detailRowId);
              return row?.existing?.id ? workerDetails[row.existing.id] || null : null;
            })()}
            loading={detailLoading}
            error={detailError}
            onClose={() => {
              setDetailRowId("");
              setDetailError("");
            }}
          />
        )}
      </div>
    </section>
  );
}

function FilePreview({ row }: { row: BatchRow }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {row.source_type === "manual" ? (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-[10px] font-black">MAN</div>
      ) : row.preview_url ? <img src={row.preview_url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" /> : <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-xs font-bold">PDF</div>}
      <div className="min-w-0">
        <p title={row.file_name} className="max-w-20 truncate text-xs font-bold text-slate-800">{row.source_type === "manual" ? "MANUAL ENTRY" : row.file_name}</p>
        <p className="text-xs text-slate-500">{row.source_type === "manual" ? "No Aadhaar" : pairingLabel(row.pairing_status)}</p>
        {row.source_type === "aadhaar" && (
          <p className="mt-0.5 text-[10px] font-bold text-slate-500">
            Front: {row.aadhaar_front_file ? "Added" : "Missing"} · Back: {row.aadhaar_back_file ? "Added" : "Missing"}
          </p>
        )}
      </div>
    </div>
  );
}

function PairingSummary({ rows }: { rows: BatchRow[] }) {
  const aadhaarRows = rows.filter((row) => row.source_type === "aadhaar");
  if (!aadhaarRows.length) return null;
  const exceptions = aadhaarRows.filter((row) => row.pairing_status !== "paired");
  return (
    <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs font-semibold text-slate-700">
      <p>{aadhaarRows.length} Labourers Detected · {aadhaarRows.length} Aadhaar · {rows.filter((row) => row.source_type === "manual").length} Manual</p>
      {!!exceptions.length && <p className="mt-1 text-amber-700">{exceptions.length} pairing item{exceptions.length === 1 ? "" : "s"} need review. Unmatched Aadhaar Files are never guessed.</p>}
    </div>
  );
}

function RowStatus({ row, requiresDailyRate }: { row: BatchRow; requiresDailyRate: boolean }) {
  const label = rowStateLabel(row, requiresDailyRate);
  const validation = rowValidation(row, requiresDailyRate);
  const ocrFailed = row.ocr_status === "failed";
  const showAlreadyAssigned = Boolean(row.existing && row.match_message.includes("already registered"));
  const showMatchWarning = row.match_state === "conflict" || row.match_state === "duplicate" || row.match_state === "weak";
  const showAadhaarDocumentWarning = row.pairing_status === "needs_pairing";
  const hasMessage = ocrFailed || validation.length > 0 || Boolean(row.error) || Boolean(row.document_warning) || showAlreadyAssigned || showMatchWarning || showAadhaarDocumentWarning;
  if (!hasMessage) return null;
  const tone = row.save_status === "success" ? "green" : ocrFailed || row.match_state === "conflict" || row.match_state === "duplicate" || label.includes("required") ? "red" : row.match_state === "weak" || showAlreadyAssigned ? "amber" : "sky";
  const classes: Record<string, string> = {
    green: "bg-green-100 text-green-800",
    red: "bg-red-100 text-red-700",
    amber: "bg-amber-100 text-amber-800",
    sky: "bg-sky-100 text-sky-800",
  };
  const primaryMessage = row.error || (showAlreadyAssigned || showMatchWarning ? row.match_message : "");
  return (
    <div className="mt-3 rounded-lg border bg-white px-3 py-2 text-xs font-semibold">
      <span className={`inline-flex rounded-full px-2 py-1 ${classes[tone]}`}>{ocrFailed ? "OCR failed" : label}</span>
      {validation.length > 0 && <p className="mt-1 text-red-700">{validation[0]}</p>}
      {ocrFailed && (
        <div className="mt-1 text-[11px] font-medium text-red-700">
          <p className="font-bold">Couldn't read this Aadhaar.</p>
          <p>Please check image clarity, ensure Aadhaar is fully visible, then upload again or enter details manually.</p>
        </div>
      )}
      {primaryMessage && !ocrFailed && !validation.length && <p className={`mt-1 ${tone === "red" ? "text-red-700" : "text-slate-700"}`}>{primaryMessage}</p>}
      {showAadhaarDocumentWarning && !validation.length && <p className="mt-1 text-amber-700">Aadhaar document not uploaded. Upload later to complete verification.</p>}
      {row.document_warning && <p className="mt-1">{row.document_warning}</p>}
    </div>
  );
}

function rowStateLabel(row: BatchRow, requiresDailyRate = true) {
  if (row.pairing_status === "duplicate_front") return "Duplicate Front";
  if (row.pairing_status === "duplicate_back") return "Duplicate Back";
  if (row.pairing_status === "number_mismatch") return "Number Mismatch";
  if (row.pairing_status === "needs_pairing") return "Needs Pairing";
  if (row.ocr_status === "queued") return "Queued";
  if (row.ocr_status === "reading") return "Reading Aadhaar";
  if (row.ocr_status === "failed") return "OCR Failed";
  const validation = rowValidation(row, requiresDailyRate);
  if (validation.length) return `${validation.length} field${validation.length === 1 ? "" : "s"} required`;
  if (row.match_state === "conflict" || row.match_state === "duplicate" || row.match_state === "validation") return "Needs Verification";
  if (row.existing && row.match_message.includes("already registered")) return "Already at site";
  if (row.existing) return "Existing - assign required";
  return "Ready";
}

function pairingLabel(status: PairingStatus) {
  if (status === "manual") return "Manual Entry";
  if (status === "paired") return "Paired";
  if (status === "combined") return "Combined";
  if (status === "needs_pairing") return "Needs Pairing";
  if (status === "front_missing") return "Front Missing";
  if (status === "back_missing") return "Back Missing";
  if (status === "duplicate_front") return "Duplicate Front";
  if (status === "duplicate_back") return "Duplicate Back";
  if (status === "number_mismatch") return "Aadhaar numbers do not match";
  return "Unmatched Aadhaar Files";
}

function matchLabel(row: BatchRow) {
  if (row.ocr_status === "failed") return "OCR FAILED";
  if (row.match_state === "loaded") return "EXISTING LABOUR";
  if (row.match_state === "conflict" || row.match_state === "duplicate" || row.match_state === "validation") return "NEEDS VERIFICATION";
  return "NEW LABOUR";
}

function formatAction(action: string) {
  if (action === "transferred") return "Transferred";
  if (action === "reactivated") return "Reactivated";
  if (action === "already_registered") return "Already registered";
  return "Registered";
}

function IdentityValue({ label, value, emphasize = false }: { label: string; value?: string | null; emphasize?: boolean }) {
  const display = value || "-";
  return (
    <div>
      <p className="text-xs font-bold uppercase text-slate-500">{label}</p>
      <p className={`${emphasize ? "inline-flex rounded-full bg-slate-950 px-3 py-1 text-xs font-bold text-white" : "text-sm font-semibold text-slate-900"}`}>{display}</p>
    </div>
  );
}

function MatchBadge({ row, onOpenDetails }: { row: BatchRow; onOpenDetails?: () => void }) {
  const label = matchLabel(row);
  const tone = label === "EXISTING LABOUR" ? "bg-sky-100 text-sky-800" : label === "NEW LABOUR" ? "bg-green-100 text-green-800" : label === "OCR FAILED" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800";
  if (label === "EXISTING LABOUR" && row.existing) {
    return (
      <button
        type="button"
        onClick={onOpenDetails}
        className={`mb-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-black tracking-wide underline-offset-2 hover:underline ${tone}`}
      >
        {label}
      </button>
    );
  }
  return <span className={`mb-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-black tracking-wide ${tone}`}>{label}</span>;
}

function deploymentCompany(deployment: any) {
  return deployment?.companies?.company_name || deployment?.company_name || "-";
}

function deploymentSite(deployment: any) {
  return deployment?.sites?.site_name || deployment?.site_name || "-";
}

function deploymentContractor(deployment: any) {
  return deployment?.labour_contractor_profiles?.vendors?.vendor_name || deployment?.contractor_name || deployment?.labour_contractor_profiles?.contractor_code || "-";
}

function deploymentCategory(deployment: any) {
  return deployment?.labour_trades?.trade_name || deployment?.category_name || deployment?.trade || "-";
}

function formatRate(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return `₹ ${value}`;
}

function ExistingLabourDetailsModal({ row, details, loading, error, onClose }: {
  row: BatchRow | null;
  details: WorkerDetail | null;
  loading: string;
  error: string;
  onClose: () => void;
}) {
  const worker = details?.worker || row?.existing || null;
  const deployments = [...(details?.deployments || row?.existing?.recent_assignments || [])].sort((a: any, b: any) => String(b.effective_from || "").localeCompare(String(a.effective_from || "")));
  const latest = deployments[0] || row?.existing?.last_assignment || null;
  if (!row || !worker) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Existing labour details">
      <div className="max-h-[92svh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:max-w-4xl sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b pb-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-700">Existing Labour</p>
            <h2 className="text-lg font-semibold">{worker.worker_name || row.worker_name || "Labour Details"}</h2>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-full border bg-white text-slate-700" aria-label="Close existing labour details">
            <X className="h-4 w-4" />
          </button>
        </div>
        {loading && <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-600">Loading labour details...</p>}
        {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border bg-slate-50 p-3">
            <h3 className="text-xs font-bold uppercase text-slate-500">Identity</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Info label="Labour Code" value={formatLabourCode(worker.labour_code)} />
              <Info label="Name" value={worker.worker_name || row.worker_name || "-"} />
              <Info label="Mobile" value={worker.mobile_number || row.mobile_number || "-"} />
              <Info label="Aadhaar" value={maskAadhaar(worker.aadhaar_number || row.aadhaar_number)} />
              <Info label="Worker Status" value={worker.status || "-"} />
            </div>
          </div>
          <div className="rounded-lg border bg-slate-50 p-3">
            <h3 className="text-xs font-bold uppercase text-slate-500">Current / Most Recent Assignment</h3>
            {latest ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Info label="Company" value={deploymentCompany(latest) || worker.current_company_name || "-"} />
                <Info label="Site" value={deploymentSite(latest) || worker.current_site_name || "-"} />
                <Info label="Contractor" value={deploymentContractor(latest) || worker.current_contractor_name || "-"} />
                <Info label="Labour Category" value={deploymentCategory(latest) || worker.current_category_name || "-"} />
                <Info label="Daily Rate" value={formatRate(latest.daily_rate ?? latest.wage_rate ?? worker.current_wage_rate)} />
                <Info label="Assignment Start" value={formatDate(latest.effective_from || worker.current_effective_from)} />
                <Info label="Last Working Date" value={latest.effective_to ? formatDate(latest.effective_to) : "Current"} />
                <Info label="Deployment Status" value={latest.status || "-"} />
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-600">No previous deployment history found.</p>
            )}
          </div>
        </div>
        <div className="mt-4 rounded-lg border">
          <div className="border-b bg-slate-50 px-3 py-2">
            <h3 className="text-xs font-bold uppercase text-slate-500">Deployment History</h3>
          </div>
          {deployments.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-white text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Company</th>
                    <th className="px-3 py-2">Site</th>
                    <th className="px-3 py-2">Contractor</th>
                    <th className="px-3 py-2">From Date</th>
                    <th className="px-3 py-2">To Date</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Daily Rate</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {deployments.map((deployment: any, index) => (
                    <tr key={deployment.id || `${deployment.effective_from}-${index}`}>
                      <td className="px-3 py-2">{deploymentCompany(deployment)}</td>
                      <td className="px-3 py-2">{deploymentSite(deployment)}</td>
                      <td className="px-3 py-2">{deploymentContractor(deployment)}</td>
                      <td className="px-3 py-2">{formatDate(deployment.effective_from)}</td>
                      <td className="px-3 py-2">{deployment.effective_to ? formatDate(deployment.effective_to) : "Current"}</td>
                      <td className="px-3 py-2">{deploymentCategory(deployment)}</td>
                      <td className="px-3 py-2">{formatRate(deployment.daily_rate ?? deployment.wage_rate)}</td>
                      <td className="px-3 py-2">{deployment.status || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-3 text-sm text-slate-600">No previous deployment history found.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function isSameSelectedAssignment(row: BatchRow, assignment: typeof emptyAssignment) {
  return Boolean(row.existing && (
    row.existing.current_company_id === assignment.company_id &&
    row.existing.current_site_id === assignment.site_id &&
    row.existing.current_contractor_vendor_id === assignment.vendor_id &&
    row.existing.current_labour_trade_id === row.labour_trade_id
  ));
}


function Input({ label, value, onChange, onBlur, type = "text", disabled = false, compact = false, inputMode, maxLength }: { label?: string; value: string; onChange: (value: string) => void; onBlur?: () => void; type?: string; disabled?: boolean; compact?: boolean; inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search"; maxLength?: number }) {
  const input = <input type={type} value={value} disabled={disabled} onBlur={onBlur} inputMode={inputMode} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} className={`${compact ? "h-9 text-xs" : "h-11 text-sm"} mt-1 w-full rounded-lg border bg-white px-3 disabled:bg-slate-100 disabled:text-slate-500`} />;
  if (!label) return input;
  return <label className="text-sm font-semibold text-slate-700">{label}{input}</label>;
}

function Select({ label, value, onChange, options, labelKey, compact = false, error = false, helper = "", disabled = false, placeholder = "Select" }: { label?: string; value: string; onChange: (value: string) => void; options: any[]; labelKey: string | ((row: any) => string); compact?: boolean; error?: boolean; helper?: string; disabled?: boolean; placeholder?: string }) {
  const select = (
    <>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={`${compact ? "h-9 text-xs" : "h-11 text-sm"} mt-1 w-full rounded-lg border bg-white px-3 disabled:bg-slate-100 disabled:text-slate-500 ${error ? "border-red-300 ring-1 ring-red-200" : ""}`}>
      <option value="">{placeholder}</option>
      {options.map((option) => <option key={option.id} value={option.id}>{typeof labelKey === "function" ? labelKey(option) : option[labelKey]}</option>)}
      </select>
      {helper && <p className={`mt-1 text-[11px] font-semibold ${error ? "text-red-600" : "text-slate-500"}`}>{helper}</p>}
    </>
  );
  if (!label) return select;
  return <label className="text-sm font-semibold text-slate-700">{label}{select}</label>;
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return <div><p className="text-xs font-bold uppercase text-slate-500">{label}</p><p className="font-semibold text-slate-900">{value || "-"}</p></div>;
}

function PaymentModelBadge({ label }: { label: string }) {
  const classes = label === "Daily Wage" ? "bg-sky-100 text-sky-800" : label === "Contractual Labour" ? "bg-slate-100 text-slate-700" : "bg-amber-50 text-amber-700";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${classes}`}>{label}</span>;
}
