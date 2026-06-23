"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AlertMessage from "@/components/AlertMessage";
import { supabase } from "@/lib/supabase";

type DeleteCompanyButtonProps = {
  companyId: string;
  companyName: string;
  onDeleted?: () => void;
  redirectTo?: string;
  className?: string;
};

export default function DeleteCompanyButton({
  companyId,
  companyName,
  onDeleted,
  redirectTo,
  className,
}: DeleteCompanyButtonProps) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function deleteCompany() {
    const reason = window.prompt(
      `Delete company "${companyName}"? Enter a reason or type DELETE to confirm.`
    );

    if (!reason) return;

    try {
      setDeleting(true);
      setError("");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setError("You must be logged in to delete a company.");
        return;
      }

      const response = await fetch(`/api/companies/${companyId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          deletion_reason: reason,
          confirmation_text: reason,
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || "Failed to delete company.");
      }

      onDeleted?.();

      if (redirectTo) {
        router.push(redirectTo);
        router.refresh();
      }
    } catch (deleteError: any) {
      setError(deleteError.message || "Failed to delete company.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-2">
      <AlertMessage
        type="error"
        message={error}
        onClose={() => setError("")}
        scrollIntoView={false}
      />
      <button
        type="button"
        onClick={deleteCompany}
        disabled={deleting}
        className={
          className ||
          "rounded border border-red-200 px-3 py-1 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {deleting ? "Deleting..." : "Delete"}
      </button>
    </div>
  );
}
