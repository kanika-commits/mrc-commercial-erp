import Link from "next/link";

export default function PilotFormsPage() {
  return (
    <main className="p-8">
      <p className="text-sm text-slate-500">Forms</p>
      <h1 className="mt-2 text-3xl font-semibold">Forms (Pilot)</h1>
      <p className="mt-2 text-slate-600">Pilot-only Work Order workflows.</p>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Link className="rounded border bg-white p-6 shadow-sm" href="/work-orders/new/structured">
          <h2 className="font-semibold">Pilot Work Orders</h2>
          <p className="mt-2 text-sm text-slate-600">Create structured Pilot Work Orders and revisions.</p>
        </Link>
      </div>
    </main>
  );
}
