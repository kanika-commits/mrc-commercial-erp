"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAccessContext } from "@/components/AccessContext";

export default function UserHeader() {
  const { user: contextUser } = useAccessContext();
  const [label, setLabel] = useState("Loading user...");

  useEffect(() => {
    if (contextUser) {
      setLabel(
        contextUser.user_metadata?.full_name ||
          contextUser.user_metadata?.name ||
          contextUser.email ||
          "Logged in"
      );
      return;
    }

    async function loadUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setLabel("Not logged in");
        return;
      }

      setLabel(
        user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          user.email ||
          "Logged in"
      );
    }

    loadUser();
  }, [contextUser]);

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div className="flex items-center gap-4 text-sm text-gray-500">
      <span>{label}</span>

      <button
        type="button"
        onClick={logout}
        className="rounded border px-3 py-1 text-gray-700 hover:bg-gray-50"
      >
        Logout
      </button>
    </div>
  );
}
