"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  Building2,
  FileText,
  Home,
  LayoutGrid,
  RefreshCcw,
  Search,
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
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[#f3f6f8]">
      <aside className="fixed left-0 top-0 z-40 flex h-screen w-[268px] flex-col bg-black px-4 py-8 text-white">
        <Link href="/" className="mb-8 block px-2">
          <h1 className="text-3xl font-bold tracking-tight">ConstructIQ</h1>
          <p className="mt-2 text-sm font-medium text-white/50">
            Enterprise ERP
          </p>
        </Link>

        <nav className="space-y-2">
          {sidebarItems.map((item, index) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            return (
              <div key={item.href}>
                {index === 2 && (
                  <div className="my-5 border-t border-white/10" />
                )}

                <Link
                  href={item.href}
                  className={`flex h-13 items-center gap-4 rounded-md px-5 text-sm font-bold transition ${
                    active
                      ? "bg-[#7bc8ef] text-[#07516c]"
                      : "text-white/60 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              </div>
            );
          })}
        </nav>

        <div className="mt-auto space-y-2 border-t border-white/10 pt-7">
          <Link
            href="/modules/administration"
            className="flex h-12 items-center gap-4 rounded-md px-5 text-sm font-bold text-white/55 transition hover:bg-white/10 hover:text-white"
          >
            <Settings className="h-5 w-5" />
            Settings
          </Link>
          <div className="flex h-12 items-center gap-4 rounded-md px-5 text-sm font-bold text-white/55">
            <span className="grid h-5 w-5 place-items-center rounded-full border border-white/55 text-xs">
              ?
            </span>
            Support
          </div>
        </div>
      </aside>

      <main className="min-h-screen pl-[268px]">
        <header className="sticky top-0 z-30 border-b border-[#d7dde3] bg-[#fbf9fa] px-10 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                className="h-11 w-full rounded-xl border-0 bg-white px-11 text-sm font-semibold text-slate-700 shadow-sm outline-none ring-1 ring-black/5 placeholder:text-slate-500 focus:ring-[#04779e]"
                placeholder="Search projects..."
              />
            </div>

            <div className="flex items-center gap-7 text-sm font-bold text-slate-700">
              <Link href="/modules/master-setup">Directory</Link>
              <Link href="/modules/reports">Reports</Link>
              <Link href="/approvals">Archives</Link>
            </div>

            <div className="flex items-center gap-5">
              <Bell className="h-5 w-5 text-slate-700" />
              <RefreshCcw className="h-5 w-5 text-slate-700" />
              <div className="hidden h-8 w-px bg-slate-300 md:block" />
              <UserHeader />
            </div>
          </div>
        </header>

        <div>{children}</div>
      </main>
    </div>
  );
}
