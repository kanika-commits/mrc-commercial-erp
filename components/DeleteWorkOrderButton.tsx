"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getCurrentUserAccess, can } from "@/lib/accessControl";

export default function DeleteWorkOrderButton({ id }: { id: string }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function checkAccess() {
      const access = await getCurrentUserAccess();
      setAllowed(can(access.permissions, "work_orders", "delete"));
    }

    checkAccess();
  }, []);

  async function handleDelete() {
    const ok = window.confirm(
      "Delete this Work Order? It will be removed from the active register."
    );

    if (!ok) return;

    setDeleting(true);

    const { error } = await supabase
      .from("work_orders")
      .update({ status: "deleted" })
      .eq("id", id);

    setDeleting(false);

    if (error) {
      alert(error.message);
      return;
    }

    router.refresh();
  }

  if (!allowed) return null;

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
      title="Delete Work Order"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}