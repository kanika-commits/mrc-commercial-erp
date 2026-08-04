import { NextResponse } from "next/server";
import { actorFields, audit, jsonError, requireLabourPermission, resolveOrganizationId } from "@/app/api/labour/_shared";
import { csvEscape, normalizeIdentifier, normalizeLookup, normalizeText } from "@/lib/labour/constants";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";

const MODULE = "labour_trades";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

function validStatus(value: unknown) {
  const status = text(value) || "active";
  return status === "inactive" ? "inactive" : "active";
}

async function withUsageCounts(access: any, trades: any[]) {
  const tradeIds = (trades || []).map((trade: any) => trade.id).filter(Boolean);
  if (!tradeIds.length) return trades || [];
  const { data, error } = await access.admin
    .from("labour_workers")
    .select("labour_trade_id")
    .in("labour_trade_id", tradeIds)
    .neq("status", "deleted");
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const row of data || []) {
    if (!row.labour_trade_id) continue;
    counts.set(row.labour_trade_id, (counts.get(row.labour_trade_id) || 0) + 1);
  }
  return (trades || []).map((trade: any) => ({ ...trade, usage_count: counts.get(trade.id) || 0 }));
}

async function findDuplicate(access: any, organizationId: string, tradeName: string, tradeCode: string, excludeId?: string) {
  let query = access.admin
    .from("labour_trades")
    .select("id, trade_name, trade_code")
    .eq("organization_id", organizationId)
    .neq("status", "deleted");
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query;
  if (error) throw error;
  const nameKey = normalizeLookup(tradeName);
  const codeKey = normalizeIdentifier(tradeCode);
  if ((data || []).some((row: any) => normalizeLookup(row.trade_name) === nameKey)) {
    return "A labour category with this name already exists.";
  }
  if ((data || []).some((row: any) => normalizeIdentifier(row.trade_code) === codeKey)) {
    return "A labour category with this code already exists.";
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const access = await requireLabourPermission(request, MODULE, "view");
    if ("response" in access) return access.response;
    const { searchParams } = new URL(request.url);
    const exportCsv = searchParams.get("export") === "csv";
    const search = text(searchParams.get("search"));
    const status = text(searchParams.get("status"));

    let query = access.admin
      .from("labour_trades")
      .select("id, organization_id, trade_name, trade_code, description, status, created_at, updated_at")
      .neq("status", "deleted")
      .order("trade_name");
    if (status === "active" || status === "inactive") query = query.eq("status", status);
    if (search) {
      const escaped = search.replace(/[%_]/g, "\\$&");
      query = query.or(`trade_name.ilike.%${escaped}%,trade_code.ilike.%${escaped}%,description.ilike.%${escaped}%`);
    }
    const scoped = applyOrganizationScope(query, access.organizationScope);
    if (!scoped) return NextResponse.json({ trades: [] });
    query = scoped;
    const { data, error } = await query;
    if (error) throw error;
    const trades = await withUsageCounts(access, data || []);

    if (exportCsv) {
      const rows = [
        "Code,Category,Description,Status,Usage",
        ...trades.map((row: any) => [row.trade_code || "", row.trade_name, row.description || "", row.status, row.usage_count || 0].map(csvEscape).join(",")),
      ];
      return new NextResponse(rows.join("\n"), {
        headers: { "content-type": "text/csv", "content-disposition": "attachment; filename=labour-categories.csv" },
      });
    }

    return NextResponse.json({ trades });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load labour categories.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, MODULE, "add");
    if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    const organizationId = await resolveOrganizationId(access, payload.organization_id);
    const tradeName = text(payload.trade_name);
    const tradeCode = normalizeIdentifier(payload.trade_code);
    if (!organizationId) return jsonError("You cannot create labour categories outside your organization.", 403);
    if (!tradeName) return jsonError("Category name is required.");
    if (!tradeCode) return jsonError("Category code is required.");
    const duplicate = await findDuplicate(access, organizationId, tradeName, tradeCode);
    if (duplicate) return jsonError(duplicate, 409);

    const insertPayload = {
      organization_id: organizationId,
      trade_name: tradeName,
      trade_code: tradeCode,
      description: text(payload.description),
      status: validStatus(payload.status),
      ...actorFields(access.auth, "created"),
    };
    const { data, error } = await access.admin.from("labour_trades").insert(insertPayload).select("id").single();
    if (error) throw error;
    await audit(access, request, {
      moduleCode: MODULE,
      action: "create",
      entityType: "labour_trade",
      recordId: data.id,
      organizationId,
      description: `Created labour category ${tradeName}.`,
      newValues: insertPayload,
    });
    return NextResponse.json({ trade_id: data.id });
  } catch (error: any) {
    return jsonError(error.message || "Failed to create labour category.", 500);
  }
}
