import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";
import { buildRevisionSnapshot, isPilotWorkOrder, isRevisionSchemaUnavailable, sha256 } from "@/lib/workOrderPilotRevisions.server";

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!); }
async function pilotOrder(id: string) {
  const db = admin();
  const { data, error } = await db.from("work_orders").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data || !isPilotWorkOrder(data)) return null;
  return { db, data };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission(request, "work_orders", "view"); if ("response" in auth) return auth.response;
    const { id } = await params; const loaded = await pilotOrder(id); if (!loaded) return NextResponse.json({ error: "Pilot Work Order not found." }, { status: 404 });
    const { data, error } = await loaded.db.from("work_order_pilot_revisions").select("*, work_order_pilot_revision_items(*), work_order_pilot_revision_artifacts(*)").eq("work_order_id", id).order("revision_number");
    if (error) throw error; return NextResponse.json({ revisions: data || [] });
  } catch (e: any) { if (isRevisionSchemaUnavailable(e)) return NextResponse.json({ error: "Pilot Work Order revisions are not available because the revision schema has not been installed in this database." }, { status: 503 }); return NextResponse.json({ error: e.message || "Failed to load revisions." }, { status: 500 }); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission(request, "work_orders", "edit"); if ("response" in auth) return auth.response;
    const { id } = await params; const loaded = await pilotOrder(id); if (!loaded) return NextResponse.json({ error: "Pilot Work Order not found." }, { status: 404 });
    if (String(loaded.data.approval_status).toLowerCase() !== "approved") return NextResponse.json({ error: "Only an approved Pilot Work Order can be revised." }, { status: 409 });
    const body = await request.json().catch(() => ({})); const applicableDate = String(body.applicable_date || "").trim(); const requestId = String(body.creation_request_id || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(applicableDate) || !requestId) return NextResponse.json({ error: "Applicable date and idempotency key are required." }, { status: 400 });
    const { data: items, error: itemsError } = await loaded.db.from("work_order_items").select("*").eq("work_order_id", id).order("sort_order"); if (itemsError) throw itemsError;
    const snapshot = body.snapshot || buildRevisionSnapshot(loaded.data, items || []); const digest = sha256(Buffer.from(JSON.stringify(snapshot)));
    const { data: existing } = await loaded.db.from("work_order_pilot_revisions").select("*").eq("work_order_id", id).eq("creation_request_id", requestId).maybeSingle(); if (existing) return NextResponse.json({ revision: existing, idempotent: true });
    const { data: latest } = await loaded.db.from("work_order_pilot_revisions").select("id,revision_number,status").eq("work_order_id", id).order("revision_number", { ascending: false }).limit(1).maybeSingle();
    if (latest && ["submitted", "approved"].includes(latest.status)) return NextResponse.json({ error: "A submitted revision already exists." }, { status: 409 });
    const revisionNumber = (latest?.revision_number || 0) + 1;
    const { data: revision, error } = await loaded.db.from("work_order_pilot_revisions").insert({ organization_id: loaded.data.organization_id, work_order_id: id, predecessor_revision_id: latest?.id || null, revision_number: revisionNumber, applicable_date: applicableDate, snapshot, snapshot_sha256: digest, creation_request_id: requestId, created_by: auth.user.id }).select("*").single();
    if (error) throw error; const rows = (snapshot.items || []).map((item: any, index: number) => ({ revision_id: revision.id, source_item_id: item.id || null, sort_order: item.sort_order || index + 1, snapshot: item }));
    if (rows.length) { const result = await loaded.db.from("work_order_pilot_revision_items").insert(rows); if (result.error) throw result.error; }
    return NextResponse.json({ revision }, { status: 201 });
  } catch (e: any) { if (isRevisionSchemaUnavailable(e)) return NextResponse.json({ error: "Pilot Work Order revisions are not available because the revision schema has not been installed in this database." }, { status: 503 }); return NextResponse.json({ error: e.message || "Failed to create revision draft." }, { status: 500 }); }
}
