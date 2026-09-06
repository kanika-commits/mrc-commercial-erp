import { NextResponse } from "next/server";
import { adminClient, applyCompanySiteAccess, applyOrganizationAccess, jsonError, requireProcurementPermission, requireProcurementAny, text } from "@/lib/serverProcurementAccess";

const MODULE = "procurement_goods_receipts";
const FIELDS = new Set(["vehicle_number", "weighbridge_slip_number", "weighbridge_slip_date", "weighbridge_slip_time", "weighbridge_gross_date", "weighbridge_gross_time", "weighbridge_tare_date", "weighbridge_tare_time", "gross_weight", "tare_weight", "net_weight", "weight_unit", "weighbridge_vehicle_number", "challan_number", "challan_date", "challan_po_number", "challan_vendor", "challan_vehicle_number", "challan_items_json", "invoice_number", "invoice_date", "invoice_items_json", "received_quantity"]);
const SOURCES = new Set(["ocr", "manual", "corrected_ocr", "system_calculated"]);
function clean(value: unknown) { return String(value ?? "").trim(); }
function isTime(value: string) { const match = value.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/); return match ? `${match[1].padStart(2, "0")}:${match[2]}` : null; }

async function load(request: Request, id: string, action: "view" | "edit") {
  const access = action === "view" ? await requireProcurementAny(request, [{ moduleCode: MODULE, actionCode: "view" }, { moduleCode: MODULE, actionCode: "add" }, { moduleCode: MODULE, actionCode: "edit" }, { moduleCode: MODULE, actionCode: "approve" }]) : await requireProcurementPermission(request, MODULE, "edit");
  if ("response" in access) return { response: access.response } as const;
  let query: any = applyOrganizationAccess(adminClient().from("procurement_goods_receipts").select("id,organization_id,company_id,site_id,status").eq("id", id).maybeSingle(), access);
  query = query && applyCompanySiteAccess(query, access);
  if (!query) return { response: jsonError("Goods Receipt Note was not found.", 404) } as const;
  const result = await query;
  if (result.error) throw result.error;
  if (!result.data) return { response: jsonError("Goods Receipt Note was not found.", 404) } as const;
  return { access, admin: adminClient(), row: result.data } as const;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const { id } = await context.params; const result = await load(request, id, "view"); if ("response" in result) return result.response; const rows = await result.admin.from("procurement_goods_receipt_verified_values").select("*").eq("grn_id", id).eq("organization_id", result.row.organization_id).order("verified_at", { ascending: false }); if (rows.error) throw rows.error; return NextResponse.json({ values: rows.data || [] }); } catch (error: any) { return jsonError(error.message || "Failed to load verified GRN values.", 500); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const result = await load(request, id, "edit"); if ("response" in result) return result.response; if (result.row.status !== "draft") return jsonError("Finalized Goods Receipt Notes are read-only.", 403);
    const body = await request.json().catch(() => ({})); const fieldName = text(body.field_name); const sourceType = text(body.source_type); let finalValue = clean(body.final_value); if (!FIELDS.has(fieldName) || !SOURCES.has(sourceType)) return jsonError("A valid verified field, source and value are required.", 400);
    if (fieldName === "net_weight") return jsonError("Net Weight is system-calculated and cannot be entered directly.", 400);
    if (!finalValue && !["gross_weight", "tare_weight"].includes(fieldName)) return jsonError("A valid verified field, source and value are required.", 400);
    if (["gross_weight", "tare_weight"].includes(fieldName) && finalValue && (!/^\d+(\.\d+)?$/.test(finalValue) || Number(finalValue) <= 0)) return jsonError("Gross and Tare must be positive numbers.", 400);
    if (["weighbridge_slip_time", "weighbridge_gross_time", "weighbridge_tare_time"].includes(fieldName) && finalValue) { const normalized = isTime(finalValue); if (!normalized) return jsonError("Enter a valid time in HH:MM or HH:MM:SS format.", 400); finalValue = normalized; }
    if (["challan_items_json", "invoice_items_json"].includes(fieldName) && finalValue) { try { const parsed = JSON.parse(finalValue); if (!Array.isArray(parsed)) return jsonError("Document items must be a list.", 400); } catch { return jsonError("Document items must be valid structured data.", 400); } }
    const actor = result.access.user; const saved = await result.admin.from("procurement_goods_receipt_verified_values").insert({ organization_id: result.row.organization_id, grn_id: id, document_id: text(body.document_id) || null, field_name: fieldName, source_type: sourceType, original_extracted_value: text(body.original_extracted_value) || null, final_value: finalValue || null, confidence: body.confidence == null ? null : Number(body.confidence), verified_by: actor.id }).select("*").single(); if (saved.error) throw saved.error; return NextResponse.json({ value: saved.data }, { status: 201 });
  } catch (error: any) { return jsonError(error.message || "Failed to save verified GRN value.", 500); }
}
