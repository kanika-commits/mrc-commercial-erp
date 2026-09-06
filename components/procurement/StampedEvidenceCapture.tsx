"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, RotateCcw } from "lucide-react";

export default function StampedEvidenceCapture({ disabled, onCapture }: { disabled: boolean; onCapture: (file: File) => void }) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => () => stopCamera(), []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function openCamera() {
    if (disabled) return;
    setMessage("");
    setPreview(null);
    setFile(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage("Camera is unavailable here. Use Upload or choose a photo from your device.");
      fallbackRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      setCameraOpen(true);
      window.setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      }, 0);
    } catch {
      setMessage("Camera permission was not available. Use Upload or choose a photo from your device.");
      fallbackRef.current?.click();
    }
  }

  async function stampImage(source: CanvasImageSource, width: number, height: number, name = "receipt-evidence.jpg") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(source, 0, 0, width, height);
    const stamp = new Date().toISOString().replace(/[TZ]/g, " ").trim();
    context.fillStyle = "rgba(0,0,0,.65)";
    context.fillRect(0, height - 42, width, 42);
    context.fillStyle = "white";
    context.font = `${Math.max(14, Math.round(width / 60))}px sans-serif`;
    context.fillText(`Captured ${stamp}`, 14, height - 15);
    return new Promise<File | null>((resolve) => canvas.toBlob((blob) => resolve(blob ? new File([blob], name, { type: "image/jpeg" }) : null), "image/jpeg", 0.92));
  }

  async function captureFrame() {
    const video = videoRef.current;
    if (!video) return;
    const nextFile = await stampImage(video, video.videoWidth || 1280, video.videoHeight || 720);
    if (!nextFile) return;
    setFile(nextFile);
    setPreview(URL.createObjectURL(nextFile));
    stopCamera();
  }

  function usePhoto() {
    if (!file) return;
    onCapture(file);
    clearPreview();
    setCameraOpen(false);
  }

  function clearPreview() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setFile(null);
  }

  function closeCamera() {
    stopCamera();
    clearPreview();
    setCameraOpen(false);
  }

  function fallbackCapture(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!selected) return;
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = async () => {
        const nextFile = await stampImage(image, image.width, image.height, selected.name);
        onCapture(nextFile || selected);
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(selected);
  }

  return <div className="inline-flex flex-col gap-2">
    <button type="button" disabled={disabled} onClick={() => void openCamera()} className="inline-flex items-center gap-2 rounded border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"><Camera className="h-4 w-4" />Take Photo</button>
    <input ref={fallbackRef} disabled={disabled} type="file" accept="image/*" capture="environment" className="sr-only" onChange={fallbackCapture} />
    {message && <p className="max-w-sm text-xs text-amber-700">{message}</p>}
    {cameraOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white p-4 shadow-xl">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Take Photo</h3><button type="button" onClick={closeCamera} className="rounded border px-3 py-1 text-sm">Close</button></div>
        {preview ? <img src={preview} alt="Captured evidence preview" className="mt-4 max-h-[65vh] w-full rounded-lg object-contain bg-slate-100" /> : <video ref={videoRef} autoPlay playsInline muted className="mt-4 max-h-[65vh] w-full rounded-lg bg-slate-900" />}
        <div className="mt-4 flex flex-wrap gap-2">{preview ? <><button type="button" onClick={usePhoto} className="rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Use Photo</button><button type="button" onClick={() => { clearPreview(); void openCamera(); }} className="inline-flex items-center gap-2 rounded border px-4 py-2 text-sm font-semibold"><RotateCcw className="h-4 w-4" />Retake</button></> : <button type="button" onClick={() => void captureFrame()} className="inline-flex items-center gap-2 rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"><Camera className="h-4 w-4" />Capture Photo</button>}<button type="button" onClick={() => fallbackRef.current?.click()} className="inline-flex items-center gap-2 rounded border px-4 py-2 text-sm font-semibold"><RefreshCw className="h-4 w-4" />Choose Photo</button></div>
      </div>
    </div>}
  </div>;
}
