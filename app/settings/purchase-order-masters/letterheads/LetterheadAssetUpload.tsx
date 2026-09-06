"use client";

import { useEffect, useRef, useState } from "react";

type Props = { label: "Header" | "Footer"; value?: File; onChange: (file?: File) => void };

export default function LetterheadAssetUpload({ label, value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { if (!value) { setPreview(null); return; } const url = URL.createObjectURL(value); setPreview(url); return () => URL.revokeObjectURL(url); }, [value]);
  function accept(file?: File) { if (!file) return; if (file.type !== "image/png") { setError(`${label} must be a PNG image.`); return; } setError(""); onChange(file); }
  function paste(event: React.ClipboardEvent) { const item = Array.from(event.clipboardData.items).find((entry) => entry.type.startsWith("image/")); if (!item) return; event.preventDefault(); accept(item.getAsFile() || undefined); }
  return <div><p className="text-sm font-semibold">{label} PNG</p><div tabIndex={0} role="button" aria-label={`Upload ${label} PNG`} onPaste={paste} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); accept(event.dataTransfer.files[0]); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }} className={`mt-1 rounded-lg border-2 border-dashed p-4 outline-none transition ${dragging ? "border-slate-950 bg-slate-100" : "border-slate-300 bg-slate-50"}`}><p className="text-sm text-slate-600">Drop {label} PNG here or paste image with Cmd+V / Ctrl+V</p><button type="button" onClick={() => inputRef.current?.click()} className="mt-2 rounded border bg-white px-3 py-1.5 text-sm font-semibold">{value ? "Replace" : "Choose PNG"}</button><input ref={inputRef} type="file" accept="image/png" className="sr-only" onChange={(event) => accept(event.target.files?.[0])} />{preview && <div className="mt-3 flex items-center gap-3"><img src={preview} alt={`${label} preview`} className="max-h-24 max-w-full object-contain" /><button type="button" className="text-sm font-semibold text-red-700" onClick={() => { onChange(undefined); setError(""); }}>Remove</button></div>}</div>{error && <p className="mt-1 text-sm text-red-700">{error}</p>}</div>;
}
