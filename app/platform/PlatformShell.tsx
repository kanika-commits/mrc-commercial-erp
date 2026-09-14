"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [["Overview", "/platform"], ["Organizations", "/platform/organizations"]] as const;

export default function PlatformShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <div className="min-h-screen bg-slate-50 text-slate-950"><header className="flex h-16 items-center justify-between border-b bg-white px-4 sm:px-8"><Link href="/platform" className="font-semibold tracking-tight">SiteQube <span className="font-normal text-slate-500">Platform</span></Link><span className="text-sm font-medium text-slate-600">Platform Owner</span></header><div className="mx-auto flex max-w-[1440px]"><aside className="hidden w-60 shrink-0 border-r bg-white p-5 md:block"><p className="mb-6 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Platform control plane</p><nav className="space-y-1">{links.map(([label, href]) => <Link key={label} href={href} className={`block rounded-lg px-3 py-2.5 text-sm font-medium ${pathname === href ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{label}</Link>)}</nav></aside><main className="min-w-0 flex-1 p-4 sm:p-8">{children}</main></div></div>;
}
