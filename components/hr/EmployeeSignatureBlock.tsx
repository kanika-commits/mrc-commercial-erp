"use client";

import { ImageUp, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { EmployeeSignatureBlock as EmployeeSignatureBlockType, EmployeeSignatureProfile, HrEmployee } from "@/types/hr";
import { getAccessToken } from "./hrClient";

const MAX_SIGNATURE_SIZE = 2 * 1024 * 1024;
const ALLOWED_SIGNATURE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type Props = {
  employee: HrEmployee;
  designation: string;
  department: string;
  canEdit: boolean;
  onError: (message: string) => void;
};

function formatFileSize(size?: number | null) {
  if (!size) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function EmployeeSignatureBlock({
  employee,
  designation,
  department,
  canEdit,
  onError,
}: Props) {
  const [signature, setSignature] = useState<EmployeeSignatureProfile | null>(null);
  const [signatureBlock, setSignatureBlock] = useState<EmployeeSignatureBlockType | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const previewUrl = useMemo(() => selectedFile ? URL.createObjectURL(selectedFile) : null, [selectedFile]);
  const signatureUrl = previewUrl || signatureBlock?.signatureImageUrl || null;
  const employeeName = signatureBlock?.employeeName || employee.employee_name || "-";
  const signatureDesignation = signatureBlock?.designation || designation || "-";
  const signatureDepartment = signatureBlock?.department || department || "-";

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    void loadSignature();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee.id]);

  async function loadSignature() {
    setMessage("");
    onError("");
    try {
      const token = await getAccessToken();
      const response = await fetch(`/api/hr/employees/${employee.id}/signature`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Failed to load employee signature.");
      setSignature(result.signature || null);
      setSignatureBlock(result.signatureBlock || null);
    } catch (error: any) {
      onError(error.message || "Failed to load employee signature.");
    }
  }

  function selectFile(file: File | null) {
    setMessage("");
    onError("");
    if (!file) {
      setSelectedFile(null);
      return;
    }
    if (!ALLOWED_SIGNATURE_TYPES.has(file.type)) {
      setSelectedFile(null);
      onError("Only PNG, JPG and WEBP signature images are allowed.");
      return;
    }
    if (file.size > MAX_SIGNATURE_SIZE) {
      setSelectedFile(null);
      onError("Signature image must be 2MB or smaller.");
      return;
    }
    setSelectedFile(file);
  }

  async function saveSignature() {
    if (!selectedFile || busy) return;
    setBusy(true);
    setMessage("");
    onError("");
    try {
      const token = await getAccessToken();
      const body = new FormData();
      body.set("signature", selectedFile);
      const response = await fetch(`/api/hr/employees/${employee.id}/signature`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Failed to save employee signature.");
      setSignature(result.signature || null);
      setSignatureBlock(result.signatureBlock || null);
      setSelectedFile(null);
      setMessage(signature ? "Signature replaced." : "Signature uploaded.");
    } catch (error: any) {
      onError(error.message || "Failed to save employee signature.");
    } finally {
      setBusy(false);
    }
  }

  async function removeSignature() {
    if (!signature || busy) return;
    if (!window.confirm("Remove this employee signature?")) return;
    setBusy(true);
    setMessage("");
    onError("");
    try {
      const token = await getAccessToken();
      const response = await fetch(`/api/hr/employees/${employee.id}/signature`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Failed to remove employee signature.");
      setSignature(null);
      setSignatureBlock(result.signatureBlock || null);
      setSelectedFile(null);
      setMessage("Signature removed.");
    } catch (error: any) {
      onError(error.message || "Failed to remove employee signature.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Signature Block</h2>
          <p className="mt-1 text-sm text-slate-500">Reusable employee signature for future ERP documents.</p>
        </div>
        {signature && <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">Configured</span>}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Info label="Employee Name" value={employeeName} />
            <Info label="Employee Code" value={signatureBlock?.employeeCode || employee.employee_code || "-"} />
            <Info label="Designation" value={signatureDesignation} />
            <Info label="Department" value={signatureDepartment} />
            <Info label="Company" value={signatureBlock?.company || "-"} />
            <Info label="Site" value={signatureBlock?.site || "-"} />
          </div>

          {canEdit && (
            <div className="space-y-4">
              <label className="block text-sm font-semibold text-slate-700">
                Signature Image
                <span className="mt-2 flex cursor-pointer flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50/70 p-4 transition hover:border-blue-300 hover:bg-blue-50 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
                  <span className="flex flex-wrap items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-blue-200 bg-white text-blue-700">
                      <ImageUp className="h-5 w-5" />
                    </span>
                    <span className="space-y-1">
                      <span className="inline-flex rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white">
                        Choose Signature Image
                      </span>
                      <span className="block text-xs font-medium text-slate-600">PNG, JPG or WebP · Max 2 MB</span>
                    </span>
                  </span>
                  <span className="truncate rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">
                    {selectedFile?.name || "No file selected"}
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) => selectFile(event.target.files?.[0] || null)}
                    className="sr-only"
                  />
                </span>
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={saveSignature} disabled={busy || !selectedFile} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {signature ? <RefreshCw className="h-4 w-4" /> : <ImageUp className="h-4 w-4" />}
                  {busy ? "Saving..." : signature ? "Replace Signature" : "Upload Signature"}
                </button>
                {signature && (
                  <button type="button" onClick={removeSignature} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-60">
                    <Trash2 className="h-4 w-4" />
                    Remove Signature
                  </button>
                )}
              </div>
            </div>
          )}

          {message && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{message}</p>}
          {signature && (
            <p className="text-xs text-slate-500">
              {signature.original_file_name || "Signature image"} · {signature.mime_type} · {formatFileSize(signature.size_bytes)}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Preview</p>
          <div className="mt-4 min-h-24 rounded-lg border border-dashed border-slate-300 bg-white p-3">
            {signatureUrl ? (
              <img src={signatureUrl} alt="Employee signature preview" className="max-h-24 max-w-full object-contain" />
            ) : (
              <div className="flex h-24 items-center justify-center text-sm text-slate-400">No signature uploaded</div>
            )}
          </div>
          <div className="mt-4 space-y-1 text-sm">
            <p className="font-semibold text-slate-950">{employeeName}</p>
            <p className="text-slate-600">{signatureDesignation}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}
