"use client";

import { useMemo, useState } from "react";
import { formatDate } from "./hrClient";

type GalleryDocument = {
  id: string;
  employee_id?: string | null;
  reimbursement_claim_id?: string | null;
  document_type?: string | null;
  file_name?: string | null;
  document_name?: string | null;
  uploaded_at?: string | null;
  uploaded_by_name?: string | null;
  uploaded_by_email?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  signed_url?: string | null;
};

type Props = {
  documents: GalleryDocument[];
  canDelete?: boolean;
  onDelete?: (document: never) => void;
  title?: string;
  description?: string;
  emptyMessage?: string;
  documentTypeOptions?: { value: string; label: string }[];
  enableSearchAndFilter?: boolean;
  showMetadata?: boolean;
};

function formatFileSize(size?: number | null) {
  if (!size) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentGallery<TDocument extends GalleryDocument>({
  documents,
  canDelete = false,
  onDelete,
  title = "Uploaded Attachments",
  description = "Supporting files saved with this reimbursement claim.",
  emptyMessage = "No documents uploaded.",
  documentTypeOptions = [],
  enableSearchAndFilter = false,
  showMetadata = false,
}: Omit<Props, "documents" | "onDelete"> & {
  documents: TDocument[];
  onDelete?: (document: TDocument) => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const categoryLabelMap = useMemo(
    () => new Map(documentTypeOptions.map((option) => [option.value, option.label])),
    [documentTypeOptions],
  );
  const filteredDocuments = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return documents.filter((document) => {
      const documentType = document.document_type || "";
      const fileName = document.file_name || document.document_name || "";
      const uploadedBy = document.uploaded_by_name || document.uploaded_by_email || "";
      const matchesCategory = !category || documentType === category;
      const matchesSearch =
        !normalizedSearch ||
        [documentType, fileName, uploadedBy]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch);

      return matchesCategory && matchesSearch;
    });
  }, [category, documents, search]);
  const columnCount = showMetadata ? 7 : 5;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b px-5 py-4">
        <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
        <p className="mt-1 text-sm text-slate-500">
          {description}
        </p>
        {enableSearchAndFilter && (
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_220px]">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search documents"
              className="h-10 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400"
            />
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="h-10 w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400"
            >
              <option value="">All categories</option>
              {documentTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-[700px] w-full text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-16 px-4 py-3">S. No.</th>
              <th className="px-4 py-3">Document Category</th>
              <th className="px-4 py-3">File Name</th>
              <th className="px-4 py-3">Uploaded At</th>
              {showMetadata && <th className="px-4 py-3">Uploaded By</th>}
              {showMetadata && <th className="px-4 py-3">Size</th>}
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filteredDocuments.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="px-4 py-8 text-center text-slate-500">
                  {documents.length === 0 ? emptyMessage : "No documents match the current search or category."}
                </td>
              </tr>
            ) : (
              filteredDocuments.map((document, index) => (
                <tr key={document.id}>
                  <td className="px-4 py-3 text-slate-500">{index + 1}</td>
                  <td className="px-4 py-3">
                    {showMetadata ? (
                      <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                        {categoryLabelMap.get(document.document_type || "") || document.document_type || "-"}
                      </span>
                    ) : (
                      document.document_type || "-"
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">{document.file_name || document.document_name || "Document"}</td>
                  <td className="px-4 py-3">{formatDate(document.uploaded_at)}</td>
                  {showMetadata && <td className="px-4 py-3">{document.uploaded_by_name || document.uploaded_by_email || "-"}</td>}
                  {showMetadata && <td className="px-4 py-3">{formatFileSize(document.file_size)}</td>}
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {document.signed_url ? (
                        <a
                          href={document.signed_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-slate-50"
                        >
                          Open
                        </a>
                      ) : (
                        <span className="text-xs text-red-600">Unavailable</span>
                      )}
                      {canDelete && onDelete && (
                        <button
                          type="button"
                          onClick={() => onDelete(document)}
                          className="rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-slate-200 md:hidden">
        {filteredDocuments.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">
            {documents.length === 0 ? emptyMessage : "No documents match the current search or category."}
          </div>
        ) : (
          filteredDocuments.map((document, index) => (
            <article key={document.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Document {index + 1}</p>
                  <h4 className="mt-1 text-sm font-semibold text-slate-950">
                    {document.file_name || document.document_name || "Document"}
                  </h4>
                </div>
                <span className="inline-flex shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                  {categoryLabelMap.get(document.document_type || "") || document.document_type || "-"}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <MobileMeta label="Uploaded" value={formatDate(document.uploaded_at)} />
                <MobileMeta label="Size" value={formatFileSize(document.file_size)} />
                {showMetadata && (
                  <MobileMeta
                    label="Uploaded By"
                    value={document.uploaded_by_name || document.uploaded_by_email || "-"}
                  />
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {document.signed_url ? (
                  <a
                    href={document.signed_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-slate-50"
                  >
                    Open
                  </a>
                ) : (
                  <span className="text-xs text-red-600">Unavailable</span>
                )}
                {canDelete && onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(document)}
                    className="rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function MobileMeta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 font-semibold text-slate-900">{value}</div>
    </div>
  );
}
