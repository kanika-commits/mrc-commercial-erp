"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    if (!email.trim()) {
      setMessage("Email is required.");
      return;
    }

    if (!password) {
      setMessage("Password is required.");
      return;
    }

    try {
      setLoading(true);

      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) throw error;

      const user = data.user;

      if (user) {
        await supabase.from("profiles").upsert({
          id: user.id,
          email: user.email || email.trim(),
          full_name:
            user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            user.email ||
            email.trim(),
          status: "active",
        });
      }

      router.push("/");
    } catch (error: any) {
      setMessage(error.message || "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <form
        onSubmit={handleLogin}
        className="w-full max-w-md space-y-5 rounded-lg border bg-white p-8 shadow-sm"
      >
        <div>
          <h1 className="text-2xl font-bold">MRC Commercial ERP</h1>
          <p className="mt-1 text-sm text-gray-500">
            Login with your employee email and password.
          </p>
        </div>

        {message && (
          <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {message}
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border px-3 py-2"
            placeholder="employee@mrcgroup.in"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border px-3 py-2"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-60"
        >
          {loading ? "Logging in..." : "Login"}
        </button>
      </form>
    </div>
  );
}