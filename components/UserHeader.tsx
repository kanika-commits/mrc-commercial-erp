"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, KeyRound } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAccessContext } from "@/components/AccessContext";
import { logoutSessionActivity } from "@/lib/sessionActivityClient";

export default function UserHeader() {
  const { user: contextUser } = useAccessContext();
  const [label, setLabel] = useState("Loading user...");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function closeOnOutsideClick(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [menuOpen]);

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
    await logoutSessionActivity().catch(() => null);
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div ref={menuRef} className="relative flex items-center gap-2 text-sm text-gray-500">
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        className="inline-flex max-w-[min(48vw,240px)] items-center gap-1 rounded-lg px-2 py-2 text-gray-700 transition hover:bg-gray-100"
        aria-label="Open account menu"
        aria-expanded={menuOpen}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0" />
      </button>

      {menuOpen && (
        <div className="fixed right-4 top-16 z-[100] w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
          <Link
            href="/settings/password"
            onClick={() => setMenuOpen(false)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <KeyRound className="h-4 w-4" />
            Change Password
          </Link>
          <button
            type="button"
            onClick={logout}
            className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Logout
          </button>
        </div>
      )}
    </div>
  );
}
