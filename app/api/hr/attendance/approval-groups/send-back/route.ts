import { NextResponse } from "next/server";
import { POST as sendBackPeriod } from "../../periods/[id]/send-back/route";
import { adminClient, requireAttendanceApprovalActor } from "../../_shared";
import { loadVisiblePeriods } from "../../approvals/route";

export async function POST(request: Request) {
  try {
    const auth = await requireAttendanceApprovalActor(request);
    if ("response" in auth) return auth.response;
    const body = await request.json().catch(() => ({}));
    const visible = await loadVisiblePeriods(adminClient(), auth, "all");
    const allowed = new Set(visible.map((period: any) => period.id));
    const ids = Array.isArray(body.period_ids) ? body.period_ids.filter((id: unknown) => allowed.has(String(id))) : [];
    if (!ids.length) return NextResponse.json({ error: "Select at least one eligible company period." }, { status: 400 });
    const results = [];
    for (const id of ids) {
      const response = await sendBackPeriod(new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify({ reason: body.reason }) }), { params: Promise.resolve({ id }) }) as Response;
      const payload = await response.json().catch(() => ({}));
      results.push({ period_id: id, success: response.ok, status: response.status, error: response.ok ? null : payload.error || "Send Back failed." });
    }
    return NextResponse.json({ results });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Failed to send back attendance group." }, { status: 500 }); }
}
