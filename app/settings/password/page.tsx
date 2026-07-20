"use client";

import { useState } from "react";
import Link from "next/link";
import AlertMessage from "@/components/AlertMessage";
import { supabase } from "@/lib/supabase";

export default function PasswordSettingsPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("error");

  async function changePassword() {
    try {
      setSaving(true);
      setMessage("");
      setMessageType("error");

      if (!currentPassword || !newPassword || !confirmPassword) {
        setMessage("Current password, new password and confirmation are required.");
        return;
      }

      if (newPassword.length < 8) {
        setMessage("New password must be at least 8 characters.");
        return;
      }

      if (newPassword !== confirmPassword) {
        setMessage("New password and confirm password do not match.");
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const email = user?.email;

      if (!email) {
        setMessage("Your session expired. Please log in again.");
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      });

      if (signInError) {
        setMessage("Current password is incorrect.");
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) throw updateError;

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessageType("success");
      setMessage("Password changed successfully.");
    } catch (error: any) {
      setMessage(error.message || "Failed to change password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">Settings</h1>
          <p className="text-slate-500">Change your login password.</p>
        </div>

        <Link href="/" className="rounded-lg border px-4 py-2 text-sm font-semibold">
          Back
        </Link>
      </div>

      <AlertMessage
        type={messageType}
        message={message}
        onClose={() => setMessage("")}
      />

      <section className="rounded-lg border bg-white p-6">
        <h2 className="text-xl font-semibold text-slate-950">Change Password</h2>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">
              Current Password
            </span>
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2"
              autoComplete="current-password"
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-slate-700">
              New Password
            </span>
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2"
              autoComplete="new-password"
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-slate-700">
              Confirm Password
            </span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2"
              autoComplete="new-password"
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={changePassword}
            disabled={saving}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? "Updating..." : "Update Password"}
          </button>
        </div>
      </section>
    </div>
  );
}
