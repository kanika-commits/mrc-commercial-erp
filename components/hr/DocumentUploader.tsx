"use client";

import { useState } from "react";

type Props = {
  uploading: boolean;
  onUpload: (files: FileList, documentType: string, options?: { allowDuplicateVersion?: boolean }) => void;
  title?: string;
  description?: string;
  defaultDocumentType?: string;
  documentTypeOptions?: { value: string; label: string }[];
  enableDuplicateVersionControl?: boolean;
  employeeMasterLayout?: boolean;
};

const defaultOptions = [
  { value: "supporting_document", label: "Supporting Document" },
  { value: "bill", label: "Bill" },
  { value: "receipt", label: "Receipt" },
  { value: "approval", label: "Approval" },
];

export default function DocumentUploader({
  uploading,
  onUpload,
  title = "Attachments",
  description = "Upload reimbursement supporting documents.",
  defaultDocumentType = "supporting_document",
  documentTypeOptions = defaultOptions,
  enableDuplicateVersionControl = false,
  employeeMasterLayout = false,
}: Props) {
  const [documentType, setDocumentType] = useState(defaultDocumentType);
  const [files, setFiles] = useState<FileList | null>(null);
  const [allowDuplicateVersion, setAllowDuplicateVersion] = useState(false);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
        <p className="mt-1 text-sm text-slate-500">
          {description}
        </p>
      </div>
      <div className={`mt-4 grid gap-4 ${employeeMasterLayout ? "xl:grid-cols-1" : "md:grid-cols-[220px_1fr_auto]"}`}>
        <label className="block">
          {employeeMasterLayout && (
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Document Category
            </span>
          )}
        <select
          value={documentType}
          onChange={(event) => setDocumentType(event.target.value)}
          className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
        >
          {documentTypeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        </label>
        <label className="block">
          {employeeMasterLayout && (
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              File
            </span>
          )}
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={(event) => setFiles(event.target.files)}
          className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold"
        />
        </label>
        <button
          type="button"
          disabled={uploading || !files?.length}
          onClick={() => files && onUpload(files, documentType, { allowDuplicateVersion })}
          className="h-11 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {uploading ? "Uploading..." : "Upload"}
        </button>
      </div>
      {enableDuplicateVersionControl && (
        <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-600">
          <input
            type="checkbox"
            checked={allowDuplicateVersion}
            onChange={(event) => setAllowDuplicateVersion(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Upload as another version if the category and filename already exist
        </label>
      )}
      <p className="mt-2 text-xs text-slate-500">
        JPEG, PNG, WEBP and PDF only. Maximum 10MB per file.
      </p>
    </div>
  );
}
