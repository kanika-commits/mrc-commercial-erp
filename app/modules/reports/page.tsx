"use client";

import Link from "next/link";
import { ArrowLeft, BarChart3 } from "lucide-react";

export default function ReportsCompatibilityPage() {
  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-[#1b1b1d] md:px-10">
      <div className="mx-auto max-w-[900px] space-y-6">
        <Link
          href="/modules"
          className="inline-flex items-center gap-2 text-sm font-semibold text-[#00658b] transition hover:text-[#004b68]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Modules
        </Link>

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
            <BarChart3 className="h-5 w-5" />
          </div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Compatibility
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-black">
            Reports
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Reports access is preserved for production compatibility. The Release 1 reports workspace is not enabled yet.
          </p>
        </div>
      </div>
    </section>
  );
}
