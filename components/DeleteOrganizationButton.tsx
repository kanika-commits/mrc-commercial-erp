"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AlertMessage from "@/components/AlertMessage";
import { supabase } from "@/lib/supabase";

type DeleteOrganizationButtonProps = {
  organizationId: string;
  organizationName: string;
  onDeleted?: () => void;
  redirectTo?: string;
};

export default function DeleteOrganizationButton({
  organizationId,
  organizationName,
  onDeleted,
  redirectTo,
}: DeleteOrganizationButtonProps) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function deleteOrganization() {
    const reason = window.prompt(
      `Delete organization "${organizationName}"? Enter a reason or type DELETE to confirm.`
    );

    if (!reason) return;

    try {
      setDeleting(true);
      setError("");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setError("You must be logged in to delete an organization.");
        return;
      }

      const response = await fetch(`/api/admin/organizations/${organizationId}`, {
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
        throw new Error(result.error || "Failed to delete organization.");
      }

      onDeleted?.();

      if (redirectTo) {
        router.push(redirectTo);
        router.refresh();
      }
    } catch (deleteError: any) {
      setError(deleteError.message || "Failed to delete organization.");
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
        onClick={deleteOrganization}
        disabled={deleting}
        className="rounded border border-red-200 px-3 py-1 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {deleting ? "Deleting..." : "Delete"}
      </button>
    </div>
  );
}
