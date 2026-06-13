"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function UserHeader() {
  const [label, setLabel] = useState("Loading user...");

  useEffect(() => {
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
  }, []);

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