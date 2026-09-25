import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  const secret = process.env.HR_TRANSFER_JOB_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || request.headers.get("x-hr-transfer-job-secret");
  if (!secret || supplied !== secret) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await admin.rpc("process_due_hr_employee_transfers", { p_business_date: null });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
