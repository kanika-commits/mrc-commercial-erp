"use client";

import type { ReimbursementDocument } from "@/types/hr";
import { formatDate } from "./hrClient";

type Props = {
  documents: ReimbursementDocument[];
  canDelete?: boolean;
  onDelete?: (document: ReimbursementDocument) => void;
};

export default function DocumentGallery({ documents, canDelete = false, onDelete }: Props) {
  return (
    <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
      <table className="min-w-[700px] w-full text-left text-sm">
        <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Document Type</th>
            <th className="px-4 py-3">File Name</th>
            <th className="px-4 py-3">Uploaded At</th>
            <th className="px-4 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {documents.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                No documents uploaded.
              </td>
            </tr>
          ) : (
            documents.map((document) => (
              <tr key={document.id}>
                <td className="px-4 py-3">{document.document_type || "-"}</td>
                <td className="px-4 py-3 font-medium text-slate-900">{document.file_name || "Document"}</td>
                <td className="px-4 py-3">{formatDate(document.uploaded_at)}</td>
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
  );
}
