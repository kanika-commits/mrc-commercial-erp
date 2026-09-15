"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function InvitationAcceptPage() {
  const params = useSearchParams();
  const invitationId = params.get("invitationId") || "";
  const [state, setState] = useState<"loading" | "ready" | "success" | "error">("loading");
  const [message, setMessage] = useState("");
  const [redirectUrl, setRedirectUrl] = useState("");

  useEffect(() => {
    void accept();
    async function accept() {
      if (!invitationId) { setState("error"); setMessage("This invitation link is incomplete."); return; }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { setState("ready"); return; }
      const response = await fetch("/api/managed-tenant/invitations/accept", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ invitationId }) });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) { setState("error"); setMessage(value.error || "Unable to accept this invitation."); return; }
      if (typeof value.redirectUrl !== "string" || !value.redirectUrl) { setState("error"); setMessage("The invited organization destination could not be resolved."); return; }
      setRedirectUrl(value.redirectUrl);
      setState("success");
    }
  }, [invitationId]);

  if (state === "loading") return <main className="mx-auto max-w-lg p-8"><p>Checking invitation...</p></main>;
  if (state === "ready") return <main className="mx-auto max-w-lg space-y-4 p-8"><h1 className="text-2xl font-semibold">Administrator invitation</h1><p>Sign in with the invited email address to continue.</p><Link href={`/login?next=${encodeURIComponent(`/invitations/accept?invitationId=${invitationId}`)}`} className="inline-block rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Sign in</Link></main>;
  if (state === "success") return <main className="mx-auto max-w-lg space-y-4 p-8"><h1 className="text-2xl font-semibold">Invitation accepted</h1><p>Your Tenant Administrator access is ready.</p><Link href={redirectUrl} className="inline-block rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Continue to workspace</Link></main>;
  return <main className="mx-auto max-w-lg space-y-4 p-8"><h1 className="text-2xl font-semibold">Invitation unavailable</h1><p role="alert">{message}</p></main>;
}
