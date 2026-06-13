"use client";

import Link from "next/link";
import {
  BarChart3,
  Building2,
  FileText,
  Home,
  LayoutGrid,
  Settings,
} from "lucide-react";
import UserHeader from "@/components/UserHeader";

const sidebarItems = [
  { label: "Dashboard", href: "/", icon: Home },
  { label: "Modules", href: "/modules", icon: LayoutGrid },
  { label: "Master Setup", href: "/modules/master-setup", icon: Building2 },
  { label: "Contract Management", href: "/modules/contract-management", icon: FileText },
  { label: "Reports", href: "/modules/reports", icon: BarChart3 },
  { label: "Administration", href: "/modules/administration", icon: Settings },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="fixed left-0 top-0 z-40 flex h-screen w-56 flex-col bg-slate-950 px-4 py-5 text-white">
        <Link href="/" className="mb-6 block px-2">
          <h1 className="text-xl font-bold tracking-tight">ConstructIQ</h1>
          <p className="mt-1 text-[11px] leading-4 text-slate-400">
            Enterprise Construction Platform
          </p>
        </Link>

        <nav className="space-y-1">
          {sidebarItems.map((item, index) => {
            const Icon = item.icon;

            return (
              <div key={item.href}>
                {index === 2 && (
                  <div className="my-3 border-t border-slate-800" />
                )}

                <Link
                  href={item.href}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white"
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              </div>
            );
          })}
        </nav>

        <div className="mt-auto rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <p className="text-xs font-medium text-slate-300">MRC ERP</p>
          <p className="mt-1 text-[11px] text-slate-500">
            Commercial operations
          </p>
        </div>
      </aside>

      <main className="min-h-screen pl-56">
        <header className="sticky top-0 z-30 border-b bg-white/95 px-8 py-4 backdrop-blur">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">
              Enterprise Construction Platform
            </h2>
            <UserHeader />
          </div>
        </header>

        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}