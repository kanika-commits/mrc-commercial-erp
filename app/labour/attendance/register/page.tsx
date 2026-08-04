"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LabourAttendanceRegisterPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/labour/approvals?view=monthly");
  }, [router]);

  return (
    <main className="min-h-screen bg-[#f6f3f5] px-5 py-6 text-slate-950 md:px-8">
      <div className="mx-auto max-w-[900px] rounded-lg border bg-white p-5 text-sm font-semibold text-slate-600 shadow-sm">
        Opening Labour Approval monthly view...
      </div>
    </main>
  );
}
