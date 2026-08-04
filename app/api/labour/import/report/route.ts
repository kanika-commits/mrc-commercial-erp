import { NextResponse } from "next/server";
import { jsonError, loadScopedLabourImportBatch, requireLabourPermission } from "@/app/api/labour/_shared";
import { maskAadhaarForImport } from "@/lib/labour/import";

function cell(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function correctionGuidance(row: any) {
  const errors = row.validation_errors || [];
  if (errors.some((item: string) => item.includes("Daily Rate"))) return "Enter a whole non-negative rupee Daily Rate.";
  if (errors.some((item: string) => item.includes("Contractor"))) return "Use a Vendor linked to a Commercial Work Order for the selected company/site.";
  if (errors.some((item: string) => item.includes("Labour Category"))) return "Use an active Labour Category name from the template dropdown sheet.";
  if (errors.some((item: string) => item.includes("Aadhaar"))) return "Check Aadhaar Available, Aadhaar Number, No-Aadhaar Reason, and Aadhaar Drive Link columns.";
  if (errors.some((item: string) => item.includes("Company") || item.includes("Site"))) return "Use a valid company and independent site within your permitted scope.";
  if (errors.length) return "Correct the row data and re-upload the workbook.";
  if ((row.validation_warnings || []).length) return "Review the warning, then revalidate before import.";
  return "No correction required.";
}

export async function GET(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_workers", "import");
    if ("response" in access) return access.response;
    const batchId = new URL(request.url).searchParams.get("batch_id");
    if (!batchId) return jsonError("Batch ID is required.");
    const batch = await loadScopedLabourImportBatch(access, batchId);
    if (!batch) return jsonError("Import batch not found.", 404);
    const { data: rows, error } = await access.admin.from("labour_import_rows").select("*").eq("batch_id", batchId).order("source_row_number");
    if (error) throw error;
    const headers = [
      "Excel Row",
      "Labour Name",
      "Masked Aadhaar",
      "Company",
      "Site",
      "Contractor",
      "Labour Category",
      "Daily Rate",
      "Status",
      "Errors",
      "Warnings",
      "Correction Guidance",
      "Original Row Data",
    ];
    const body = [
      "<html><head><meta charset=\"utf-8\" /></head><body><table border=\"1\">",
      `<caption>${cell(batch.file_name)} Labour Import Report</caption>`,
      `<thead><tr>${headers.map((header) => `<th>${cell(header)}</th>`).join("")}</tr></thead>`,
      "<tbody>",
      ...(rows || []).map((row: any) => {
        const n = row.normalized_data || {};
        const raw = { ...(row.raw_data || {}) };
        for (const key of Object.keys(raw)) {
          if (/aadhaar/i.test(key)) raw[key] = maskAadhaarForImport(raw[key]);
        }
        return `<tr>${[
          row.source_row_number,
          n.worker_name,
          n.masked_aadhaar || maskAadhaarForImport(n.aadhaar_number),
          n.company_text,
          n.site_text,
          n.contractor_text,
          n.trade,
          n.wage_rate,
          row.validation_status,
          (row.validation_errors || []).join("; "),
          (row.validation_warnings || []).join("; "),
          correctionGuidance(row),
          JSON.stringify(raw),
        ].map((value) => `<td>${cell(value)}</td>`).join("")}</tr>`;
      }),
      "</tbody></table></body></html>",
    ].join("");
    return new NextResponse(body, {
      headers: {
        "content-type": "application/vnd.ms-excel; charset=utf-8",
        "content-disposition": `attachment; filename="labour-import-report-${batchId}.xls"`,
      },
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load labour import report.", 500);
  }
}
