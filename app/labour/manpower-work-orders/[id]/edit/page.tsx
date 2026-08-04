"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

export default function EditManpowerWorkOrderPage() {
  const params = useParams<{ id: string }>();
  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-slate-950 md:px-10">
      <div className="mx-auto max-w-[900px] rounded-lg border bg-white p-6 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Manpower Work Order</p>
        <h1 className="text-2xl font-semibold">Draft Edit</h1>
        <p className="mt-2 text-sm text-slate-600">Draft corrections are handled on the detail page through status and category-rate controls. Approved Manpower Work Orders are changed through effective-dated revisions.</p>
        <Link href={`/labour/manpower-work-orders/${params.id}`} className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Back to Detail</Link>
      </div>
    </section>
  );
}
