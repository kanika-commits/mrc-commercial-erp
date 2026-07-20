"use client";

import { useState } from "react";

type Props = {
  uploading: boolean;
  onUpload: (files: FileList, documentType: string) => void;
};

export default function DocumentUploader({ uploading, onUpload }: Props) {
  const [documentType, setDocumentType] = useState("supporting_document");
  const [files, setFiles] = useState<FileList | null>(null);

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div>
        <h3 className="text-lg font-semibold text-slate-950">Attachments</h3>
        <p className="mt-1 text-sm text-slate-500">
          Upload reimbursement supporting documents.
        </p>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-[220px_1fr_auto]">
        <select
          value={documentType}
          onChange={(event) => setDocumentType(event.target.value)}
          className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400"
        >
          <option value="supporting_document">Supporting Document</option>
          <option value="bill">Bill</option>
          <option value="receipt">Receipt</option>
          <option value="approval">Approval</option>
        </select>
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={(event) => setFiles(event.target.files)}
          className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold"
        />
        <button
          type="button"
          disabled={uploading || !files?.length}
          onClick={() => files && onUpload(files, documentType)}
          className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {uploading ? "Uploading..." : "Upload"}
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        JPEG, PNG, WEBP and PDF only. Maximum 10MB per file.
      </p>
    </div>
  );
}
