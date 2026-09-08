"use client";

import { Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ACCOUNT_INACTIVE_CODE, INACTIVE_ACCOUNT_MESSAGE } from "@/lib/accountStatus";
import { startSessionActivity } from "@/lib/sessionActivityClient";
import { defaultTenantBranding, resolveTenantBranding, type TenantBranding } from "@/lib/tenantBranding";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "SQ";
}

function readableTextColor(background: string | null | undefined) {
  const hex = String(background || "").trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return "#ffffff";
  const [red, green, blue] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const luminance = [red, green, blue].map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  return luminance > 0.55 ? "#0f172a" : "#ffffff";
}

type BrandingStatus = "loading" | "ready" | "fallback";

export default function LoginPage() {
  const router = useRouter();
  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [branding, setBranding] = useState<TenantBranding>(defaultTenantBranding);
  const [brandingStatus, setBrandingStatus] = useState<BrandingStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    async function loadBranding() {
      try {
        const response = await fetch("/api/branding", { credentials: "same-origin" });
        if (!response.ok) throw new Error("Branding unavailable");
        const value = resolveTenantBranding(await response.json());
        if (value.logoUrl) {
          await new Promise<void>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve();
            image.onerror = () => reject(new Error("Logo unavailable"));
            image.src = value.logoUrl!;
          });
        }
        if (!cancelled) { setBranding(value); setBrandingStatus("ready"); }
      } catch {
        if (!cancelled) { setBranding(resolveTenantBranding(defaultTenantBranding)); setBrandingStatus("fallback"); }
      }
    }
    loadBranding();
    const params = new URLSearchParams(window.location.search);
    const storedNotice = window.sessionStorage.getItem("auth_notice");
    if (params.get("account") === ACCOUNT_INACTIVE_CODE || storedNotice === INACTIVE_ACCOUNT_MESSAGE) {
      setMessage(INACTIVE_ACCOUNT_MESSAGE);
      window.sessionStorage.removeItem("auth_notice");
    }
    const clearInitialAutofill = () => {
      setEmail(""); setPassword("");
      if (emailInputRef.current) emailInputRef.current.value = "";
      if (passwordInputRef.current) passwordInputRef.current.value = "";
    };
    clearInitialAutofill();
    const timeout = window.setTimeout(clearInitialAutofill, 100);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault(); setMessage("");
    if (!email.trim()) { setMessage("Email is required."); return; }
    if (!password) { setMessage("Password is required."); return; }
    try {
      setLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      const token = data.session?.access_token;
      if (!token) throw new Error("Login session could not be created.");
      const accessResponse = await fetch("/api/admin/bootstrap", { headers: { Authorization: `Bearer ${token}` } });
      const accessResult = await accessResponse.json().catch(() => null);
      if (!accessResponse.ok) { await supabase.auth.signOut(); throw new Error(accessResult?.error || INACTIVE_ACCOUNT_MESSAGE); }
      await startSessionActivity().catch(() => null);
      router.push("/");
    } catch (error: any) { setMessage(error.message || "Login failed."); }
    finally { setLoading(false); }
  }

  if (brandingStatus === "loading") {
    return <main className="flex min-h-screen items-center justify-center bg-slate-100" aria-busy="true"><div className="w-full max-w-md space-y-4 px-6"><div className="mx-auto h-20 w-48 animate-pulse rounded-xl bg-slate-200" /><div className="h-12 animate-pulse rounded-lg bg-slate-200" /><div className="h-12 animate-pulse rounded-lg bg-slate-200" /><div className="h-12 animate-pulse rounded-lg bg-slate-200" /></div></main>;
  }

  const resolvedPrimaryColor = branding.primaryColor || defaultTenantBranding.primaryColor!;

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950" style={{ "--tenant-primary": branding.primaryColor, "--tenant-secondary": branding.secondaryColor } as React.CSSProperties}>
      <div className="mx-auto flex min-h-screen max-w-[1480px] flex-col bg-white shadow-2xl lg:flex-row">
        <section className="relative flex min-h-[360px] w-full flex-col justify-between overflow-hidden bg-[var(--tenant-secondary)] p-8 text-white sm:p-12 lg:min-h-screen lg:w-[46%] lg:p-16">
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full border-[40px] border-white/5" aria-hidden="true" />
          <div className="relative z-10">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white/80">SiteQube workspace</p>
          </div>
          <div className="relative z-10 mt-12 max-w-lg">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-200">Powered by SiteQube</p>
            <h1 className="mt-5 text-3xl font-semibold leading-tight sm:text-5xl">{branding.loginTagline}</h1>
            <p className="mt-6 max-w-md text-sm leading-6 text-slate-200">A focused workspace for the teams that keep every site moving.</p>
          </div>
          <div className="relative z-10 mt-12 flex items-center gap-3 text-xs text-slate-300"><ShieldCheck className="h-4 w-4 text-sky-300" /> Secure workspace access</div>
        </section>
        <section className="flex w-full items-center justify-center px-6 py-12 sm:px-12 lg:w-[54%] lg:px-20">
          <form onSubmit={handleLogin} className="w-full max-w-md space-y-6">
            <div>{branding.logoUrl ? <img src={branding.logoUrl} alt={`${branding.organizationName} logo`} className="mb-5 max-h-20 max-w-[220px] object-contain object-left sm:max-h-24" /> : <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-lg bg-[var(--tenant-primary)] text-lg font-bold tracking-wider">{initials(branding.organizationName)}</span>}<p className="text-sm font-bold uppercase tracking-[0.22em] text-[var(--tenant-primary)]">SiteQube</p><p className="mt-2 text-sm font-semibold text-slate-600">{branding.organizationName}</p><h2 className="mt-4 text-3xl font-semibold tracking-tight">Welcome back</h2><p className="mt-2 text-sm text-slate-500">Sign in to continue to your workspace.</p></div>
            {message && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{message}</div>}
            <div className="space-y-2"><label htmlFor="login-email" className="text-sm font-semibold text-slate-700">Email</label><input id="login-email" ref={emailInputRef} type="email" name="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 w-full rounded-lg border border-slate-300 px-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-[var(--tenant-primary)] focus:ring-4 focus:ring-[var(--tenant-primary)]/10" placeholder="you@company.com" /></div>
            <div className="space-y-2"><label htmlFor="login-password" className="text-sm font-semibold text-slate-700">Password</label><div className="relative"><input id="login-password" ref={passwordInputRef} type={showPassword ? "text" : "password"} name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 w-full rounded-lg border border-slate-300 px-4 pr-12 text-sm outline-none transition focus:border-[var(--tenant-primary)] focus:ring-4 focus:ring-[var(--tenant-primary)]/10" /><button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-2 text-slate-500 hover:bg-slate-100" aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></div>
            <button type="submit" disabled={loading} style={{ backgroundColor: resolvedPrimaryColor, color: readableTextColor(resolvedPrimaryColor) }} className="flex h-12 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"><LockKeyhole className="h-4 w-4" />{loading ? "Signing in..." : "Sign in"}</button>
            <p className="text-center text-xs text-slate-400">Powered by SiteQube</p>
          </form>
        </section>
      </div>
    </main>
  );
}
